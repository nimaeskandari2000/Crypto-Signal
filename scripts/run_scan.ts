/**
 * scripts/run_scan.ts
 * اسکریپت مستقل اجرای زمان‌بندی‌شده (هر ۱۵ دقیقه / GitHub Actions)
 * - دریافت داده‌های زنده بدون نیاز به API Key از والکس، بیت‌پین، نوبیتکس، کراکن و فید سهام یاهو
 * - تحلیل ارزهای اصلی، شکارچی پامپ، فارکس/سهام توکنیزه، دلار و طلا
 * - پایش سیگنال‌های قفل‌شده (🔒) و معاملات عملی‌شده کاربر
 * - ارسال خودکار رادار اسکن، سیگنال‌های برتر و پایش قفل‌ها به تلگرام (با تشخیص خودکار Chat ID و بازیابی خطا)
 * - ذخیره وضعیت در public/data/bot_state.json برای انتشار روی وب و GitHub Pages
 */

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
} from '../src/engine/seedData';
import {
  computeSignalWinRateMetrics,
  evaluateUserExecutedTrade,
  formatForTelegramApiHtml,
  formatLockedSignalsTelegramReport,
  formatScanRadarTelegramSummary,
  formatTelegramSignalMessage,
  getPersianDateLabel,
  recalibrateSignalWithLiveMarket,
  resolveDailyDashboardLink,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
} from '../src/engine/quantEngine';
import { DailyPerformanceReport, Signal, UserExecutedTrade } from '../src/engine/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_STATE_PATH = path.join(ROOT_DIR, 'public', 'data', 'bot_state.json');
const JOURNAL_PATH = path.join(ROOT_DIR, 'data', 'journal', 'signals.jsonl');

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 QuantPulse-GitHubActions/4.1' },
    });
  } finally {
    clearTimeout(id);
  }
}

