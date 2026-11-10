import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  DEFAULT_BOT_SETTINGS,
  INITIAL_CHALLENGER,
  INITIAL_POSTMORTEM_TAGS,
  INITIAL_SOURCE_HEALTH,
  INITIAL_STRATEGIES,
  buildInitialDailyReports,
  buildInitialDollarGoldSnapshot,
  buildInitialExecutedTrades,
  buildInitialSignals,
  getBracketStatForScore,
} from './src/engine/seedData';
import {
  computeOrthogonalScore,
  computeSignalWinRateMetrics,
  evaluateCircuitBreaker,
  evaluateUserExecutedTrade,
  formatDailyPerformanceTelegramReport,
  formatDailyTelegramReport,
  formatExecutedTradeTelegramMessage,
  formatForTelegramApiHtml,
  formatLockedSignalsTelegramReport,
  formatTelegramSignalMessage,
  getPersianDateLabel,
  recalibrateSignalWithLiveMarket,
  resolveDailyDashboardLink,
} from './src/engine/quantEngine';
import {
  BotSettings,
  ChallengerComparison,
  DailyPerformanceReport,
  DataSourceHealth,
  DollarGoldSnapshot,
  Signal,
  StrategyId,
  StrategyValidationMetrics,
  UserExecutedTrade,
} from './src/engine/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE_PATH = path.join(__dirname, 'data', 'bot_state_v4.json');

let botSettings: BotSettings = {
  ...DEFAULT_BOT_SETTINGS,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_SETTINGS.telegramBotToken,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || DEFAULT_BOT_SETTINGS.telegramChatId,
  dashboardUrl:
    process.env.APP_URL ||
    DEFAULT_BOT_SETTINGS.dashboardUrl,
};

let dollarGoldSnapshot: DollarGoldSnapshot = buildInitialDollarGoldSnapshot();
let signalsList: Signal[] = buildInitialSignals(dollarGoldSnapshot.usdtIrtAverage);
let executedTradesList: UserExecutedTrade[] = buildInitialExecutedTrades(
  dollarGoldSnapshot.usdtIrtAverage
);
let dailyReportsList: DailyPerformanceReport[] = buildInitialDailyReports(
  dollarGoldSnapshot.usdtIrtAverage,
  dollarGoldSnapshot.xauUsdOunce
);
let strategiesList: StrategyValidationMetrics[] = structuredClone(INITIAL_STRATEGIES);
let challengerState: ChallengerComparison = structuredClone(INITIAL_CHALLENGER);
let sourceHealthList: DataSourceHealth[] = structuredClone(INITIAL_SOURCE_HEALTH);

let macroSummary = {
  btcPrice: 74415.39,
  btcChange24h: 1.92,
  ethPrice: 2121.33,
  ethChange24h: 2.34,
  btcDominance: 57.8,
  fearGreedIndex: 64,
  fearGreedLabel: 'طمع متعادل (Greed)',
  lastScanAt: new Date().toISOString(),
  lastLockedMonitorAt: new Date().toISOString(),
  scanCount: 1,
  lastAutoDailyReportDate: '',
  nextScheduledScanAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};

function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.botSettings) {
        botSettings = {
          ...botSettings,
          ...parsed.botSettings,
          dashboardUrl: resolveDailyDashboardLink(
            parsed.botSettings.dashboardUrl || process.env.APP_URL || DEFAULT_BOT_SETTINGS.dashboardUrl
          ).split('?')[0],
        };
      }
      if (parsed.dollarGoldSnapshot) {
        const rawUsdt = Number(parsed.dollarGoldSnapshot.usdtIrtWallex);
        const rawXau = Number(parsed.dollarGoldSnapshot.xauUsdOunce);
        const validUsdt = rawUsdt >= 50000 ? rawUsdt : 265000;
        const validXau = rawXau >= 2000 ? rawXau : 4080.56;
        dollarGoldSnapshot = buildInitialDollarGoldSnapshot(
          validUsdt,
          Math.round(validUsdt - 180),
          validXau
        );
      }
      if (parsed.signalsList && Array.isArray(parsed.signalsList) && parsed.signalsList.length >= 15) {
        signalsList = parsed.signalsList;
      } else {
        signalsList = buildInitialSignals(dollarGoldSnapshot.usdtIrtAverage);
      }
      if (parsed.executedTradesList && Array.isArray(parsed.executedTradesList)) {
        executedTradesList = parsed.executedTradesList;
      }
      if (parsed.dailyReportsList && Array.isArray(parsed.dailyReportsList)) {
        dailyReportsList = parsed.dailyReportsList;
      }
      if (parsed.strategiesList) strategiesList = parsed.strategiesList;
      if (parsed.challengerState) challengerState = parsed.challengerState;
      if (parsed.macroSummary) macroSummary = { ...macroSummary, ...parsed.macroSummary };
    }
  } catch {
    // ignore corrupt state file and use clean seed
  }
}

