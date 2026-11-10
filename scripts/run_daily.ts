/**
 * scripts/run_daily.ts
 * اسکریپت مستقل گزارش روزانه ساعت ۰۸:۰۰ صبح تهران در GitHub Actions (cron: 30 4 * * *)
 * شامل:
 * ۱. تحلیل روزانه دلار/تتر (والکس و بیت‌پین)، انس جهانی طلا، ارزش ذاتی و حباب طلای ۱۸ عیار، و وضعیت کلان کریپتو
 * ۲. ثبت و ارسال کارنامه روزانه نرخ موفقیت سیگنال‌ها (Win Rate) و عملکرد معاملات کاربر
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  DEFAULT_BOT_SETTINGS,
  buildInitialDailyReports,
  buildInitialDollarGoldSnapshot,
  buildInitialExecutedTrades,
  buildInitialSignals,
} from '../src/engine/seedData';
import {
  computeSignalWinRateMetrics,
  formatDailyPerformanceTelegramReport,
  formatDailyTelegramReport,
  formatForTelegramApiHtml,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
} from '../src/engine/quantEngine';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_STATE_PATH = path.resolve(__dirname, '..', 'public', 'data', 'bot_state.json');

async function resolveChatIdFromUpdates(token: string): Promise<string> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=10`);
    if (!res.ok) return '';
    const data = (await res.json()) as any;
    const updates = Array.isArray(data?.result) ? data.result : [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const cid =
        u?.message?.chat?.id ??
        u?.channel_post?.chat?.id ??
        u?.my_chat_member?.chat?.id;
      if (cid) return String(cid);
    }
  } catch {
    // ignore
  }
  return '';
}

async function main() {
  console.log('=== [QuantPulse] تولید و ارسال گزارش روزانه ۰۸:۰۰ تهران + کارنامه نرخ موفقیت سیگنال‌ها ===');

  let state: any = null;
  if (fs.existsSync(PUBLIC_STATE_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(PUBLIC_STATE_PATH, 'utf-8'));
    } catch {
      state = null;
    }
  }

  const dollarGold = state?.dollarGold || buildInitialDollarGoldSnapshot();
  const signals = state?.signals || buildInitialSignals(dollarGold.usdtIrtAverage);
  const executedTrades =
    state?.executedTrades || buildInitialExecutedTrades(dollarGold.usdtIrtAverage);
  const dailyReports =
    state?.dailyReports ||
    buildInitialDailyReports(dollarGold.usdtIrtAverage, dollarGold.xauUsdOunce);
  const settings = state?.settings || DEFAULT_BOT_SETTINGS;
  const macro = state?.macro || {
    btcPrice: 74552.9,
    btcChange24h: 1.92,
    ethPrice: 2122.87,
    ethChange24h: 2.34,
    btcDominance: 57.8,
    fearGreedIndex: 64,
    fearGreedLabel: 'طمع متعادل (Greed)',
  };

  const winSummary = computeSignalWinRateMetrics(signals, executedTrades);

  const reportText = formatDailyTelegramReport({
    dollarGold,
    btcPrice: macro.btcPrice,
    btcChange24h: macro.btcChange24h,
    ethPrice: macro.ethPrice,
    ethChange24h: macro.ethChange24h,
    btcDominance: macro.btcDominance,
    fearGreedIndex: macro.fearGreedIndex,
    fearGreedLabel: macro.fearGreedLabel,
    activeSignalsCount: winSummary.activeSignals,
    recent30WinRatePct: winSummary.winRatePct,
    recent30NetR: winSummary.cumulativeNetR,
    settings,
  });

  const performanceReportText = formatDailyPerformanceTelegramReport(
    dailyReports[0],
    winSummary,
    settings.dashboardUrl
  );

  console.log('\n' + reportText + '\n');
  console.log('\n' + performanceReportText + '\n');

  const token = sanitizeTelegramToken(process.env.TELEGRAM_BOT_TOKEN || settings.telegramBotToken);
  let chatId = sanitizeTelegramChatId(process.env.TELEGRAM_CHAT_ID || settings.telegramChatId);
  if (token && !chatId) {
    chatId = await resolveChatIdFromUpdates(token);
  }

  if (token && chatId) {
    for (const msg of [reportText, performanceReportText]) {
      const htmlFormatted = formatForTelegramApiHtml(msg);
      let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlFormatted,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: msg,
            disable_web_page_preview: true,
          }),
        });
      }
      if (res.ok) {
        console.log('[Telegram] پیام روزانه با موفقیت ارسال شد.');
      } else {
        console.warn('[Telegram] خطا در ارسال گزارش روزانه:', await res.text());
      }
    }
  } else {
    console.log('[Telegram] متغیرهای TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID تنظیم نشده‌اند؛ گزارش در لاگ چاپ شد.');
  }
}

main().catch((err) => {
  console.error('خطا در اجرای گزارش روزانه:', err);
  process.exit(1);
});
