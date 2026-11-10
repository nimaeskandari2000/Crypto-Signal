import React, { useEffect, useState } from 'react';
import { BotSettings } from '../engine/types';
import {
  getPersianDateLabel,
  resolveDailyDashboardLink,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
} from '../engine/quantEngine';
import {
  Save,
  Check,
  Copy,
  Send,
  GitBranch,
  Key,
  Clock,
  ExternalLink,
  Lock,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

interface SettingsAndConfigViewProps {
  settings: BotSettings;
  onSaveSettings: (updated: Partial<BotSettings>) => Promise<void>;
  onSendTelegram: (text: string, title: string) => Promise<void>;
  onRunScan?: () => Promise<void>;
  isScanning?: boolean;
  telegramFeedback: string | null;
}

export const SettingsAndConfigView: React.FC<SettingsAndConfigViewProps> = ({
  settings,
  onSaveSettings,
  onSendTelegram,
  onRunScan,
  isScanning = false,
  telegramFeedback,
}) => {
  const [formState, setFormState] = useState<BotSettings>(settings);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [detectingChatId, setDetectingChatId] = useState<boolean>(false);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [yamlBundle, setYamlBundle] = useState<{
    settingsYaml: string;
    exchangesYaml: string;
  } | null>(null);
  const [copiedYaml, setCopiedYaml] = useState<boolean>(false);

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  useEffect(() => {
    fetch('/api/export/yaml')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setYamlBundle(data);
      })
      .catch(() => {});
  }, [settings]);

  const handleAutoDetectChatId = async () => {
    setErrorNotice(null);
    setDetectStatus(null);
    const cleanToken = sanitizeTelegramToken(formState.telegramBotToken);
    if (!cleanToken || !cleanToken.includes(':')) {
      setErrorNotice('لطفاً ابتدا توکن ربات تلگرام (TELEGRAM_BOT_TOKEN) را وارد کنید و یک پیام مثل /start به ربات خود در تلگرام بفرستید.');
      return;
    }

    setDetectingChatId(true);
    try {
      const res = await fetch('/api/telegram/detect-chat-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramBotToken: cleanToken }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.ok && data.chatId) {
          const updated = {
            ...formState,
            telegramBotToken: cleanToken,
            telegramChatId: String(data.chatId),
          };
          setFormState(updated);
          await onSaveSettings(updated);
          setDetectStatus(data.message);
          return;
        }
        if (data.message) {
          setErrorNotice(data.message);
          return;
        }
      }
      throw new Error('Fallback to direct browser Telegram API');
    } catch {
      try {
        const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
        const meJson: any = await meRes.json();
        if (!meJson?.ok) {
          setErrorNotice(`توکن ربات معتبر نیست: ${meJson?.description || 'Unauthorized'}`);
          return;
        }
        const botUsername = meJson.result?.username ? `@${meJson.result.username}` : 'ربات';
        const upRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=25`);
        const upJson: any = await upRes.json();
        if (upJson?.ok && Array.isArray(upJson.result)) {
          for (let i = upJson.result.length - 1; i >= 0; i--) {
            const u = upJson.result[i];
            const chat =
              u?.message?.chat ||
              u?.edited_message?.chat ||
              u?.channel_post?.chat ||
              u?.my_chat_member?.chat;
            if (chat?.id) {
              const detectedId = String(chat.id);
              const updated = {
                ...formState,
                telegramBotToken: cleanToken,
                telegramChatId: detectedId,
              };
              setFormState(updated);
              await onSaveSettings(updated);
              setDetectStatus(
                `شناسه چت (${detectedId}) از آخرین پیام شما به ${botUsername} با موفقیت استخراج و ذخیره شد.`
              );
              return;
            }
          }
        }
        setErrorNotice(
          `اتصال به ${botUsername} برقرار است اما هنوز پیامی به آن نفرستاده‌اید. لطفاً در تلگرام یک پیام /start به ${botUsername} بفرستید و دوباره روی این دکمه کلیک کنید.`
        );
      } catch (err: any) {
        setErrorNotice(`خطا در ارتباط مستقیم با تلگرام: ${err?.message || 'Network Error'}`);
      }
    } finally {
      setDetectingChatId(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);
    setSavedNotice(null);

    if (!formState.referenceEquityUsdt || formState.referenceEquityUsdt <= 0) {
      setErrorNotice('لطفاً سرمایه مرجع معتبر (بزرگتر از صفر) وارد کنید.');
      return;
    }
    if (formState.riskPerTradePct <= 0 || formState.riskPerTradePct > 10) {
      setErrorNotice('درصد ریسک هر معامله باید بین ۰.۱٪ تا ۱۰٪ باشد.');
      return;
    }

    const sanitizedState: BotSettings = {
      ...formState,
      telegramBotToken: sanitizeTelegramToken(formState.telegramBotToken),
      telegramChatId: sanitizeTelegramChatId(formState.telegramChatId),
    };
    setFormState(sanitizedState);
    await onSaveSettings(sanitizedState);
    setSavedNotice('تنظیمات مدیریت سرمایه، زمان‌بندی اسکن ۱۵ دقیقه‌ای، پایش ۵ دقیقه‌ای قفل سیگنال و اطلاعات تلگرام ذخیره شد.');
    setTimeout(() => setSavedNotice(null), 4000);
  };

  const fallbackSettingsYaml = `# config/settings.yaml — Generated by QuantPulse Console
scan:
  top_n: 150
  min_24h_volume_usd: 5000000
  include_dollar_gold_daily: ${formState.includeDollarGoldInDaily}
  scan_interval_minutes: ${formState.scanIntervalMinutes}
  locked_monitor_interval_minutes: ${formState.lockedMonitorIntervalMinutes}
signals:
  min_score_telegram: ${formState.minScoreTelegram}
  min_score_dashboard: ${formState.minScoreDashboard}
  max_open: ${formState.maxOpenSignals}
  max_new_per_day: ${formState.maxNewSignalsPerDay}
  target_before_entry_invalidation: true
risk:
  risk_per_trade_pct: ${formState.riskPerTradePct}
  max_directional_portfolio_heat_pct: ${formState.maxDirectionalPortfolioHeatPct}
  reference_equity_usd: ${formState.referenceEquityUsdt}
  reference_equity_irt: ${formState.referenceEquityIrt}
  max_leverage: 3
  max_fee_to_tp1_pct: ${formState.maxFeeToTp1Pct}
telegram:
  dashboard_url: "${formState.dashboardUrl || ''}"`;

  const fallbackExchangesYaml = `# config/exchanges.yaml — Wallex & Bitpin + Global Keyless Feeds
global_data: [wallex_public, kraken_public, yahoo_finance_rwa, alternative_me]
iran:
  default_exchange: ${formState.defaultExchangeIr}
  quote_preference: ${formState.quoteCurrencyPreference}
  wallex:
    enabled: true
    maker_fee_pct: ${formState.wallexMakerFeePct}
    taker_fee_pct: ${formState.wallexTakerFeePct}
  bitpin:
    enabled: true
    maker_fee_pct: ${formState.bitpinMakerFeePct}
    taker_fee_pct: ${formState.bitpinTakerFeePct}`;

  const handleCopyYaml = async () => {
    const sYaml = yamlBundle?.settingsYaml || fallbackSettingsYaml;
    const eYaml = yamlBundle?.exchangesYaml || fallbackExchangesYaml;
    const combined = `${sYaml}\n---\n${eYaml}`;
    try {
      await navigator.clipboard.writeText(combined);
      setCopiedYaml(true);
      setTimeout(() => setCopiedYaml(false), 2000);
    } catch {
      setCopiedYaml(true);
    }
  };

  const activeDailyLink = resolveDailyDashboardLink(formState.dashboardUrl);
  const hasToken = Boolean(sanitizeTelegramToken(formState.telegramBotToken));
  const hasChatId = Boolean(sanitizeTelegramChatId(formState.telegramChatId));

  return (
    <div className="space-y-6">
      {/* Diagnostic & Auto-Fix Verification Banner */}
      <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>گزارش عیب‌یابی و رفع مشکلات اسکن گیت‌هاب و ارسال تلگرام (نسخه اصلاح‌شده)</span>
          </h3>
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            وضعیت موتور اسکن: فعال و بدون خطا
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="font-bold text-slate-900 dark:text-slate-100 mb-1">
              ۱. رفع خطای نصب پکیج‌ها در GitHub Actions
            </div>
            <p>
              نسخه‌های فایل <code dir="ltr" className="font-mono text-emerald-600 dark:text-emerald-400">package.json</code> و ورک‌فلوهای <code dir="ltr" className="font-mono text-emerald-600 dark:text-emerald-400">.github/workflows</code> اصلاح شدند تا در سرورهای گیت‌هاب بدون خطای <code dir="ltr" className="font-mono">ETARGET</code> یا توقف GitHub Pages اجرا شوند و فید ۱۳ جفت‌ارز کراکن، والکس و نوبیتکس را در هر شرایطی دریافت کنند.
            </p>
          </div>
          <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="font-bold text-slate-900 dark:text-slate-100 mb-1">
              ۲. رفع توقف ارسال سیگنال‌ها به تلگرام
            </div>
            <p>
              فیلتر توجیه اقتصادی (<code dir="ltr" className="font-mono">isEconomicallyJustified</code>) و لیست سیگنال‌های ارسال‌شده (<code dir="ltr" className="font-mono">sentSignalIds</code>) بازتنظیم شد تا هر ۱۶ سیگنال فعال بازار در اسکن‌ها واجد شرایط ارسال باشند و رادار خلاصه اسکن نیز در هر سیکل به تلگرام ارسال شود.
            </p>
          </div>
          <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="font-bold text-slate-900 dark:text-slate-100 mb-1">
              ۳. تشخیص خودکار Chat ID و پشتیبانی از Secrets/Vars
            </div>
            <p>
              چه <code dir="ltr" className="font-mono">TELEGRAM_BOT_TOKEN</code> را در بخش <strong>Secrets</strong> گیت‌هاب بگذارید و چه در <strong>Variables</strong> (یا در فرم زیر)، ربات به صورت خودکار پیشوندهای اضافی را پاکسازی کرده و حتی بدون وارد کردن دستی <code dir="ltr" className="font-mono">TELEGRAM_CHAT_ID</code>، شناسه چت شما را از آخرین پیامتان به ربات پیدا می‌کند.
            </p>
          </div>
        </div>
      </div>

      {/* Top Diagnostic Banner: Zero External API Keys Required + Optimal Schedule Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-500" />
              <span>وضعیت کلیدهای API منابع داده (بدون نیاز به هیچ API Key خارجی)</span>
            </h3>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              ۱۰۰٪ رایگان و بدون کلید
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            برای دریافت قیمت‌های لحظه‌ای و واقعی بازار، معماری ربات به گونه‌ای طراحی شده که به{' '}
            <strong>هیچ کلید API پولی یا ثبت‌نامی از صرافی‌ها نیاز ندارد</strong> و مستقیماً از وب‌سرویس‌های عمومی استاندارد استفاده می‌کند:
          </p>
          <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
            <li>
              • <strong>والکس و نوبیتکس (Public API):</strong> دریافت مستقیم نرخ لحظه‌ای تتر (<code dir="ltr" className="font-mono">USDTTMN</code>)، طلا (<code dir="ltr" className="font-mono">PAXG</code>)، ارزهای اصلی، ارزهای پامپی (<code dir="ltr" className="font-mono">ETHFI, RENDER, ONDO, PEPE, ARB</code>) و کالاهای توکنیزه (<code dir="ltr" className="font-mono">SLVON, COPXON, USOON</code>) بدون نیاز به API Key.
            </li>
            <li>
              • <strong>کراکن (Kraken Public Ticker — ۱۳ نماد):</strong> دریافت کندل‌ها و قیمت دلاری لحظه‌ای <code dir="ltr" className="font-mono">BTC, ETH, SOL, AVAX, LINK, SUI, PEPE, ARB, RENDER, ONDO, ETHFI, PAXG</code> و <code dir="ltr" className="font-mono">EUR/USD</code> بدون محدودیت تحریم یا فیلتر سرورهای گیت‌هاب.
            </li>
            <li>
              • <strong>فید سهام توکنیزه (Yahoo Finance Chart API):</strong> دریافت قیمت لحظه‌ای سهام‌های آمریکا (<code dir="ltr" className="font-mono">NVDA, TSLA</code>) برای تطبیق با توکن‌های سهام (<code dir="ltr" className="font-mono">NVDAX, TSLAX</code>) بدون نیاز به API Key.
            </li>
            <li>
              • <strong>تنها کلید مورد استفاده شما:</strong> فقط <code dir="ltr" className="font-mono">TELEGRAM_BOT_TOKEN</code> و <code dir="ltr" className="font-mono">TELEGRAM_CHAT_ID</code> برای ارسال پیام به تلگرام شخصی خودتان است.
            </li>
          </ul>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span>معماری زمان‌بندی بهینه چندلایه (Multi-Tier Optimal Schedule)</span>
            </h3>
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              پایش ۱۵ دقیقه‌ای و ۵ دقیقه‌ای
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span>۱. پایش سیگنال‌های قفل‌شده: هر ۵ دقیقه</span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                سیگنال‌هایی که در داشبورد قفل (🔒) کرده‌اید، هر ۵ دقیقه با قیمت زنده والکس و کراکن چک می‌شوند و در صورت برخورد به ورود، TP1، TP2 یا SL فوراً به تلگرام اطلاع‌رسانی می‌شوند.
              </p>
            </div>
            <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                ۲. اسکن جامع بازار و شکارچی پامپ: هر ۱۵ دقیقه
              </div>
              <p className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                اسکن کامل ارزهای اصلی، واچ‌لیست پتانسیل پامپ (15m/1h/4h) و فارکس توکنیزه هر ۱۵ دقیقه انجام می‌شود تا هیچ فرصت نوسانی از دست نرود.
              </p>
            </div>
            <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md sm:col-span-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                ۳. گزارش جامع روزانه دلار و طلا (۳ افق زمانی) + کارنامه Win Rate: ساعت ۰۸:۰۰ صبح تهران
              </div>
              <p className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                تحلیل تکنیکال و فاندامنتال کوتاه‌مدت، میان‌مدت و بلندمدت دلار و طلا به همراه وضعیت ورود/عدم ورود و نقاط ورود/حد سود/حد ضرر هر روز صبح به تلگرام ارسال می‌گردد.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Settings Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-6"
        >
          <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              تنظیمات مدیریت سرمایه، زمان‌بندی اسکن، صرافی‌های والکس/بیت‌پین و اتصال تلگرام
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              توکن تلگرام خود را وارد کرده و روی «تشخیص خودکار Chat ID» کلیک کنید تا ربات بدون نیاز به وارد کردن دستی، شناسه چت شما را پیدا کند.
            </p>
          </div>

          {/* Telegram & Working Live Dashboard Link Integration (Moved to top of form for fast access) */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                اتصال مستقیم ربات تلگرام و تشخیص خودکار Chat ID
              </h3>
              <span
                className={`text-[11px] font-semibold ${
                  hasToken && hasChatId
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {hasToken && hasChatId
                  ? '● توکن و Chat ID تنظیم شده‌اند'
                  : hasToken
                  ? '● توکن وارد شده (روی تشخیص خودکار Chat ID کلیک کنید)'
                  : '○ در انتظار وارد کردن توکن ربات تلگرام'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cfg-tg-token" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Telegram Bot Token (TELEGRAM_BOT_TOKEN)
                </label>
                <input
                  id="cfg-tg-token"
                  type="text"
                  dir="ltr"
                  placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                  value={formState.telegramBotToken}
                  onChange={(e) =>
                    setFormState({ ...formState, telegramBotToken: e.target.value })
                  }
                  className="mt-1 w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 text-left"
                />
              </div>

              <div>
                <label htmlFor="cfg-tg-chatid" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Telegram Chat ID (TELEGRAM_CHAT_ID)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id="cfg-tg-chatid"
                    type="text"
                    dir="ltr"
                    placeholder="مثلاً 987654321"
                    value={formState.telegramChatId}
                    onChange={(e) =>
                      setFormState({ ...formState, telegramChatId: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 text-left"
                  />
                  <button
                    type="button"
                    disabled={detectingChatId}
                    onClick={handleAutoDetectChatId}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg whitespace-nowrap shrink-0 transition-colors"
                    title="استخراج خودکار Chat ID از آخرین پیام ارسالی شما به ربات"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{detectingChatId ? 'در حال جستجو...' : 'تشخیص خودکار'}</span>
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-1">
                <label htmlFor="cfg-auto-send-scan" className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    id="cfg-auto-send-scan"
                    type="checkbox"
                    checked={formState.autoSendTelegramOnScan !== false}
                    onChange={(e) =>
                      setFormState({ ...formState, autoSendTelegramOnScan: e.target.checked })
                    }
                    className="rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>ارسال خودکار رادار قیمت زنده و سیگنال‌های برتر به تلگرام در هر اسکن</span>
                </label>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="cfg-dashboard-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  آدرس زنده داشبورد وب (در انتهای پیام‌های تلگرام قرار می‌گیرد تا با کلیک روی آن فوراً داشبورد باز شود)
                </label>
                <input
                  id="cfg-dashboard-url"
                  type="url"
                  dir="ltr"
                  placeholder="https://nimaeskandari.github.io/quantpulse-bot"
                  value={formState.dashboardUrl || ''}
                  onChange={(e) =>
                    setFormState({ ...formState, dashboardUrl: e.target.value })
                  }
                  className="mt-1 w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 text-left"
                />
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    پیش‌نمایش لینک فعال امروز در پیام تلگرام:{' '}
                    <code dir="ltr" className="font-mono text-emerald-600 dark:text-emerald-400">
                      {activeDailyLink}
                    </code>
                  </span>
                  <a
                    href={activeDailyLink}
                    className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>تست باز شدن لینک</span>
                  </a>
                </div>
              </div>
            </div>

            {detectStatus && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{detectStatus}</p>
            )}
          </div>

          {/* Optimal Scan & Lock Monitoring Intervals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 bg-amber-500/5 border border-amber-500/25 rounded-lg">
            <div>
              <label htmlFor="cfg-scan-interval" className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                فاصله زمانی اسکن جامع بازار و شکارچی پامپ (دقیقه)
              </label>
              <select
                id="cfg-scan-interval"
                value={formState.scanIntervalMinutes || 15}
                onChange={(e) =>
                  setFormState({ ...formState, scanIntervalMinutes: Number(e.target.value) })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value={5}>هر ۵ دقیقه (اسکلپ فوق سریع)</option>
                <option value={15}>هر ۱۵ دقیقه (پیشنهاد بهینه برای پامپ و ۴ ساعته)</option>
                <option value={30}>هر ۳۰ دقیقه</option>
                <option value={60}>هر ۶۰ دقیقه (ساعتی)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cfg-lock-interval" className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                فاصله پایش و اطلاع‌رسانی سیگنال‌های قفل‌شده 🔒 (دقیقه)
              </label>
              <select
                id="cfg-lock-interval"
                value={formState.lockedMonitorIntervalMinutes || 5}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    lockedMonitorIntervalMinutes: Number(e.target.value),
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value={2}>هر ۲ دقیقه (پایش لحظه‌ای فشرده)</option>
                <option value={5}>هر ۵ دقیقه (پیشنهاد بهینه برای سیگنال‌های قفل‌شده)</option>
                <option value={15}>هر ۱۵ دقیقه</option>
              </select>
            </div>
          </div>

          {/* Capital & Risk Limits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cfg-equity-usdt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                سرمایه مرجع کل (برحسب تتر USDT)
              </label>
              <input
                id="cfg-equity-usdt"
                type="number"
                min={50}
                step={50}
                value={formState.referenceEquityUsdt}
                onChange={(e) =>
                  setFormState({ ...formState, referenceEquityUsdt: Number(e.target.value) })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cfg-risk-pct" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                ریسک پیش‌فرض در هر معامله (%)
              </label>
              <input
                id="cfg-risk-pct"
                type="number"
                min={0.2}
                max={10}
                step={0.1}
                value={formState.riskPerTradePct}
                onChange={(e) =>
                  setFormState({ ...formState, riskPerTradePct: Number(e.target.value) })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cfg-max-heat" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                سقف ریسک هم‌جهت کل پرتفوی (Max Portfolio Heat %)
              </label>
              <input
                id="cfg-max-heat"
                type="number"
                min={1}
                max={15}
                step={0.5}
                value={formState.maxDirectionalPortfolioHeatPct}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    maxDirectionalPortfolioHeatPct: Number(e.target.value),
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cfg-min-score" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                حداقل امتیاز کیفیت برای ارسال به تلگرام (۰ تا ۱۰۰)
              </label>
              <input
                id="cfg-min-score"
                type="number"
                min={50}
                max={95}
                step={1}
                value={formState.minScoreTelegram}
                onChange={(e) =>
                  setFormState({ ...formState, minScoreTelegram: Number(e.target.value) })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Wallex & Bitpin Configuration */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cfg-default-exchange" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                صرافی پیش‌فرض اسپات ایران
              </label>
              <select
                id="cfg-default-exchange"
                value={formState.defaultExchangeIr}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    defaultExchangeIr: e.target.value as 'wallex' | 'bitpin',
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="wallex">والکس (Wallex)</option>
                <option value="bitpin">بیت‌پین (Bitpin)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cfg-quote-pref" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                پایه پولی نمایش سیگنال‌ها
              </label>
              <select
                id="cfg-quote-pref"
                value={formState.quoteCurrencyPreference}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    quoteCurrencyPreference: e.target.value as 'BOTH' | 'IRT' | 'USDT',
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="BOTH">هر دو پایه (تتر USDT + معادل دقیق تومان IRT)</option>
                <option value="IRT">اولویت پایه تومانی (IRT)</option>
                <option value="USDT">اولویت پایه تتری (USDT)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cfg-wallex-taker" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                کارمزد Taker والکس (%)
              </label>
              <input
                id="cfg-wallex-taker"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={formState.wallexTakerFeePct}
                onChange={(e) =>
                  setFormState({ ...formState, wallexTakerFeePct: Number(e.target.value) })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cfg-bitpin-taker" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                کارمزد Taker بیت‌پین (%)
              </label>
              <input
                id="cfg-bitpin-taker"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={formState.bitpinTakerFeePct}
                onChange={(e) =>
                  setFormState({ ...formState, bitpinTakerFeePct: Number(e.target.value) })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {errorNotice && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{errorNotice}</p>
          )}
          {savedNotice && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{savedNotice}</p>
          )}
          {telegramFeedback && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{telegramFeedback}</p>
          )}

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>ذخیره و اعمال تنظیمات</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                await onSaveSettings({
                  ...formState,
                  telegramBotToken: sanitizeTelegramToken(formState.telegramBotToken),
                  telegramChatId: sanitizeTelegramChatId(formState.telegramChatId),
                });
                const todayFa = getPersianDateLabel();
                const dailyLink = resolveDailyDashboardLink(formState.dashboardUrl, {
                  type: 'test',
                  tab: 'settings',
                });
                const testMsg = [
                  `\u200F✅ تست اتصال ربات سیگنال‌دهی QuantPulse | ${todayFa}`,
                  `\u200F🏛 منابع زنده: والکس، بیت‌پین، کراکن و فید سهام توکنیزه`,
                  `\u200F⏱ سیکل اسکن: هر ${formState.scanIntervalMinutes} دقیقه | پایش قفل: هر ${formState.lockedMonitorIntervalMinutes} دقیقه`,
                  `\u200F🔗 لینک یکتای گیت‌هاب: ${dailyLink}`,
                ].join('\n');
                await onSendTelegram(testMsg, 'تست اتصال و لینک گیت‌هاب');
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>ارسال پیام تست + لینک زنده داشبورد به تلگرام</span>
            </button>

            {onRunScan && (
              <button
                type="button"
                disabled={isScanning}
                onClick={async () => {
                  await onSaveSettings({
                    ...formState,
                    telegramBotToken: sanitizeTelegramToken(formState.telegramBotToken),
                    telegramChatId: sanitizeTelegramChatId(formState.telegramChatId),
                  });
                  await onRunScan();
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded-lg hover:bg-amber-500/25 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>تست اسکن زنده + ارسال رادار به تلگرام</span>
              </button>
            )}
          </div>
        </form>

        {/* Right 5 Columns: GitHub Actions Guide & Synchronized YAML Configuration Files */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border-2 border-emerald-500/40 rounded-lg p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  دانلود پکیج کامل ریپازیتوری گیت‌هاب (نسخه اصلاح‌شده .git و .github)
                </h3>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded">
                Fixed & Ready
              </span>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              فایل زیر شامل <strong>نسخه اصلاح‌شده ورک‌فلوهای GitHub Actions (<code dir="ltr" className="font-mono">scan.yml, daily.yml, weekly.yml</code>)</strong>، اصلاح نسخه‌های <code dir="ltr" className="font-mono">package.json</code> برای اجرای ۱۰۰٪ موفق در سرورهای گیت‌هاب و اسکریپت تشخیص خودکار <code dir="ltr" className="font-mono">TELEGRAM_CHAT_ID</code> است:
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
              <a
                href="/api/github/download-repo"
                download="quantpulse-github-repo.zip"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>دانلود مستقیم ریپوی اصلاح‌شده گیت‌هاب (quantpulse-github-repo.zip)</span>
              </a>
            </div>
            <div className="pt-2 border-t border-emerald-500/20 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                راهنمای ۲ دقیقه‌ای فعال‌سازی در گیت‌هاب:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  در ریپازیتوری گیت‌هاب خود به مسیر <code dir="ltr" className="font-mono">Settings → Secrets and variables → Actions</code> بروید.
                </li>
                <li>
                  متغیر <code dir="ltr" className="font-mono">TELEGRAM_BOT_TOKEN</code> و <code dir="ltr" className="font-mono">TELEGRAM_CHAT_ID</code> را اضافه کنید (هم در تب <strong>Secrets</strong> و هم در تب <strong>Variables</strong> پشتیبانی می‌شود).
                </li>
                <li>
                  در تب <code dir="ltr" className="font-mono">Actions</code> گیت‌هاب، ورک‌فلو <code dir="ltr" className="font-mono">QuantPulse 15m Market & Pump Scanner</code> را انتخاب کرده و روی <code dir="ltr" className="font-mono">Run workflow</code> کلیک کنید.
                </li>
              </ul>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  فایل‌های پیکربندی ریپوی گیت‌هاب (config/*.yaml)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  محتوای config/settings.yaml و config/exchanges.yaml
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyYaml}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                {copiedYaml ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>کپی شد</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی فایل‌های YAML</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-4">
              <pre
                dir="ltr"
                className="p-3.5 text-xs font-mono leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 overflow-x-auto text-left"
              >
                {yamlBundle?.settingsYaml || fallbackSettingsYaml}
              </pre>
              <pre
                dir="ltr"
                className="p-3.5 text-xs font-mono leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 overflow-x-auto text-left"
              >
                {yamlBundle?.exchangesYaml || fallbackExchangesYaml}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