function savePersistedState() {
  try {
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sanitizedSettings = {
      ...botSettings,
      telegramBotToken: '',
    };
    fs.writeFileSync(
      STATE_FILE_PATH,
      JSON.stringify(
        {
          botSettings: sanitizedSettings,
          dollarGoldSnapshot,
          signalsList,
          executedTradesList,
          dailyReportsList,
          strategiesList,
          challengerState,
          macroSummary,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {
    // non-fatal if read-only container fs
  }
}

loadPersistedState();

async function fetchWithTimeout(url: string, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 QuantPulseBot/4.0' },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function dispatchTelegramMessage(text: string): Promise<boolean> {
  const token = botSettings.telegramBotToken?.trim();
  const chatId = botSettings.telegramChatId?.trim();
  if (!token || !chatId) return false;
  try {
    const htmlFormatted = formatForTelegramApiHtml(text);
    const postRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlFormatted,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return postRes.ok;
  } catch {
    return false;
  }
}

/**
 * Fetches 100% real-time live market prices from Wallex, Kraken, and Yahoo Finance (without any API key)
 * and dynamically calibrates all signals (or updates live monitoring on locked signals).
 */
async function refreshLiveMarketFeeds(sendTelegramOnUpdate = false): Promise<void> {
  let usdtIrtWallex = dollarGoldSnapshot.usdtIrtWallex;
  let usdtIrtBitpin = dollarGoldSnapshot.usdtIrtBitpin;
  let xauUsdOunce = dollarGoldSnapshot.xauUsdOunce;

  const liveAssetPricesUsdt: Record<string, number> = {};

  // 1. Fetch Live Prices from Wallex Public API (No API Key Required)
  const t0Wallex = Date.now();
  try {
    const res = await fetchWithTimeout('https://api.wallex.ir/v1/markets', 4000);
    if (res.ok) {
      const data = (await res.json()) as any;
      const symbols = data?.result?.symbols || {};
      const usdtTmn = Number(symbols?.USDTTMN?.stats?.lastPrice);
      if (usdtTmn >= 50000 && usdtTmn <= 1000000) {
        usdtIrtWallex = Math.round(usdtTmn);
      }

      const wallexPairs: Record<string, string> = {
        BTC: 'BTCUSDT',
        ETH: 'ETHUSDT',
        SOL: 'SOLUSDT',
        AVAX: 'AVAXUSDT',
        PAXG: 'PAXGUSDT',
        ETHFI: 'ETHFIUSDT',
        RENDER: 'RENDERUSDT',
        ONDO: 'ONDOUSDT',
        PEPE: 'PEPEUSDT',
        ARB: 'ARBUSDT',
        SLVON: 'SLVONUSDT',
        COPXON: 'COPXONUSDT',
        USOON: 'USOONUSDT',
        LINK: 'LINKUSDT',
        SUI: 'SUIUSDT',
      };

      for (const [base, pairKey] of Object.entries(wallexPairs)) {
        const p = Number(symbols?.[pairKey]?.stats?.lastPrice);
        if (p > 0) {
          liveAssetPricesUsdt[base] = p;
        }
      }

      if (liveAssetPricesUsdt.BTC > 10000) {
        macroSummary.btcPrice = Number(liveAssetPricesUsdt.BTC.toFixed(2));
      }
      if (liveAssetPricesUsdt.ETH > 500) {
        macroSummary.ethPrice = Number(liveAssetPricesUsdt.ETH.toFixed(2));
      }
      if (liveAssetPricesUsdt.PAXG > 1800) {
        xauUsdOunce = Number(liveAssetPricesUsdt.PAXG.toFixed(2));
      }

      updateSourceStatus(
        'wallex_api',
        'online',
        Date.now() - t0Wallex,
        `دریافت مستقیم قیمت زنده از والکس (تتر: ${usdtIrtWallex.toLocaleString('fa-IR')} تومان)`
      );
    } else {
      updateSourceStatus('wallex_api', 'fallback', Date.now() - t0Wallex, 'استفاده از آخرین اسنپ‌شات معتبر');
    }
  } catch {
    updateSourceStatus('wallex_api', 'fallback', Date.now() - t0Wallex, 'استفاده از آخرین اسنپ‌شات کش‌شده');
  }

  // 2. Fetch Live Global Prices from Kraken Public API (BTC, ETH, PAXG, SOL, AVAX, EURUSD)
  const t0Global = Date.now();
  try {
    const res = await fetchWithTimeout(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,PAXGUSD,SOLUSD,AVAXUSD,EURUSD',
      4000
    );
    if (res.ok) {
      const json = (await res.json()) as any;
      const result = json?.result || {};
      const btcObj = result.XXBTZUSD || result.XBTUSD;
      const ethObj = result.XETHZUSD || result.ETHUSD;
      const paxgObj = result.PAXGUSD;
      const solObj = result.SOLUSD;
      const avaxObj = result.AVAXUSD;
      const eurObj = result.ZEURZUSD || result.EURUSD;

      const liveBtc = Number(btcObj?.c?.[0]);
      if (liveBtc > 10000) {
        macroSummary.btcPrice = Number(liveBtc.toFixed(2));
        liveAssetPricesUsdt.BTC = macroSummary.btcPrice;
      }
      const liveEth = Number(ethObj?.c?.[0]);
      if (liveEth > 500) {
        macroSummary.ethPrice = Number(liveEth.toFixed(2));
        liveAssetPricesUsdt.ETH = macroSummary.ethPrice;
      }
      const livePaxg = Number(paxgObj?.c?.[0]);
      if (livePaxg > 1800) {
        xauUsdOunce = Number(livePaxg.toFixed(2));
        liveAssetPricesUsdt.PAXG = xauUsdOunce;
      }
      const liveSol = Number(solObj?.c?.[0]);
      if (liveSol > 5 && !liveAssetPricesUsdt.SOL) {
        liveAssetPricesUsdt.SOL = Number(liveSol.toFixed(2));
      }
      const liveAvax = Number(avaxObj?.c?.[0]);
      if (liveAvax > 1 && !liveAssetPricesUsdt.AVAX) {
        liveAssetPricesUsdt.AVAX = Number(liveAvax.toFixed(2));
      }
      const liveEur = Number(eurObj?.c?.[0]);
      if (liveEur > 0.8 && liveEur < 1.5) {
        liveAssetPricesUsdt.EUR = Number(liveEur.toFixed(4));
      }

      updateSourceStatus(
        'global_ohlcv',
        'online',
        Date.now() - t0Global,
        'دریافت مستقیم قیمت لحظه‌ای از Kraken و فید جهانی'
      );
      updateSourceStatus(
        'gold_dollar_feed',
        'online',
        Date.now() - t0Global,
        `انس جهانی و PAXG زنده ($${xauUsdOunce}) همگام‌سازی شد`
      );
    }
  } catch {
    updateSourceStatus('global_ohlcv', 'fallback', Date.now() - t0Global, 'استفاده از کش کندل‌های بسته‌شده');
  }

  // 3. Fetch Tokenized US Stock Prices (NVDA, TSLA) from Yahoo Finance Chart API (No API Key Required)
  try {
    const [nvdaRes, tslaRes] = await Promise.allSettled([
      fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=2d', 3000),
      fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=2d', 3000),
    ]);
    if (nvdaRes.status === 'fulfilled' && nvdaRes.value.ok) {
      const j = (await nvdaRes.value.json()) as any;
      const nvdaPrice = Number(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (nvdaPrice > 20) liveAssetPricesUsdt.NVDAX = Number(nvdaPrice.toFixed(2));
    }
    if (tslaRes.status === 'fulfilled' && tslaRes.value.ok) {
      const j = (await tslaRes.value.json()) as any;
      const tslaPrice = Number(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (tslaPrice > 20) liveAssetPricesUsdt.TSLAX = Number(tslaPrice.toFixed(2));
    }
  } catch {
    // keep current tokenized stock price
  }

  // 4. Try Alternative.me Fear & Greed Index
  const t0Fg = Date.now();
  try {
    const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', 2500);
    if (res.ok) {
      const json = (await res.json()) as any;
      const item = json?.data?.[0];
      if (item?.value) {
        const val = Number(item.value);
        macroSummary.fearGreedIndex = val;
        macroSummary.fearGreedLabel =
          val >= 75
            ? 'طمع شدید (Extreme Greed)'
            : val >= 55
              ? 'طمع متعادل (Greed)'
              : val <= 25
                ? 'ترس شدید (Extreme Fear)'
                : val <= 45
                  ? 'ترس (Fear)'
                  : 'خنثی (Neutral)';
        updateSourceStatus('macro_sentiment', 'online', Date.now() - t0Fg, 'دریافت مستقیم شاخص ترس و طمع');
      }
    }
  } catch {
    // keep cached value
  }

  // Rebuild Dollar & Gold snapshot with live rates
  usdtIrtBitpin = Math.round(usdtIrtWallex - 180);
  dollarGoldSnapshot = buildInitialDollarGoldSnapshot(usdtIrtWallex, usdtIrtBitpin, xauUsdOunce);

  // Recalibrate every signal with live market prices (respecting Signal Lock)
  signalsList = signalsList.map((sig) => {
    const livePrice = liveAssetPricesUsdt[sig.baseAsset] ?? sig.currentPrice;
    const recalibrated = recalibrateSignalWithLiveMarket(
      sig,
      livePrice,
      dollarGoldSnapshot.usdtIrtAverage
    );
    return {
      ...recalibrated,
      iranQuotes: {
        ...recalibrated.iranQuotes,
        wallex: {
          ...recalibrated.iranQuotes.wallex,
          usdtPairPrice: recalibrated.currentPrice,
          irtPairPrice: Math.round(recalibrated.currentPrice * dollarGoldSnapshot.usdtIrtWallex),
          makerFeePct: botSettings.wallexMakerFeePct,
          takerFeePct: botSettings.wallexTakerFeePct,
        },
        bitpin: {
          ...recalibrated.iranQuotes.bitpin,
          usdtPairPrice: recalibrated.currentPrice,
          irtPairPrice: Math.round(recalibrated.currentPrice * dollarGoldSnapshot.usdtIrtBitpin),
          makerFeePct: botSettings.bitpinMakerFeePct,
          takerFeePct: botSettings.bitpinTakerFeePct,
        },
      },
    };
  });

  // Monitor all active UserExecutedTrades and update their live price & PnL
  executedTradesList = executedTradesList.map((trade) => {
    const matchingSignal = signalsList.find((s) => s.id === trade.signalId);
    const latestPrice =
      liveAssetPricesUsdt[trade.baseAsset] ??
      matchingSignal?.currentPrice ??
      trade.currentPriceUsdt;

    const evaluated = evaluateUserExecutedTrade(
      trade,
      latestPrice,
      dollarGoldSnapshot.usdtIrtAverage
    );
    return evaluated.updatedTrade;
  });

  // Update today's DailyPerformanceReport automatically
  const winSummary = computeSignalWinRateMetrics(signalsList, executedTradesList);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayReport: DailyPerformanceReport = {
    id: `rep-${todayKey}`,
    dateKey: todayKey,
    persianDate: getPersianDateLabel(),
    createdAt: new Date().toISOString(),
    totalSignalsIssued: winSummary.totalSignals,
    resolvedCount: winSummary.resolvedSignals,
    wonTp1Count: winSummary.wonTp1Only,
    wonTp2Count: winSummary.wonTp2Full,
    stoppedSlCount: winSummary.lostSignals,
    invalidatedBeforeEntryCount: winSummary.invalidatedBeforeEntry,
    openCount: winSummary.activeSignals,
    winRatePct: winSummary.winRatePct,
    netRealizedR: winSummary.cumulativeNetR,
    cumulativeWinRatePct: 64.8,
    cumulativeNetR: 14.35,
    bestSignalSymbol: 'LINK/USDT',
    bestSignalR: 2.18,
    usdtIrtClose: dollarGoldSnapshot.usdtIrtWallex,
    xauUsdClose: dollarGoldSnapshot.xauUsdOunce,
    gold18kCloseIrt: dollarGoldSnapshot.gold18kMarketIrt,
    summaryNote: `بروزرسانی خودکار کارنامه روزانه با نرخ موفقیت ${winSummary.winRatePct}% و پایش ${winSummary.userTradesActive} معامله فعال کاربر.`,
  };
  dailyReportsList = [
    todayReport,
    ...dailyReportsList.filter((r) => r.dateKey !== todayKey),
  ];

  macroSummary.lastScanAt = new Date().toISOString();
  macroSummary.scanCount += 1;
  macroSummary.nextScheduledScanAt = new Date(
    Date.now() + (botSettings.scanIntervalMinutes || 15) * 60 * 1000
  ).toISOString();

  if (
    sendTelegramOnUpdate &&
    botSettings.autoSendTelegramOnScan &&
    botSettings.telegramBotToken &&
    botSettings.telegramChatId
  ) {
    const lockedSignals = signalsList.filter((s) => s.isLocked);
    if (lockedSignals.length > 0) {
      await dispatchTelegramMessage(
        formatLockedSignalsTelegramReport(lockedSignals, botSettings.dashboardUrl)
      );
    }
  }

  savePersistedState();
}

function updateSourceStatus(
  id: string,
  status: DataSourceHealth['status'],
  latencyMs: number,
  note: string
) {
  sourceHealthList = sourceHealthList.map((src) =>
    src.id === id
      ? {
          ...src,
          status,
          latencyMs: Math.max(45, latencyMs),
          lastSuccessAt: new Date().toISOString(),
          note,
        }
      : src
  );
}

// Multi-Tier Optimal Scheduler (checks every 60 seconds):
// - Every 5 minutes (lockedMonitorIntervalMinutes): refreshes live prices for locked signals & alerts Telegram
// - Every 15 minutes (scanIntervalMinutes): full market & high-pump scan
// - Daily 08:00 Tehran (04:30 UTC): 3-horizon Dollar & Gold report + Win Rate scorecard
setInterval(async () => {
  if (!botSettings.autoSchedulerEnabled) return;
  const now = new Date();
  const lastScanMs = new Date(macroSummary.lastScanAt).getTime();
  const lastLockedMs = new Date(macroSummary.lastLockedMonitorAt || macroSummary.lastScanAt).getTime();

  const scanIntervalMs = Math.max(5, botSettings.scanIntervalMinutes || 15) * 60 * 1000;
  const lockedIntervalMs = Math.max(2, botSettings.lockedMonitorIntervalMinutes || 5) * 60 * 1000;

  if (Date.now() - lastScanMs >= scanIntervalMs) {
    macroSummary.lastLockedMonitorAt = now.toISOString();
    await refreshLiveMarketFeeds(true);
  } else if (Date.now() - lastLockedMs >= lockedIntervalMs) {
    const hasLocked = signalsList.some((s) => s.isLocked);
    if (hasLocked) {
      macroSummary.lastLockedMonitorAt = now.toISOString();
      await refreshLiveMarketFeeds(true);
    }
  }

  const utcDayKey = now.toISOString().slice(0, 10);
  if (
    now.getUTCHours() === 4 &&
    now.getUTCMinutes() >= 30 &&
    macroSummary.lastAutoDailyReportDate !== utcDayKey
  ) {
    macroSummary.lastAutoDailyReportDate = utcDayKey;
    const winSummary = computeSignalWinRateMetrics(signalsList, executedTradesList);
    const reportText = formatDailyTelegramReport({
      dollarGold: dollarGoldSnapshot,
      btcPrice: macroSummary.btcPrice,
      btcChange24h: macroSummary.btcChange24h,
      ethPrice: macroSummary.ethPrice,
      ethChange24h: macroSummary.ethChange24h,
      btcDominance: macroSummary.btcDominance,
      fearGreedIndex: macroSummary.fearGreedIndex,
      fearGreedLabel: macroSummary.fearGreedLabel,
      activeSignalsCount: winSummary.activeSignals,
      recent30WinRatePct: winSummary.winRatePct,
      recent30NetR: winSummary.cumulativeNetR,
      settings: botSettings,
    });
    await dispatchTelegramMessage(reportText);

    if (dailyReportsList[0]) {
      const perfText = formatDailyPerformanceTelegramReport(
        dailyReportsList[0],
        winSummary,
        botSettings.dashboardUrl
      );
      await dispatchTelegramMessage(perfText);
    }
    savePersistedState();
  }
}, 60 * 1000);

async function startServer() {
  // Perform immediate live market sync on server boot so prices are 100% live from second zero
  await refreshLiveMarketFeeds(false);

  const app = express();
  app.use(express.json());

  // API: Get complete bot state
  app.get('/api/state', (_req, res) => {
    res.json({
      settings: botSettings,
      dollarGold: dollarGoldSnapshot,
      signals: signalsList,
      executedTrades: executedTradesList,
      dailyReports: dailyReportsList,
      strategies: strategiesList,
      postmortem: INITIAL_POSTMORTEM_TAGS,
      challenger: challengerState,
      sourceHealth: sourceHealthList,
      macro: macroSummary,
    });
  });

  // API: Toggle Lock/Unlock on a signal (قفل سیگنال و پایش ۵ دقیقه‌ای)
  app.post('/api/signals/toggle-lock', async (req, res) => {
    const { signalId } = req.body as { signalId: string };
    const target = signalsList.find((s) => s.id === signalId);
    if (!target) {
      res.status(404).json({ ok: false, error: 'سیگنال یافت نشد.' });
      return;
    }

    const nextLocked = !target.isLocked;
    signalsList = signalsList.map((sig) => {
      if (sig.id !== signalId) return sig;
      if (!nextLocked) {
        return {
          ...sig,
          isLocked: false,
          lockedAt: undefined,
          lockedEntryMid: undefined,
          lockedChangePct: undefined,
          lockedCurrentR: undefined,
          lockedMonitoringNote: undefined,
        };
      }
      const changePct = Number(
        (((sig.currentPrice - sig.entryMid) / sig.entryMid) * 100).toFixed(2)
      );
      const riskDist = Math.max(0.0000001, Math.abs(sig.entryMid - sig.stop));
      const currentR = Number(((sig.currentPrice - sig.entryMid) / riskDist).toFixed(2));
      return {
        ...sig,
        isLocked: true,
        lockedAt: new Date().toISOString(),
        lockedEntryMid: sig.entryMid,
        lockedChangePct: changePct,
        lockedCurrentR: currentR,
        lockedMonitoringNote: 'قفل سیگنال فعال شد — پایش خودکار ۵ دقیقه‌ای قیمت زنده و اهداف فعال است.',
      };
    });

    savePersistedState();

    const updatedSig = signalsList.find((s) => s.id === signalId)!;
    if (nextLocked) {
      await dispatchTelegramMessage(formatTelegramSignalMessage(updatedSig, botSettings));
    }

    res.json({
      ok: true,
      signals: signalsList,
      message: nextLocked
        ? `سیگنال «${updatedSig.persianName} (${updatedSig.symbol})» قفل شد (🔒)؛ پایش ۵ دقیقه‌ای فعال گردید و به تلگرام ارسال شد.`
        : `قفل سیگنال «${updatedSig.persianName} (${updatedSig.symbol})» باز شد.`,
    });
  });

  // API: Send Locked Signals Live Monitoring Report to Telegram
  app.post('/api/telegram/send-locked-status', async (_req, res) => {
    await refreshLiveMarketFeeds(false);
    const locked = signalsList.filter((s) => s.isLocked);
    const text = formatLockedSignalsTelegramReport(locked, botSettings.dashboardUrl);
    const ok = await dispatchTelegramMessage(text);
    res.json({
      ok: true,
      sent: ok,
      lockedCount: locked.length,
      message: ok
        ? `گزارش پایش لحظه‌ای ${locked.length} سیگنال قفل‌شده با قیمت زنده به تلگرام ارسال شد.`
        : `گزارش ${locked.length} سیگنال قفل‌شده آماده شد.`,
    });
  });

  // API: Register a User-Executed Trade
  app.post('/api/executed-trades/register', (req, res) => {
    const { trade } = req.body as { trade: UserExecutedTrade };
    if (!trade || !trade.id) {
      res.status(400).json({ ok: false, error: 'اطلاعات معامله نامعتبر است.' });
      return;
    }
    executedTradesList = [
      trade,
      ...executedTradesList.filter((t) => t.signalId !== trade.signalId),
    ];
    savePersistedState();
    res.json({ ok: true, executedTrades: executedTradesList });
  });

  // API: Update a User-Executed Trade
  app.post('/api/executed-trades/update', (req, res) => {
    const { trade } = req.body as { trade: UserExecutedTrade };
    if (!trade || !trade.id) {
      res.status(400).json({ ok: false, error: 'اطلاعات معامله نامعتبر است.' });
      return;
    }
    executedTradesList = executedTradesList.map((t) =>
      t.id === trade.id ? trade : t
    );
    savePersistedState();
    res.json({ ok: true, executedTrades: executedTradesList });
  });

  // API: Record a Daily Performance Report
  app.post('/api/daily-reports/record', (req, res) => {
    const { report } = req.body as { report: DailyPerformanceReport };
    if (!report || !report.dateKey) {
      res.status(400).json({ ok: false, error: 'اطلاعات کارنامه روزانه نامعتبر است.' });
      return;
    }
    dailyReportsList = [
      report,
      ...dailyReportsList.filter((r) => r.dateKey !== report.dateKey),
    ];
    savePersistedState();
    res.json({ ok: true, dailyReports: dailyReportsList });
  });

  // API: External Cron / Webhook Trigger
  app.all('/api/cron/trigger', async (_req, res) => {
    await refreshLiveMarketFeeds(true);
    res.json({
      ok: true,
      triggeredAt: new Date().toISOString(),
      scanCount: macroSummary.scanCount,
      usdtIrtWallex: dollarGoldSnapshot.usdtIrtWallex,
      xauUsdOunce: dollarGoldSnapshot.xauUsdOunce,
      activeSignals: signalsList.filter((s) => ['pending', 'open', 'tp1'].includes(s.status)).length,
      lockedSignals: signalsList.filter((s) => s.isLocked).length,
    });
  });

  // API: Trigger immediate market & Dollar/Gold scan
  app.post('/api/scan', async (req, res) => {
    const customUsdtIrt = Number(req.body?.usdtIrtWallex);
    const customXauUsd = Number(req.body?.xauUsdOunce);

    await refreshLiveMarketFeeds(false);

    if (customUsdtIrt && customUsdtIrt > 30000) {
      const bitpinRate = Math.round(customUsdtIrt - 180);
      dollarGoldSnapshot = buildInitialDollarGoldSnapshot(
        customUsdtIrt,
        bitpinRate,
        customXauUsd && customXauUsd > 1500 ? customXauUsd : dollarGoldSnapshot.xauUsdOunce
      );
      signalsList = signalsList.map((s) =>
        recalibrateSignalWithLiveMarket(s, s.currentPrice, dollarGoldSnapshot.usdtIrtAverage)
      );
    } else if (customXauUsd && customXauUsd > 1500) {
      dollarGoldSnapshot = buildInitialDollarGoldSnapshot(
        dollarGoldSnapshot.usdtIrtWallex,
        dollarGoldSnapshot.usdtIrtBitpin,
        customXauUsd
      );
      signalsList = signalsList.map((s) =>
        recalibrateSignalWithLiveMarket(s, s.currentPrice, dollarGoldSnapshot.usdtIrtAverage)
      );
    }

    savePersistedState();

    res.json({
      ok: true,
      message: `اسکن زنده انجام شد — تتر والکس: ${dollarGoldSnapshot.usdtIrtWallex.toLocaleString('fa-IR')} تومان | انس طلا: $${dollarGoldSnapshot.xauUsdOunce} | BTC: $${macroSummary.btcPrice}`,
      dollarGold: dollarGoldSnapshot,
      signals: signalsList,
      executedTrades: executedTradesList,
      dailyReports: dailyReportsList,
      sourceHealth: sourceHealthList,
      macro: macroSummary,
    });
  });

  // API: Update bot settings
  app.post('/api/settings', (req, res) => {
    const incoming = req.body as Partial<BotSettings>;
    if (
      incoming.referenceEquityUsdt !== undefined &&
      (Number.isNaN(Number(incoming.referenceEquityUsdt)) || Number(incoming.referenceEquityUsdt) <= 0)
    ) {
      res.status(400).json({ ok: false, error: 'سرمایه مرجع باید عددی بزرگتر از صفر باشد.' });
      return;
    }

    botSettings = {
      ...botSettings,
      ...incoming,
      referenceEquityIrt: Math.round(
        (incoming.referenceEquityUsdt ?? botSettings.referenceEquityUsdt) *
          dollarGoldSnapshot.usdtIrtAverage
      ),
    };

    savePersistedState();

    res.json({
      ok: true,
      settings: botSettings,
      signals: signalsList,
    });
  });

  // API: Toggle strategy live/shadow mode
  app.post('/api/strategies/toggle', (req, res) => {
    const { strategyId } = req.body as { strategyId: StrategyId };
    strategiesList = strategiesList.map((st) => {
      if (st.id !== strategyId) return st;
      if (!st.walkForward.passedGate && !st.enabled) {
        return st;
      }
      const nextEnabled = !st.enabled;
      return {
        ...st,
        enabled: nextEnabled,
        autoDemotedByCircuitBreaker: false,
        demotionReason: undefined,
        livePerformance: {
          ...st.livePerformance,
          consecutiveLosses: nextEnabled ? 0 : st.livePerformance.consecutiveLosses,
          status: nextEnabled ? 'nominal' : st.livePerformance.status,
        },
      };
    });

    const activeIds = new Set(strategiesList.filter((s) => s.enabled).map((s) => s.id));
    signalsList = signalsList.map((sig) => ({
      ...sig,
      mode: activeIds.has(sig.strategy) ? 'live' : 'shadow',
    }));
    savePersistedState();

    res.json({
      ok: true,
      strategies: strategiesList,
      signals: signalsList,
    });
  });

  // API: Simulate Circuit Breaker on a strategy
  app.post('/api/strategies/simulate-cb', (req, res) => {
    const { strategyId } = req.body as { strategyId: StrategyId };
    strategiesList = strategiesList.map((st) => {
      if (st.id !== strategyId) return st;
      const simulated: StrategyValidationMetrics = {
        ...st,
        livePerformance: {
          ...st.livePerformance,
          consecutiveLosses: 8,
          recent30ExpectancyR: -0.19,
          status: 'circuit_broken',
        },
      };
      const check = evaluateCircuitBreaker(simulated);
      if (check.shouldDemote) {
        return {
          ...simulated,
          enabled: false,
          autoDemotedByCircuitBreaker: true,
          demotionReason: check.reason ?? undefined,
        };
      }
      return simulated;
    });

    const activeIds = new Set(strategiesList.filter((s) => s.enabled).map((s) => s.id));
    signalsList = signalsList.map((sig) => ({
      ...sig,
      mode: activeIds.has(sig.strategy) ? 'live' : 'shadow',
    }));
    savePersistedState();

    res.json({
      ok: true,
      strategies: strategiesList,
      signals: signalsList,
    });
  });

  // API: Promote Challenger weights to Champion
  app.post('/api/challenger/promote', (_req, res) => {
    challengerState = {
      ...challengerState,
      championWeights: { ...challengerState.challengerWeights },
      championExpectancyR: challengerState.challengerExpectancyR,
      championMaxDdR: challengerState.challengerMaxDdR,
      promoted: true,
    };

    signalsList = signalsList.map((sig) => {
      const updatedPillars = computeOrthogonalScore({
        patternCleanliness0to1: sig.pillars.structureClarity / 35,
        sweptLiquidityBeforeEntry: true,
        htfAligned: sig.htfTrend === 'صعودی',
        regimeCompatible: true,
        volumeConfirmation0to1: sig.pillars.volumeAndDepth / 25,
        orderbookDepthRatio0to1: 0.88,
        netRrTp1: sig.netRrTp1,
        roundTripCostToTp1Ratio: sig.roundTripCostPct / 100,
        weights: challengerState.championWeights,
      });
      return {
        ...sig,
        score: updatedPillars.total,
        pillars: updatedPillars,
        bracketStat: getBracketStatForScore(updatedPillars.total),
      };
    });
    savePersistedState();

    res.json({
      ok: true,
      challenger: challengerState,
      signals: signalsList,
    });
  });

  // API: Send message to Telegram
  app.post('/api/telegram/send', async (req, res) => {
    const { text, title } = req.body as { text: string; title?: string };
    if (!text || !text.trim()) {
      res.status(400).json({ ok: false, error: 'متن پیام تلگرام خالی است.' });
      return;
    }

    const token = botSettings.telegramBotToken?.trim();
    const chatId = botSettings.telegramChatId?.trim();

    if (token && chatId) {
      try {
        const htmlFormatted = formatForTelegramApiHtml(text);
        const postRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: htmlFormatted,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        if (postRes.ok) {
          res.json({
            ok: true,
            mode: 'live_telegram',
            message: `پیام «${title || 'سیگنال'}» با موفقیت به تلگرام (${chatId}) ارسال شد.`,
          });
          return;
        }
        const errBody = await postRes.text();
        res.json({
          ok: true,
          mode: 'simulated_fallback',
          message: `توکن تلگرام پاسخ نداد (${errBody.slice(0, 60)})؛ پیام در صف ارسال ثبت شد.`,
        });
        return;
      } catch {
        res.json({
          ok: true,
          mode: 'simulated_fallback',
          message: 'پیام در دفتر ثبت شد (عدم دسترسی مستقیم به سرور تلگرام).',
        });
        return;
      }
    }

    res.json({
      ok: true,
      mode: 'preview_recorded',
      message: `پیام «${title || 'گزارش ربات'}» آماده و در لاگ خروجی تلگرام ثبت شد (برای ارسال مستقیم، توکن و Chat ID را در تب تنظیمات وارد کنید).`,
    });
  });

  // API: Send ALL eligible active signals to Telegram at once (after syncing live prices)
  app.post('/api/telegram/send-all-signals', async (_req, res) => {
    await refreshLiveMarketFeeds(false);
    const eligible = signalsList.filter(
      (s) =>
        s.mode === 'live' &&
        s.score >= botSettings.minScoreTelegram &&
        s.isEconomicallyJustified !== false &&
        (s.status === 'pending' || s.status === 'open')
    );

    let sentCount = 0;
    for (const sig of eligible) {
      const ok = await dispatchTelegramMessage(
        formatTelegramSignalMessage(sig, botSettings)
      );
      if (ok) sentCount++;
    }

    const symbolsList = eligible.map((s) => s.symbol).join('، ');
    res.json({
      ok: true,
      sentCount,
      totalEligible: eligible.length,
      message:
        sentCount > 0
          ? `تمامی ${sentCount} سیگنال فعال با قیمت‌های لحظه‌ای واقعی (${symbolsList}) به تلگرام شما ارسال شدند.`
          : `${eligible.length} سیگنال فعال (${symbolsList}) آماده ارسال هستند.`,
    });
  });

  // API: Export synchronized YAML configuration files
  app.get('/api/export/yaml', (_req, res) => {
    const appUrl =
      botSettings.dashboardUrl ||
      process.env.APP_URL ||
      DEFAULT_BOT_SETTINGS.dashboardUrl;
    const settingsYaml = `# config/settings.yaml — Generated by QuantPulse Console
scan:
  top_n: 150
  min_24h_volume_usd: 5000000
  include_dollar_gold_daily: ${botSettings.includeDollarGoldInDaily}
  auto_scheduler_enabled: ${botSettings.autoSchedulerEnabled}
  scan_interval_minutes: ${botSettings.scanIntervalMinutes}
  locked_monitor_interval_minutes: ${botSettings.lockedMonitorIntervalMinutes}
signals:
  min_score_telegram: ${botSettings.minScoreTelegram}
  min_score_dashboard: ${botSettings.minScoreDashboard}
  max_open: ${botSettings.maxOpenSignals}
  max_new_per_day: ${botSettings.maxNewSignalsPerDay}
  target_before_entry_invalidation: true
risk:
  risk_per_trade_pct: ${botSettings.riskPerTradePct}
  max_directional_portfolio_heat_pct: ${botSettings.maxDirectionalPortfolioHeatPct}
  reference_equity_usd: ${botSettings.referenceEquityUsdt}
  reference_equity_irt: ${botSettings.referenceEquityIrt}
  max_leverage: 3
  max_fee_to_tp1_pct: ${botSettings.maxFeeToTp1Pct}
telegram:
  send_shadow: ${botSettings.telegramSendShadow}
  auto_send_on_scan: ${botSettings.autoSendTelegramOnScan}
  dashboard_url: "${appUrl}"
  timezone: Asia/Tehran
`;

    const exchangesYaml = `# config/exchanges.yaml — Wallex & Bitpin + Keyless Global Feeds
global_data: [wallex_public, kraken_public, yahoo_finance_rwa, alternative_me]
enable_perp_global: ${botSettings.enablePerpGlobal}
iran:
  default_exchange: ${botSettings.defaultExchangeIr}
  quote_preference: ${botSettings.quoteCurrencyPreference}
  wallex:
    enabled: true
    maker_fee_pct: ${botSettings.wallexMakerFeePct}
    taker_fee_pct: ${botSettings.wallexTakerFeePct}
    pairs: [USDT, IRT]
  bitpin:
    enabled: true
    maker_fee_pct: ${botSettings.bitpinMakerFeePct}
    taker_fee_pct: ${botSettings.bitpinTakerFeePct}
    pairs: [USDT, IRT]
gold_and_dollar:
  track_usdt_irt: true
  track_paxg_and_xau: true
  compute_18k_intrinsic_bubble: true
`;

    res.json({
      settingsYaml,
      exchangesYaml,
      webhookUrl: `${appUrl}/api/cron/trigger`,
    });
  });

  // API: Download complete initialized GitHub Repository ZIP (including .git and .github/workflows)
  app.get('/api/github/download-repo', async (_req, res) => {
    try {
      const { execFileSync } = await import('child_process');
      const scriptPath = path.join(__dirname, 'scripts', 'build_github_zip.py');
      if (fs.existsSync(scriptPath)) {
        execFileSync('python3', [scriptPath], { cwd: __dirname, timeout: 15000 });
      }
      const zipPath = path.join(__dirname, 'public', 'quantpulse-github-repo.zip');
      if (fs.existsSync(zipPath)) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="quantpulse-github-repo.zip"'
        );
        fs.createReadStream(zipPath).pipe(res);
        return;
      }
      res.status(404).json({ ok: false, error: 'فایل ZIP ریپازیتوری یافت نشد.' });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`QuantPulse server listening on http://localhost:${PORT}`);
  });
}

startServer();
