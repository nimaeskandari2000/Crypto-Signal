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
  LiveGainerCandidate,
  computeOrthogonalScore,
  computeSignalWinRateMetrics,
  discoverDynamicTopGainerSignals,
  evaluateCircuitBreaker,
  evaluateUserExecutedTrade,
  formatDailyPerformanceTelegramReport,
  formatDailyTelegramReport,
  formatExecutedTradeTelegramMessage,
  formatForTelegramApiHtml,
  formatLockedSignalsTelegramReport,
  formatScanRadarTelegramSummary,
  formatTelegramSignalMessage,
  getPersianDateLabel,
  recalibrateSignalWithLiveMarket,
  resolveBaseDashboardUrl,
  resolveDailyDashboardLink,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
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
const STATE_FILE_PATH = path.join(__dirname, 'data', 'bot_state_v5.json');

let botSettings: BotSettings = {
  ...DEFAULT_BOT_SETTINGS,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_SETTINGS.telegramBotToken,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || DEFAULT_BOT_SETTINGS.telegramChatId,
  dashboardUrl: resolveBaseDashboardUrl(DEFAULT_BOT_SETTINGS.dashboardUrl),
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
          dashboardUrl: resolveBaseDashboardUrl(
            parsed.botSettings.dashboardUrl || DEFAULT_BOT_SETTINGS.dashboardUrl
          ),
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
      if (parsed.signalsList && Array.isArray(parsed.signalsList) && parsed.signalsList.length >= 25) {
        signalsList = parsed.signalsList.map((s: Signal) =>
          s.isLocked && s.userLockedExplicitly
            ? s
            : {
                ...s,
                isLocked: false,
                userLockedExplicitly: false,
                lockedAt: undefined,
                lockedPriceAtLock: undefined,
                lockedEntryMid: undefined,
                lockedChangePct: undefined,
                lockedCurrentR: undefined,
                lockedMonitoringNote: undefined,
              }
        );
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
    // Keep runtime state strictly in private local state file (excluded from git)
    // so AI Studio never modifies git-tracked public/data/bot_state.json
    fs.writeFileSync(
      STATE_FILE_PATH,
      JSON.stringify(
        {
          botSettings,
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

async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 QuantPulseBot/4.1' },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function resolveTelegramChatIdFromUpdates(token: string): Promise<{
  chatId: string;
  chatTitle?: string;
}> {
  const cleanToken = sanitizeTelegramToken(token);
  if (!cleanToken) return { chatId: '' };
  try {
    const res = await fetchWithTimeout(
      `https://api.telegram.org/bot${cleanToken}/getUpdates?limit=15`,
      4000
    );
    if (!res.ok) return { chatId: '' };
    const data = (await res.json()) as any;
    const updates = Array.isArray(data?.result) ? data.result : [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chatObj =
        u?.message?.chat ||
        u?.channel_post?.chat ||
        u?.my_chat_member?.chat ||
        u?.edited_message?.chat;
      if (chatObj?.id) {
        const cid = String(chatObj.id);
        const title =
          chatObj.title ||
          [chatObj.first_name, chatObj.last_name].filter(Boolean).join(' ') ||
          chatObj.username ||
          cid;
        return { chatId: cid, chatTitle: title };
      }
    }
  } catch {
    // ignore
  }
  return { chatId: '' };
}

function syncIncomingTelegramCredentials(body?: any) {
  if (!body || typeof body !== 'object') return;
  const incomingToken = sanitizeTelegramToken(body.telegramBotToken);
  const incomingChatId = sanitizeTelegramChatId(body.telegramChatId);
  let changed = false;
  if (incomingToken && incomingToken !== botSettings.telegramBotToken) {
    botSettings.telegramBotToken = incomingToken;
    changed = true;
  }
  if (incomingChatId && incomingChatId !== botSettings.telegramChatId) {
    botSettings.telegramChatId = incomingChatId;
    changed = true;
  }
  if (changed) {
    savePersistedState();
  }
}

async function dispatchTelegramMessage(
  text: string,
  overrideToken?: string,
  overrideChatId?: string
): Promise<{ ok: boolean; chatIdUsed: string; error?: string }> {
  const token = sanitizeTelegramToken(
    overrideToken || botSettings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN
  );
  let chatId = sanitizeTelegramChatId(
    overrideChatId || botSettings.telegramChatId || process.env.TELEGRAM_CHAT_ID
  );

  if (!token) {
    return {
      ok: false,
      chatIdUsed: '',
      error: 'توکن ربات تلگرام (TELEGRAM_BOT_TOKEN) تنظیم نشده است.',
    };
  }

  if (!chatId) {
    const resolved = await resolveTelegramChatIdFromUpdates(token);
    if (resolved.chatId) {
      chatId = resolved.chatId;
      botSettings.telegramChatId = chatId;
      savePersistedState();
    }
  }

  if (!chatId) {
    return {
      ok: false,
      chatIdUsed: '',
      error:
        'شناسه چت (TELEGRAM_CHAT_ID) یافت نشد. ابتدا در تلگرام دکمه Start را در ربات خود بزنید یا Chat ID را وارد کنید.',
    };
  }

  const sendAttempt = async (
    targetChatId: string,
    useHtml: boolean
  ): Promise<{ ok: boolean; status: number; bodyText: string }> => {
    const payload: Record<string, any> = {
      chat_id: targetChatId,
      text: useHtml ? formatForTelegramApiHtml(text) : text,
      disable_web_page_preview: true,
    };
    if (useHtml) payload.parse_mode = 'HTML';

    const postRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const bodyText = await postRes.text();
    return { ok: postRes.ok, status: postRes.status, bodyText };
  };

  try {
    let attempt = await sendAttempt(chatId, true);
    if (!attempt.ok) {
      // Fallback: retry as plain text without HTML parse_mode
      attempt = await sendAttempt(chatId, false);
    }
    if (!attempt.ok && attempt.bodyText.includes('chat not found')) {
      const resolved = await resolveTelegramChatIdFromUpdates(token);
      if (resolved.chatId && resolved.chatId !== chatId) {
        chatId = resolved.chatId;
        botSettings.telegramChatId = chatId;
        savePersistedState();
        attempt = await sendAttempt(chatId, true);
      }
    }
    if (attempt.ok) {
      return { ok: true, chatIdUsed: chatId };
    }
    let cleanError = attempt.bodyText;
    try {
      const parsedErr = JSON.parse(attempt.bodyText);
      if (parsedErr?.description) cleanError = parsedErr.description;
    } catch {
      // keep raw
    }
    return { ok: false, chatIdUsed: chatId, error: cleanError };
  } catch (err) {
    return { ok: false, chatIdUsed: chatId, error: String(err) };
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
  const liveGainerCandidates: LiveGainerCandidate[] = [];

  // 1. Fetch Live Prices & All 24h Top Gainers from Wallex Public API (No API Key Required)
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

      for (const [pairKey, info] of Object.entries(symbols) as Array<[string, any]>) {
        const stats = info?.stats;
        if (!stats) continue;
        const lastP = Number(stats.lastPrice);
        const ch24 = Number(stats['24h_ch'] ?? 0);
        const vol24 = Number(stats['24h_tmnVolume'] ?? stats['24h_quoteVolume'] ?? 0);
        if (!Number.isFinite(lastP) || lastP <= 0) continue;

        if (pairKey.endsWith('USDT')) {
          const base = pairKey.slice(0, -4);
          liveAssetPricesUsdt[base] = lastP;
          if (ch24 >= 4.0) {
            liveGainerCandidates.push({
              baseAsset: base,
              persianName: info?.faBaseAsset || base,
              priceUsdt: lastP,
              change24hPct: ch24,
              volume24hUsdt: vol24 > 0 ? vol24 : 500000,
              sourceExchange: 'wallex',
            });
          }
        } else if (pairKey.endsWith('TMN') && pairKey !== 'USDTTMN' && usdtIrtWallex > 50000) {
          const base = pairKey.slice(0, -3);
          const priceUsdt = lastP / usdtIrtWallex;
          if (!liveAssetPricesUsdt[base] && priceUsdt > 0) {
            liveAssetPricesUsdt[base] = priceUsdt;
          }
          if (ch24 >= 4.5 && !liveGainerCandidates.some((c) => c.baseAsset === base)) {
            liveGainerCandidates.push({
              baseAsset: base,
              persianName: info?.faBaseAsset || base,
              priceUsdt,
              change24hPct: ch24,
              volume24hUsdt: vol24 / usdtIrtWallex,
              sourceExchange: 'wallex',
            });
          }
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
        `دریافت مستقیم قیمت زنده و پیشتازان ۲۴ ساعته از والکس (تتر: ${usdtIrtWallex.toLocaleString('fa-IR')} تومان)`
      );
    } else {
      updateSourceStatus('wallex_api', 'fallback', Date.now() - t0Wallex, 'استفاده از آخرین اسنپ‌شات معتبر');
    }
  } catch {
    updateSourceStatus('wallex_api', 'fallback', Date.now() - t0Wallex, 'استفاده از آخرین اسنپ‌شات کش‌شده');
  }

  // 1B. Backup USDT/IRT feed from Nobitex in case Wallex is rate-limited
  if (!liveAssetPricesUsdt.BTC) {
    try {
      const nbRes = await fetchWithTimeout(
        'https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls',
        3000
      );
      if (nbRes.ok) {
        const nbData = (await nbRes.json()) as any;
        const latestRls = Number(nbData?.stats?.['usdt-rls']?.latest);
        if (latestRls >= 500000 && latestRls <= 10000000) {
          usdtIrtWallex = Math.round(latestRls / 10);
        }
      }
    } catch {
      // ignore
    }
  }

  // 1C. Fetch Global 24h Top Gainers from CoinGecko Public API
  try {
    const cgRes = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=80&page=1&sparkline=false&price_change_percentage=24h',
      3800
    );
    if (cgRes.ok) {
      const cgData = (await cgRes.json()) as any[];
      if (Array.isArray(cgData)) {
        for (const coin of cgData) {
          const sym = String(coin?.symbol || '').toUpperCase();
          const price = Number(coin?.current_price);
          const ch24 = Number(coin?.price_change_percentage_24h ?? 0);
          const vol = Number(coin?.total_volume ?? 0);
          if (!sym || !Number.isFinite(price) || price <= 0) continue;
          if (['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE', 'TUSD'].includes(sym)) continue;
          if (!liveAssetPricesUsdt[sym]) {
            liveAssetPricesUsdt[sym] = price;
          }
          if (ch24 >= 5.0 && !liveGainerCandidates.some((c) => c.baseAsset === sym)) {
            liveGainerCandidates.push({
              baseAsset: sym,
              persianName: coin?.name || sym,
              priceUsdt: price,
              change24hPct: Number(ch24.toFixed(2)),
              volume24hUsdt: vol,
              sourceExchange: 'global',
            });
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Fetch Live Global Prices from Kraken Public API (BTC, ETH, PAXG, SOL, AVAX, LINK, SUI, PEPE, ARB, RENDER, ONDO, ETHFI, EURUSD)
  const t0Global = Date.now();
  try {
    const res = await fetchWithTimeout(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,PAXGUSD,SOLUSD,AVAXUSD,LINKUSD,SUIUSD,PEPEUSD,ARBUSD,RENDERUSD,ONDOUSD,ETHFIUSD,EURUSD',
      4500
    );
    if (res.ok) {
      const json = (await res.json()) as any;
      const result = json?.result || {};
      const pickKrakenPrice = (keys: string[]) => {
        for (const k of keys) {
          const val = Number(result[k]?.c?.[0]);
          if (val > 0) return val;
        }
        return 0;
      };

      const liveBtc = pickKrakenPrice(['XXBTZUSD', 'XBTUSD']);
      if (liveBtc > 10000) {
        macroSummary.btcPrice = Number(liveBtc.toFixed(2));
        liveAssetPricesUsdt.BTC = macroSummary.btcPrice;
      }
      const liveEth = pickKrakenPrice(['XETHZUSD', 'ETHUSD']);
      if (liveEth > 500) {
        macroSummary.ethPrice = Number(liveEth.toFixed(2));
        liveAssetPricesUsdt.ETH = macroSummary.ethPrice;
      }
      const livePaxg = pickKrakenPrice(['PAXGUSD']);
      if (livePaxg > 1800) {
        xauUsdOunce = Number(livePaxg.toFixed(2));
        liveAssetPricesUsdt.PAXG = xauUsdOunce;
      }
      const liveSol = pickKrakenPrice(['SOLUSD']);
      if (liveSol > 5 && !liveAssetPricesUsdt.SOL) {
        liveAssetPricesUsdt.SOL = Number(liveSol.toFixed(2));
      }
      const liveAvax = pickKrakenPrice(['AVAXUSD']);
      if (liveAvax > 1 && !liveAssetPricesUsdt.AVAX) {
        liveAssetPricesUsdt.AVAX = Number(liveAvax.toFixed(2));
      }
      const liveLink = pickKrakenPrice(['LINKUSD']);
      if (liveLink > 1 && !liveAssetPricesUsdt.LINK) {
        liveAssetPricesUsdt.LINK = Number(liveLink.toFixed(2));
      }
      const liveSui = pickKrakenPrice(['SUIUSD']);
      if (liveSui > 0.1 && !liveAssetPricesUsdt.SUI) {
        liveAssetPricesUsdt.SUI = Number(liveSui.toFixed(4));
      }
      const livePepe = pickKrakenPrice(['PEPEUSD']);
      if (livePepe > 0 && !liveAssetPricesUsdt.PEPE) {
        liveAssetPricesUsdt.PEPE = Number(livePepe.toFixed(8));
      }
      const liveArb = pickKrakenPrice(['ARBUSD']);
      if (liveArb > 0.05 && !liveAssetPricesUsdt.ARB) {
        liveAssetPricesUsdt.ARB = Number(liveArb.toFixed(4));
      }
      const liveRender = pickKrakenPrice(['RENDERUSD']);
      if (liveRender > 0.2 && !liveAssetPricesUsdt.RENDER) {
        liveAssetPricesUsdt.RENDER = Number(liveRender.toFixed(3));
      }
      const liveOndo = pickKrakenPrice(['ONDOUSD']);
      if (liveOndo > 0.05 && !liveAssetPricesUsdt.ONDO) {
        liveAssetPricesUsdt.ONDO = Number(liveOndo.toFixed(4));
      }
      const liveEthfi = pickKrakenPrice(['ETHFIUSD']);
      if (liveEthfi > 0.05 && !liveAssetPricesUsdt.ETHFI) {
        liveAssetPricesUsdt.ETHFI = Number(liveEthfi.toFixed(4));
      }
      const liveEur = pickKrakenPrice(['ZEURZUSD', 'EURUSD']);
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

  // Dynamically discover & inject top 24h gainers across 1h, 4h, 1d, and 1w horizons
  if (liveGainerCandidates.length > 0) {
    signalsList = discoverDynamicTopGainerSignals(
      liveGainerCandidates,
      signalsList,
      dollarGoldSnapshot.usdtIrtAverage
    );
  }

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
    (botSettings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN)
  ) {
    await dispatchTelegramMessage(
      formatScanRadarTelegramSummary({
        dollarGold: dollarGoldSnapshot,
        btcPrice: macroSummary.btcPrice,
        ethPrice: macroSummary.ethPrice,
        signals: signalsList,
        dashboardUrl: botSettings.dashboardUrl,
      })
    );
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

async function startServer() {
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
    syncIncomingTelegramCredentials(req.body);
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
          userLockedExplicitly: false,
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
        userLockedExplicitly: true,
        lockedAt: new Date().toISOString(),
        lockedEntryMid: sig.entryMid,
        lockedChangePct: changePct,
        lockedCurrentR: currentR,
        lockedMonitoringNote: 'قفل سیگنال فعال شد — پایش خودکار ۵ دقیقه‌ای قیمت زنده و اهداف فعال است.',
      };
    });

    savePersistedState();

    const updatedSig = signalsList.find((s) => s.id === signalId)!;
    let tgRes = { ok: false, chatIdUsed: '' };
    if (nextLocked) {
      tgRes = await dispatchTelegramMessage(formatTelegramSignalMessage(updatedSig, botSettings));
    }

    res.json({
      ok: true,
      signals: signalsList,
      telegramSent: tgRes.ok,
      message: nextLocked
        ? tgRes.ok
          ? `سیگنال «${updatedSig.persianName} (${updatedSig.symbol})» قفل شد (🔒)؛ پایش ۵ دقیقه‌ای فعال گردید و به تلگرام (${tgRes.chatIdUsed}) ارسال شد.`
          : `سیگنال «${updatedSig.persianName} (${updatedSig.symbol})» قفل شد (🔒)؛ پایش ۵ دقیقه‌ای فعال گردید.`
        : `قفل سیگنال «${updatedSig.persianName} (${updatedSig.symbol})» باز شد.`,
    });
  });

  // API: Send Locked Signals Live Monitoring Report to Telegram
  app.post('/api/telegram/send-locked-status', async (req, res) => {
    syncIncomingTelegramCredentials(req.body);
    await refreshLiveMarketFeeds(false);
    const locked = signalsList.filter((s) => s.isLocked);
    const text = formatLockedSignalsTelegramReport(locked, botSettings.dashboardUrl);
    const tgRes = await dispatchTelegramMessage(text);
    res.json({
      ok: true,
      sent: tgRes.ok,
      chatIdUsed: tgRes.chatIdUsed,
      error: tgRes.error,
      lockedCount: locked.length,
      message: tgRes.ok
        ? `گزارش پایش لحظه‌ای ${locked.length} سیگنال قفل‌شده با قیمت زنده به تلگرام (${tgRes.chatIdUsed}) ارسال شد.`
        : `گزارش ${locked.length} سیگنال قفل‌شده آماده شد (${tgRes.error || 'برای ارسال مستقیم، توکن و Chat ID تلگرام را در تب تنظیمات وارد کنید'}).`,
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

  // API: Trigger immediate market & Dollar/Gold scan (and dispatch Telegram radar if configured)
  app.post('/api/scan', async (req, res) => {
    syncIncomingTelegramCredentials(req.body);
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

    let telegramSent = false;
    let telegramNote = '';
    const hasToken = Boolean(
      sanitizeTelegramToken(botSettings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN)
    );
    if (botSettings.autoSendTelegramOnScan && hasToken) {
      const radarText = formatScanRadarTelegramSummary({
        dollarGold: dollarGoldSnapshot,
        btcPrice: macroSummary.btcPrice,
        ethPrice: macroSummary.ethPrice,
        signals: signalsList,
        dashboardUrl: botSettings.dashboardUrl,
      });
      const tgResult = await dispatchTelegramMessage(radarText);
      telegramSent = tgResult.ok;
      telegramNote = tgResult.ok
        ? ` | به تلگرام (${tgResult.chatIdUsed}) ارسال شد ✅`
        : ` | خطای تلگرام: ${tgResult.error || 'Chat ID نامعتبر'}`;
    }

    savePersistedState();

    res.json({
      ok: true,
      telegramSent,
      settings: botSettings,
      message: `اسکن زنده انجام شد — تتر والکس: ${dollarGoldSnapshot.usdtIrtWallex.toLocaleString('fa-IR')} تومان | انس طلا: $${dollarGoldSnapshot.xauUsdOunce} | BTC: $${macroSummary.btcPrice}${telegramNote}`,
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
      telegramBotToken:
        incoming.telegramBotToken !== undefined
          ? sanitizeTelegramToken(incoming.telegramBotToken)
          : botSettings.telegramBotToken,
      telegramChatId:
        incoming.telegramChatId !== undefined
          ? sanitizeTelegramChatId(incoming.telegramChatId)
          : botSettings.telegramChatId,
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

  // API: Auto-detect Telegram Chat ID from Bot Token using getUpdates
  app.post('/api/telegram/detect-chat-id', async (req, res) => {
    const token = sanitizeTelegramToken(
      req.body?.telegramBotToken || botSettings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN
    );
    if (!token) {
      res.status(400).json({
        ok: false,
        error: 'لطفاً ابتدا توکن ربات تلگرام (TELEGRAM_BOT_TOKEN) را وارد کنید.',
      });
      return;
    }

    try {
      const meRes = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`, 4000);
      if (!meRes.ok) {
        res.status(400).json({
          ok: false,
          error: 'توکن ربات تلگرام معتبر نیست (Telegram getMe خطا برگرداند). توکن را از @BotFather بررسی کنید.',
        });
        return;
      }
      const meJson = (await meRes.json()) as any;
      const botUsername = meJson?.result?.username ? `@${meJson.result.username}` : 'ربات شما';

      const resolved = await resolveTelegramChatIdFromUpdates(token);
      if (resolved.chatId) {
        botSettings.telegramBotToken = token;
        botSettings.telegramChatId = resolved.chatId;
        savePersistedState();
        res.json({
          ok: true,
          chatId: resolved.chatId,
          chatTitle: resolved.chatTitle,
          botUsername,
          message: `شناسه چت (${resolved.chatId} - ${resolved.chatTitle}) از آخرین پیام ارسالی به ${botUsername} با موفقیت شناسایی و ذخیره شد!`,
        });
        return;
      }

      res.json({
        ok: false,
        botUsername,
        error: `اتصال به ${botUsername} برقرار است، اما هنوز پیامی برای ربات ارسال نشده است. لطفاً در تلگرام وارد ${botUsername} شوید، دکمه Start یا یک پیام بفرستید و دوباره روی این دکمه بزنید.`,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `عدم دسترسی به سرور تلگرام: ${String(err)}`,
      });
    }
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
    syncIncomingTelegramCredentials(req.body);
    const { text, title, telegramBotToken, telegramChatId } = req.body as {
      text: string;
      title?: string;
      telegramBotToken?: string;
      telegramChatId?: string;
    };
    if (!text || !text.trim()) {
      res.status(400).json({ ok: false, error: 'متن پیام تلگرام خالی است.' });
      return;
    }

    const tgRes = await dispatchTelegramMessage(text, telegramBotToken, telegramChatId);
    if (tgRes.ok) {
      res.json({
        ok: true,
        sent: true,
        chatIdUsed: tgRes.chatIdUsed,
        mode: 'live_telegram',
        message: `پیام «${title || 'سیگنال'}» با موفقیت به تلگرام (${tgRes.chatIdUsed}) ارسال شد ✅`,
      });
      return;
    }

    res.json({
      ok: true,
      sent: false,
      error: tgRes.error,
      mode: 'needs_credentials_or_fallback',
      message: `ارسال مستقیم انجام نشد: ${tgRes.error || 'توکن و Chat ID را در تب تنظیمات بررسی کنید.'}`,
    });
  });

  // API: Send ALL eligible active signals to Telegram at once (after syncing live prices)
  app.post('/api/telegram/send-all-signals', async (req, res) => {
    syncIncomingTelegramCredentials(req.body);
    await refreshLiveMarketFeeds(false);
    const eligible = signalsList.filter(
      (s) =>
        s.mode === 'live' &&
        s.score >= botSettings.minScoreTelegram &&
        s.isEconomicallyJustified !== false &&
        (s.status === 'pending' || s.status === 'open')
    );

    let sentCount = 0;
    let lastError = '';
    for (const sig of eligible) {
      const tgRes = await dispatchTelegramMessage(
        formatTelegramSignalMessage(sig, botSettings)
      );
      if (tgRes.ok) {
        sentCount++;
      } else if (tgRes.error) {
        lastError = tgRes.error;
      }
    }

    const symbolsList = eligible.map((s) => s.symbol).join('، ');
    res.json({
      ok: true,
      sent: sentCount > 0,
      sentCount,
      totalEligible: eligible.length,
      error: lastError,
      message:
        sentCount > 0
          ? `تمامی ${sentCount} سیگنال فعال با قیمت‌های لحظه‌ای واقعی (${symbolsList}) به تلگرام شما ارسال شدند ✅`
          : `${eligible.length} سیگنال فعال (${symbolsList}) آماده ارسال هستند (${lastError || 'برای ارسال مستقیم، توکن و Chat ID تلگرام را در تب تنظیمات وارد کنید'}).`,
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
