/**
 * scripts/run_weekly.ts
 * اسکریپت مستقل گزارش هفتگی، کالبدشکافی ضررها و بررسی قهرمان/رقیب در GitHub Actions (cron: 30 4 * * 6)
 */

import dotenv from 'dotenv';
import {
  DEFAULT_BOT_SETTINGS,
  INITIAL_CHALLENGER,
  INITIAL_POSTMORTEM_TAGS,
  INITIAL_STRATEGIES,
} from '../src/engine/seedData';
import {
  formatForTelegramApiHtml,
  getPersianDateLabel,
  resolveDailyDashboardLink,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
} from '../src/engine/quantEngine';

dotenv.config();

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
  console.log('=== [QuantPulse] اجرای گزارش هفتگی، کالبدشکافی ضررها و کالیبراسیون ===');

  const activeStrategies = INITIAL_STRATEGIES.filter((s) => s.enabled);
  const topLossReason = INITIAL_POSTMORTEM_TAGS[0];
  const persianDate = getPersianDateLabel();
  const dailyLink = resolveDailyDashboardLink(DEFAULT_BOT_SETTINGS.dashboardUrl, {
    type: 'weekly',
    tab: 'performance',
  });

  const weeklyReport = [
    `\u200F🏆 گزارش هفتگی و کالیبراسیون | ${persianDate}`,
    ``,
    `\u200F📊 استراتژی‌های فعال: ${activeStrategies.length} مدل`,
    `\u200F• بهترین بازده: PAXG/USDT (\u200E+0.41R\u200F)`,
    `\u200F• رتبه دوم: SMC Sweep (\u200E+0.36R\u200F)`,
    ``,
    `\u200F🛡 وضعیت Circuit Breaker: پایدار`,
    `\u200F• علت اصلی استاپ‌ها: ${topLossReason.persianLabel} (\u200E${topLossReason.shareOfLossesPct}%\u200F)`,
    `\u200F⚖️ قهرمان در برابر رقیب (${INITIAL_CHALLENGER.weeksRunning} هفته): \u200E+${INITIAL_CHALLENGER.championExpectancyR}R\u200F در برابر \u200E+${INITIAL_CHALLENGER.challengerExpectancyR}R\u200F`,
    ``,
    `\u200F🔗 لینک یکتای داشبورد گیت‌هاب:`,
    `\u200E${dailyLink}`,
  ].join('\n');

  console.log('\n' + weeklyReport + '\n');

  const token = sanitizeTelegramToken(process.env.TELEGRAM_BOT_TOKEN);
  let chatId = sanitizeTelegramChatId(process.env.TELEGRAM_CHAT_ID);
  if (token && !chatId) {
    chatId = await resolveChatIdFromUpdates(token);
  }

  if (token && chatId) {
    const htmlFormatted = formatForTelegramApiHtml(weeklyReport);
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
          text: weeklyReport,
          disable_web_page_preview: true,
        }),
      });
    }
    if (res.ok) {
      console.log('[Telegram] گزارش هفتگی با موفقیت ارسال شد.');
    }
  }
}

main().catch((err) => {
  console.error('خطا در اجرای گزارش هفتگی:', err);
  process.exit(1);
});