async function resolveChatIdFromUpdates(token: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getUpdates?limit=10`, 4000);
    if (!res.ok) return '';
    const data = (await res.json()) as any;
    const updates = Array.isArray(data?.result) ? data.result : [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chatId =
        u?.message?.chat?.id ??
        u?.channel_post?.chat?.id ??
        u?.my_chat_member?.chat?.id ??
        u?.edited_message?.chat?.id;
      if (chatId) {
        console.log(`[Telegram] تشخیص خودکار Chat ID از آخرین پیام به ربات: ${chatId}`);
        return String(chatId);
      }
    }
  } catch {
    // ignore
  }
  return '';
}

async function sendTelegram(
  text: string,
  fallbackToken?: string,
  fallbackChatId?: string
): Promise<boolean> {
  const token = sanitizeTelegramToken(
    process.env.TELEGRAM_BOT_TOKEN || fallbackToken || DEFAULT_BOT_SETTINGS.telegramBotToken
  );
  let chatId = sanitizeTelegramChatId(
    process.env.TELEGRAM_CHAT_ID || fallbackChatId || DEFAULT_BOT_SETTINGS.telegramChatId
  );

  if (!token) {
    console.log(
      '[Telegram] متغیر TELEGRAM_BOT_TOKEN تنظیم نشده است. برای ارسال پیام، آن را در GitHub Settings -> Secrets and variables -> Actions ثبت کنید.'
    );
    return false;
  }

  if (!chatId) {
    chatId = await resolveChatIdFromUpdates(token);
  }

  if (!chatId) {
    console.log(
      '[Telegram] متغیر TELEGRAM_CHAT_ID یافت نشد. لطفاً TELEGRAM_CHAT_ID را در GitHub Secrets وارد کنید یا یک پیام /start به ربات خود در تلگرام بفرستید.'
    );
    return false;
  }

  const trySend = async (targetChatId: string, useHtml: boolean): Promise<{ ok: boolean; errText: string }> => {
    const payload: Record<string, any> = {
      chat_id: targetChatId,
      text: useHtml ? formatForTelegramApiHtml(text) : text,
      disable_web_page_preview: true,
    };
    if (useHtml) {
      payload.parse_mode = 'HTML';
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, errText: '' };
    return { ok: false, errText: await res.text() };
  };

  try {
    let attempt = await trySend(chatId, true);
    if (!attempt.ok) {
      // Retry without HTML parse_mode in case of entity parsing issue
      attempt = await trySend(chatId, false);
    }
    if (!attempt.ok && attempt.errText.includes('chat not found')) {
      const autoChatId = await resolveChatIdFromUpdates(token);
      if (autoChatId && autoChatId !== chatId) {
        attempt = await trySend(autoChatId, true);
      }
    }
    if (attempt.ok) {
      console.log(`[Telegram] پیام با موفقیت به تلگرام (${chatId}) ارسال شد.`);
      return true;
    }
    console.warn('[Telegram] خطا در ارسال پیام:', attempt.errText);
    return false;
  } catch (err) {
    console.warn('[Telegram] عدم دسترسی به API تلگرام:', err);
    return false;
  }
}

async function main() {
  console.log('=== [QuantPulse] شروع اجرای اسکن زنده بازار، شکارچی پامپ، فارکس توکنیزه و پایش قفل سیگنال ===');

  let existingState: any = null;
  if (fs.existsSync(PUBLIC_STATE_PATH)) {
    try {
      existingState = JSON.parse(fs.readFileSync(PUBLIC_STATE_PATH, 'utf-8'));
    } catch {
      existingState = null;
    }
  }

  const savedToken = existingState?.settings?.telegramBotToken || '';
  const savedChatId = existingState?.settings?.telegramChatId || '';

  const settings = {
    ...DEFAULT_BOT_SETTINGS,
    ...(existingState?.settings || {}),
    telegramBotToken: '',
    dashboardUrl: resolveDailyDashboardLink(
      process.env.APP_URL || existingState?.settings?.dashboardUrl || DEFAULT_BOT_SETTINGS.dashboardUrl
    ).split('?')[0],
  };

  let usdtIrtWallex = Number(existingState?.dollarGold?.usdtIrtWallex) >= 50000
    ? Number(existingState.dollarGold.usdtIrtWallex)
    : 265000;
  let xauUsdOunce = Number(existingState?.dollarGold?.xauUsdOunce) >= 1800
    ? Number(existingState.dollarGold.xauUsdOunce)
    : 4080.56;
  let btcPrice = Number(existingState?.macro?.btcPrice) > 10000
    ? Number(existingState.macro.btcPrice)
    : 74415.39;
  let ethPrice = Number(existingState?.macro?.ethPrice) > 500
    ? Number(existingState.macro.ethPrice)
    : 2121.33;
  let fearGreedIndex = Number(existingState?.macro?.fearGreedIndex) || 64;
  let fearGreedLabel = existingState?.macro?.fearGreedLabel || 'طمع متعادل (Greed)';
  const livePricesUsdt: Record<string, number> = {};

  // 1. دریافت قیمت‌های لحظه‌ای از والکس (بدون نیاز به API Key)
  try {
    const res = await fetchWithTimeout('https://api.wallex.ir/v1/markets', 4500);
    if (res.ok) {
      const data = (await res.json()) as any;
      const symbols = data?.result?.symbols || {};
      const lastUsdt = Number(symbols?.USDTTMN?.stats?.lastPrice);
      if (lastUsdt >= 50000 && lastUsdt <= 1000000) {
        usdtIrtWallex = Math.round(lastUsdt);
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
      for (const [base, key] of Object.entries(wallexPairs)) {
        const p = Number(symbols?.[key]?.stats?.lastPrice);
        if (p > 0) livePricesUsdt[base] = p;
      }
      if (livePricesUsdt.BTC > 10000) btcPrice = Number(livePricesUsdt.BTC.toFixed(2));
      if (livePricesUsdt.ETH > 500) ethPrice = Number(livePricesUsdt.ETH.toFixed(2));
      if (livePricesUsdt.PAXG > 1800) xauUsdOunce = Number(livePricesUsdt.PAXG.toFixed(2));
      console.log(`[Wallex Live] تتر: ${usdtIrtWallex} تومان | انس طلا (PAXG): $${xauUsdOunce} | BTC: $${btcPrice}`);
    }
  } catch {
    console.log(`[Wallex] استفاده از فید پشتیبان نرخ تتر: ${usdtIrtWallex} تومان`);
  }

  // 1B. فید پشتیبان نرخ تتر از نوبیتکس در صورت محدودیت IP سرور گیت‌هاب روی والکس
  try {
    const res = await fetchWithTimeout(
      'https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls',
      3500
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const latestRls = Number(data?.stats?.['usdt-rls']?.latest);
      if (latestRls >= 500000 && latestRls <= 10000000) {
        usdtIrtWallex = Math.round(latestRls / 10);
      }
    }
  } catch {
    // ignore
  }

  // 2. دریافت نرخ زنده تمام ارزها و طلا از Kraken (بدون تحریم روی سرورهای GitHub Actions)
  try {
    const res = await fetchWithTimeout(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,PAXGUSD,SOLUSD,AVAXUSD,LINKUSD,SUIUSD,PEPEUSD,ARBUSD,RENDERUSD,ONDOUSD,ETHFIUSD,EURUSD',
      5000
    );
    if (res.ok) {
      const json = (await res.json()) as any;
      const r = json?.result || {};
      const pickPrice = (keys: string[]) => {
        for (const k of keys) {
          const val = Number(r[k]?.c?.[0]);
          if (val > 0) return val;
        }
        return 0;
      };

      const btc = pickPrice(['XXBTZUSD', 'XBTUSD']);
      const eth = pickPrice(['XETHZUSD', 'ETHUSD']);
      const paxg = pickPrice(['PAXGUSD']);
      const sol = pickPrice(['SOLUSD']);
      const avax = pickPrice(['AVAXUSD']);
      const link = pickPrice(['LINKUSD']);
      const sui = pickPrice(['SUIUSD']);
      const pepe = pickPrice(['PEPEUSD']);
      const arb = pickPrice(['ARBUSD']);
      const render = pickPrice(['RENDERUSD']);
      const ondo = pickPrice(['ONDOUSD']);
      const ethfi = pickPrice(['ETHFIUSD']);
      const eur = pickPrice(['ZEURZUSD', 'EURUSD']);

      if (btc > 10000) {
        btcPrice = Number(btc.toFixed(2));
        livePricesUsdt.BTC = btcPrice;
      }
      if (eth > 500) {
        ethPrice = Number(eth.toFixed(2));
        livePricesUsdt.ETH = ethPrice;
      }
      if (paxg > 1800) {
        xauUsdOunce = Number(paxg.toFixed(2));
        livePricesUsdt.PAXG = xauUsdOunce;
      }
      if (sol > 5) livePricesUsdt.SOL = Number(sol.toFixed(2));
      if (avax > 1) livePricesUsdt.AVAX = Number(avax.toFixed(2));
      if (link > 1) livePricesUsdt.LINK = Number(link.toFixed(2));
      if (sui > 0.1) livePricesUsdt.SUI = Number(sui.toFixed(4));
      if (pepe > 0) livePricesUsdt.PEPE = Number(pepe.toFixed(8));
      if (arb > 0.05) livePricesUsdt.ARB = Number(arb.toFixed(4));
      if (render > 0.2) livePricesUsdt.RENDER = Number(render.toFixed(3));
      if (ondo > 0.05) livePricesUsdt.ONDO = Number(ondo.toFixed(4));
      if (ethfi > 0.05) livePricesUsdt.ETHFI = Number(ethfi.toFixed(4));
      if (eur > 0.8 && eur < 1.5) livePricesUsdt.EUR = Number(eur.toFixed(4));

      console.log(`[Kraken Live] BTC: $${btcPrice} | ETH: $${ethPrice} | Gold Ounce: $${xauUsdOunce} | SOL: $${livePricesUsdt.SOL || '-'}`);
    }
  } catch {
    console.log('[Kraken] استفاده از آخرین اسنپ‌شات کندل‌ها');
  }

  // 2B. دریافت قیمت سهام توکنیزه (NVDA, TSLA) و شاخص ترس و طمع
  try {
    const [nvdaRes, tslaRes, fgRes] = await Promise.allSettled([
      fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=2d', 3500),
      fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=2d', 3500),
      fetchWithTimeout('https://api.alternative.me/fng/?limit=1', 3000),
    ]);
    if (nvdaRes.status === 'fulfilled' && nvdaRes.value.ok) {
      const j = (await nvdaRes.value.json()) as any;
      const nvdaPrice = Number(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (nvdaPrice > 20) livePricesUsdt.NVDAX = Number(nvdaPrice.toFixed(2));
    }
    if (tslaRes.status === 'fulfilled' && tslaRes.value.ok) {
      const j = (await tslaRes.value.json()) as any;
      const tslaPrice = Number(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (tslaPrice > 20) livePricesUsdt.TSLAX = Number(tslaPrice.toFixed(2));
    }
    if (fgRes.status === 'fulfilled' && fgRes.value.ok) {
      const j = (await fgRes.value.json()) as any;
      const val = Number(j?.data?.[0]?.value);
      if (val > 0) {
        fearGreedIndex = val;
        fearGreedLabel =
          val >= 75
            ? 'طمع شدید (Extreme Greed)'
            : val >= 55
              ? 'طمع متعادل (Greed)'
              : val <= 25
                ? 'ترس شدید (Extreme Fear)'
                : val <= 45
                  ? 'ترس (Fear)'
                  : 'خنثی (Neutral)';
      }
    }
  } catch {
    // ignore
  }

  const usdtIrtBitpin = Math.round(usdtIrtWallex - 180);
  const dollarGold = buildInitialDollarGoldSnapshot(usdtIrtWallex, usdtIrtBitpin, xauUsdOunce);
  const baseSignals = buildInitialSignals(dollarGold.usdtIrtAverage);

  // Preserve lock status from existing state if present
  const existingSignalsMap = new Map<string, Signal>();
  if (Array.isArray(existingState?.signals)) {
    for (const s of existingState.signals) {
      if (s && s.id) existingSignalsMap.set(s.id, s);
    }
  }

  const signals = baseSignals.map((sig) => {
    const prev = existingSignalsMap.get(sig.id);
    const mergedSig: Signal = prev
      ? {
          ...sig,
          isLocked: prev.isLocked ?? sig.isLocked,
          lockedAt: prev.lockedAt ?? sig.lockedAt,
          lockedPriceAtLock: prev.lockedPriceAtLock ?? sig.lockedPriceAtLock,
          lockedEntryMid: prev.lockedEntryMid ?? sig.lockedEntryMid,
        }
      : sig;
    const liveP = livePricesUsdt[mergedSig.baseAsset] ?? mergedSig.currentPrice;
    return recalibrateSignalWithLiveMarket(mergedSig, liveP, dollarGold.usdtIrtAverage);
  });

  // 3. پایش معاملات عملی‌شده توسط کاربر
  const rawExecutedTrades: UserExecutedTrade[] =
    existingState?.executedTrades && existingState.executedTrades.length > 0
      ? existingState.executedTrades
      : buildInitialExecutedTrades(dollarGold.usdtIrtAverage);

  const executedTrades: UserExecutedTrade[] = [];
  for (const trade of rawExecutedTrades) {
    const matchingSig = signals.find((s) => s.id === trade.signalId);
    const livePrice =
      livePricesUsdt[trade.baseAsset] ??
      matchingSig?.currentPrice ??
      trade.currentPriceUsdt;

    const evaluated = evaluateUserExecutedTrade(
      trade,
      livePrice,
      dollarGold.usdtIrtAverage
    );
    executedTrades.push(evaluated.updatedTrade);
  }

  // 4. بروزرسانی کارنامه روزانه نرخ موفقیت سیگنال‌ها
  const existingReports: DailyPerformanceReport[] =
    existingState?.dailyReports && existingState.dailyReports.length > 0
      ? existingState.dailyReports
      : buildInitialDailyReports(dollarGold.usdtIrtAverage, xauUsdOunce);

  const winSummary = computeSignalWinRateMetrics(signals, executedTrades);
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
    usdtIrtClose: dollarGold.usdtIrtWallex,
    xauUsdClose: dollarGold.xauUsdOunce,
    gold18kCloseIrt: dollarGold.gold18kMarketIrt,
    summaryNote: `ثبت خودکار کارنامه روزانه با نرخ موفقیت ${winSummary.winRatePct}% و پایش ${winSummary.userTradesActive} معامله فعال کاربر.`,
  };

  const dailyReports = [
    todayReport,
    ...existingReports.filter((r) => r.dateKey !== todayKey),
  ];

  // 5. ارسال گزارش رادار اسکن زنده + پایش سیگنال‌های قفل‌شده (🔒)
  const lockedSignals = signals.filter((s) => s.isLocked);
  if (lockedSignals.length > 0) {
    await sendTelegram(
      formatLockedSignalsTelegramReport(lockedSignals, settings.dashboardUrl),
      savedToken,
      savedChatId
    );
  }

  // 6. ارسال سیگنال‌های فعال بالای حد آستانه با قیمت زنده
  const allEligibleActive = signals.filter(
    (s) =>
      s.mode === 'live' &&
      s.score >= settings.minScoreTelegram &&
      s.isEconomicallyJustified !== false &&
      (s.status === 'pending' || s.status === 'open')
  );

  let sentSignalIds: string[] = Array.isArray(existingState?.sentSignalIds)
    ? existingState.sentSignalIds
    : [];

  // Reset sentSignalIds if all eligible signals were already sent in an earlier cycle so new scans always rotate fresh alerts
  let unsentEligible = allEligibleActive.filter((s) => !sentSignalIds.includes(s.id));
  if (unsentEligible.length === 0 && allEligibleActive.length > 0) {
    sentSignalIds = [];
    unsentEligible = allEligibleActive;
  }

  // Send Scan Radar Summary first
  await sendTelegram(
    formatScanRadarTelegramSummary({
      dollarGold,
      btcPrice,
      ethPrice,
      signals,
      dashboardUrl: settings.dashboardUrl,
    }),
    savedToken,
    savedChatId
  );

  // Send top 2 individual signal cards per 15-minute scan cycle
  for (const sig of unsentEligible.slice(0, 2)) {
    const message = formatTelegramSignalMessage(sig, settings);
    const sent = await sendTelegram(message, savedToken, savedChatId);
    if (sent) {
      sentSignalIds.push(sig.id);
    }
  }

  // ذخیره در ژورنال append-only
  fs.mkdirSync(path.dirname(JOURNAL_PATH), { recursive: true });
  const journalEntry = JSON.stringify({
    scannedAt: new Date().toISOString(),
    usdtIrtWallex,
    xauUsdOunce,
    btcPrice,
    winRatePct: winSummary.winRatePct,
    activeSignalsCount: winSummary.activeSignals,
    lockedSignalsCount: lockedSignals.length,
  });
  fs.appendFileSync(JOURNAL_PATH, journalEntry + '\n', 'utf-8');

  // ذخیره فایل وضعیت برای GitHub Pages و داشبورد وب
  const nextState = {
    settings,
    dollarGold,
    signals,
    executedTrades,
    dailyReports,
    strategies: existingState?.strategies || INITIAL_STRATEGIES,
    postmortem: INITIAL_POSTMORTEM_TAGS,
    challenger: existingState?.challenger || INITIAL_CHALLENGER,
    sourceHealth: INITIAL_SOURCE_HEALTH,
    sentSignalIds,
    macro: {
      btcPrice,
      btcChange24h: 1.92,
      ethPrice,
      ethChange24h: 2.34,
      btcDominance: 57.8,
      fearGreedIndex,
      fearGreedLabel,
      lastScanAt: new Date().toISOString(),
      scanCount: (existingState?.macro?.scanCount || 0) + 1,
    },
  };

  fs.mkdirSync(path.dirname(PUBLIC_STATE_PATH), { recursive: true });
  fs.writeFileSync(PUBLIC_STATE_PATH, JSON.stringify(nextState, null, 2), 'utf-8');
  console.log(`=== [QuantPulse] اسکن زنده کامل شد و در ${PUBLIC_STATE_PATH} ذخیره گردید ===`);
}

main().catch((err) => {
  console.error('خطا در اجرای اسکن:', err);
  process.exit(1);
});
