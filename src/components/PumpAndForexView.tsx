import React, { useMemo, useState } from 'react';
import { BotSettings, PositionSizeCalculation, Signal } from '../engine/types';
import {
  calculatePositionSizing,
  formatSmartPrice,
  formatTelegramSignalMessage,
} from '../engine/quantEngine';
import {
  Flame,
  Globe,
  Lock,
  Unlock,
  Send,
  PlayCircle,
  TrendingUp,
  ShieldAlert,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface PumpAndForexViewProps {
  signals: Signal[];
  settings: BotSettings;
  onToggleLockSignal: (signalId: string) => Promise<void>;
  onSendTelegram: (text: string, title: string) => Promise<void>;
  onRegisterExecutedTrade: (signal: Signal, sizing: PositionSizeCalculation) => void;
  telegramFeedback: string | null;
}

export const PumpAndForexView: React.FC<PumpAndForexViewProps> = ({
  signals,
  settings,
  onToggleLockSignal,
  onSendTelegram,
  onRegisterExecutedTrade,
  telegramFeedback,
}) => {
  const [activeSubView, setActiveSubView] = useState<'both' | 'pump' | 'forex'>('both');
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [sendingBatch, setSendingBatch] = useState<'pump' | 'forex' | null>(null);

  const pumpSignals = useMemo(
    () => signals.filter((s) => s.category === 'high_pump'),
    [signals]
  );

  const forexTokenizedSignals = useMemo(
    () => signals.filter((s) => s.category === 'forex_tokenized'),
    [signals]
  );

  const handleLockClick = async (sigId: string) => {
    setLockingId(sigId);
    try {
      await onToggleLockSignal(sigId);
    } finally {
      setLockingId(null);
    }
  };

  const handleQuickRegister = (sig: Signal) => {
    const isWallex = settings.defaultExchangeIr === 'wallex';
    const sizing = calculatePositionSizing({
      signal: sig,
      equityUsdt: settings.referenceEquityUsdt,
      riskPct: settings.riskPerTradePct,
      selectedExchange: settings.defaultExchangeIr,
      makerFeePct: isWallex ? settings.wallexMakerFeePct : settings.bitpinMakerFeePct,
      takerFeePct: isWallex ? settings.wallexTakerFeePct : settings.bitpinTakerFeePct,
      slippagePct: sig.iranQuotes[settings.defaultExchangeIr].spreadPct * 0.5,
      currentOpenDirectionalRiskPct: 2.0,
      maxDirectionalPortfolioHeatPct: settings.maxDirectionalPortfolioHeatPct,
    });
    onRegisterExecutedTrade(sig, sizing);
  };

  const handleSendCategoryTelegram = async (category: 'pump' | 'forex') => {
    setSendingBatch(category);
    try {
      const targetList = category === 'pump' ? pumpSignals : forexTokenizedSignals;
      for (const sig of targetList) {
        const msg = formatTelegramSignalMessage(sig, settings);
        await onSendTelegram(msg, `سیگنال ${sig.symbol}`);
      }
    } finally {
      setSendingBatch(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Filter Bar */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
            رادار شکارچی پامپ (سودهای انفجاری) + بازار فارکس، سهام و کامودیتی‌های توکنیزه‌شده
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            تمامی قیمت‌ها به صورت زنده از وب‌سرویس والکس (۱۸۶ جفت‌ارز)، کراکن فارکس و یاهو فایننس همگام‌سازی می‌شوند. می‌توانید هر سیگنال را قفل کنید تا هر ۵ دقیقه پایش شود.
          </p>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveSubView('both')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeSubView === 'both'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            نمایش هر دو بخش ({pumpSignals.length + forexTokenizedSignals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubView('pump')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeSubView === 'pump'
                ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            🚀 شکارچی پامپ ({pumpSignals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubView('forex')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeSubView === 'forex'
                ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            🌍 فارکس و دارایی توکنیزه ({forexTokenizedSignals.length})
          </button>
        </div>
      </section>

      {telegramFeedback && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 font-medium">
          {telegramFeedback}
        </div>
      )}

      {/* SECTION 1: HIGH-PUMP POTENTIAL / EXPLOSIVE BREAKOUT RADAR */}
      {(activeSubView === 'both' || activeSubView === 'pump') && (
        <section
          aria-label="رادار ارزهای مستعد پامپ و سودهای نجومی"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-start gap-2.5">
              <Flame className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  ۱. رادار شکارچی پامپ و پتانسیل سودهای نجومی (Explosive Breakout & Volume Anomaly)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  غربالگری لحظه‌ای ارزهای لیست‌شده در والکس که دارای جهش غیرعادی حجم (Volume Surge &gt; 2.5x)، خروج از فشردگی نوسان و پتانسیل رشدهای ۳۰٪ تا ۵۵٪ هستند.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={sendingBatch === 'pump'}
              onClick={() => handleSendCategoryTelegram('pump')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {sendingBatch === 'pump'
                  ? 'در حال ارسال...'
                  : `ارسال همه سیگنال‌های پامپ به تلگرام (${pumpSignals.length} ارز)`}
              </span>
            </button>
          </div>

          {/* Risk Governance Note for Pump Coins */}
          <div className="p-3 bg-amber-50/80 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-800/60 rounded-lg flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>قانون مدیریت سرمایه در شکارچی پامپ:</strong> ارزهای مستعد پامپ نوسان بالاتری دارند؛ در هدف اول (TP1) حتماً ۵۰٪ سیو سود کرده و حد ضرر را به نقطه ورود منتقل کنید (ریسک‌فری) تا موج سوم پامپ (TP3) را بدون ریسک شکار کنید.
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {pumpSignals.map((sig) => {
              const currentIrt = Math.round(sig.currentPrice * sig.usdtIrtRate);
              return (
                <div
                  key={sig.id}
                  className={`border rounded-lg p-4 flex flex-col justify-between space-y-4 transition-colors ${
                    sig.isLocked
                      ? 'border-amber-500/70 bg-amber-50/20 dark:bg-amber-950/15'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Top Header */}
                    <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                            {sig.symbol}
                          </span>
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {sig.persianName}
                          </span>
                          {sig.isLocked && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded">
                              <Lock className="w-3 h-3" />
                              قفل‌شده (پایش ۵ دقیقه‌ای)
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                            <Clock className="w-3 h-3" />
                            {sig.timeHorizonFa}
                          </span>
                          <span>·</span>
                          <span>منبع: {sig.liveSourceLabel || 'والکس (زنده)'}</span>
                        </div>
                      </div>

                      <div className="text-left font-mono tabular-nums">
                        <div className="text-xs font-bold text-amber-600 dark:text-amber-400">
                          پتانسیل پامپ: {sig.pumpPotentialScore || sig.score}/100
                        </div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                          جهش حجم: {sig.volumeSurgeMultiplier || 3.0}x برابر میانگین
                        </div>
                      </div>
                    </div>

                    {/* Live Price & Catalyst Box */}
                    <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] text-slate-500 block">
                          قیمت لحظه‌ای واقعی در بازار (والکس / کراکن)
                        </span>
                        <div className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-2">
                          <span className="ltr-num">${formatSmartPrice(sig.currentPrice)} USDT</span>
                          <span className="text-xs font-normal text-slate-500">
                            ({currentIrt.toLocaleString('fa-IR')} تومان)
                          </span>
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="text-[11px] text-slate-500 block">تغییر ۲۴ ساعته</span>
                        <span
                          className={`font-mono font-bold text-xs ltr-num ${
                            (sig.change24hPct ?? 0) >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {(sig.change24hPct ?? 0) >= 0 ? '+' : ''}
                          {sig.change24hPct ?? 0}%
                        </span>
                      </div>
                    </div>

                    {/* Entry, SL, TP1, TP2, TP3 Moon Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          محدوده ورود پله‌ای
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.entryLow)} – ${formatSmartPrice(sig.entryHigh)}
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          {sig.entryLowIrt.toLocaleString('fa-IR')} ت
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          حد ضرر (SL)
                        </span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.stop)} (−{sig.stopDistancePct}%)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          سقف سرمایه: {sig.maxAllocationPct || 3.5}% سبد
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          هدف ۱ (TP1 — ریسک‌فری)
                        </span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.tp1)} (+{sig.netProfitTp1Pct}%)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          خالص R:R: {sig.netRrTp1}R
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          هدف ۲ (TP2 — موج دوم)
                        </span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.tp2)} (+{sig.netProfitTp2Pct}%)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          خالص R:R: {sig.netRrTp2}R
                        </span>
                      </div>

                      {sig.tp3Pump && (
                        <div className="col-span-2 p-2.5 rounded bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
                          <span className="text-emerald-800 dark:text-emerald-300 font-sans font-semibold block text-[11px]">
                            🔥 هدف ۳ پامپ نجومی (TP3 Breakout Target)
                          </span>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 ltr-num">
                              ${formatSmartPrice(sig.tp3Pump)} USDT (+{sig.netProfitTp3Pct}% سود خالص)
                            </span>
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-sans">
                              معادل {Math.round(sig.tp3Pump * sig.usdtIrtRate).toLocaleString('fa-IR')} تومان
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 leading-relaxed">
                      {sig.pumpCatalystFa && (
                        <p>
                          <strong className="text-slate-900 dark:text-slate-100">محرک پامپ: </strong>
                          {sig.pumpCatalystFa}
                        </p>
                      )}
                      <p>
                        <strong className="text-slate-900 dark:text-slate-100">تحلیل تکنیکال: </strong>
                        {sig.rationale}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons: Lock, Send Telegram, Register Trade */}
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={lockingId === sig.id}
                      onClick={() => handleLockClick(sig.id)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                        sig.isLocked
                          ? 'bg-amber-500 text-white hover:bg-amber-600'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {sig.isLocked ? (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>حذف قفل پایش</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>قفل سیگنال و پایش</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onSendTelegram(
                          formatTelegramSignalMessage(sig, settings),
                          `سیگنال پامپ ${sig.symbol}`
                        )
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>ارسال به تلگرام</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickRegister(sig)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>ثبت ورود</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECTION 2: FOREX, TOKENIZED STOCKS & COMMODITIES (RWA) */}
      {(activeSubView === 'both' || activeSubView === 'forex') && (
        <section
          aria-label="توکن‌های مبتنی بر بازار فارکس، سهام و دارایی‌های توکنیزه‌شده"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-start gap-2.5">
              <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  ۲. بازار فارکس، سهام وال‌استریت و کامودیتی‌های توکنیزه‌شده (Tokenized Stocks, Forex & RWA)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  شامل گواهی‌های توکنیزه‌شده فعال در والکس (نقره SLVON، مس COPXON، نفت USOON)، سهام توکنیزه‌شده آمریکا (انویدیا NVDAX، تسلا TSLAX) و جفت‌ارزهای فارکس (EUR/USDT).
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={sendingBatch === 'forex'}
              onClick={() => handleSendCategoryTelegram('forex')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {sendingBatch === 'forex'
                  ? 'در حال ارسال...'
                  : `ارسال همه سیگنال‌های فارکس/توکنیزه به تلگرام (${forexTokenizedSignals.length} دارایی)`}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {forexTokenizedSignals.map((sig) => {
              const currentIrt = Math.round(sig.currentPrice * sig.usdtIrtRate);
              return (
                <div
                  key={sig.id}
                  className={`border rounded-lg p-4 flex flex-col justify-between space-y-4 transition-colors ${
                    sig.isLocked
                      ? 'border-amber-500/70 bg-amber-50/20 dark:bg-amber-950/15'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                            {sig.symbol}
                          </span>
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {sig.persianName}
                          </span>
                          {sig.isLocked && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded">
                              <Lock className="w-3 h-3" />
                              قفل‌شده
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          بازار مرجع: <strong className="text-slate-700 dark:text-slate-300">{sig.underlyingMarketFa}</strong>
                        </p>
                      </div>

                      <div className="text-left font-mono tabular-nums">
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 block">
                          امتیاز: {sig.score}/100
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          R:R خالص: {sig.netRrTp1}R / {sig.netRrTp2}R
                        </span>
                      </div>
                    </div>

                    {/* Live Price Strip */}
                    <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] text-slate-500 block">
                          قیمت لحظه‌ای ({sig.liveSourceLabel || 'والکس / بازار جهانی'})
                        </span>
                        <div className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-2">
                          <span className="ltr-num">${formatSmartPrice(sig.currentPrice)} USDT</span>
                          <span className="text-xs font-normal text-slate-500">
                            ({currentIrt.toLocaleString('fa-IR')} تومان)
                          </span>
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="text-[11px] text-slate-500 block">وضعیت ورود</span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          ورود مجاز ({sig.timeHorizonFa})
                        </span>
                      </div>
                    </div>

                    {/* Targets Grid */}
                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono tabular-nums">
                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          محدوده ورود (تتر و تومان)
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.entryLow)} – ${formatSmartPrice(sig.entryHigh)}
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          {sig.entryLowIrt.toLocaleString('fa-IR')} تا {sig.entryHighIrt.toLocaleString('fa-IR')} ت
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          حد ضرر (SL)
                        </span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.stop)} (−{sig.stopDistancePct}%)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          معادل {sig.stopIrt.toLocaleString('fa-IR')} تومان
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          هدف اول (TP1 — ۵۰٪ حجم)
                        </span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.tp1)} (خالص +{sig.netProfitTp1Pct}%)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          معادل {sig.tp1Irt.toLocaleString('fa-IR')} ت ({sig.netRrTp1}R)
                        </span>
                      </div>

                      <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-slate-500 font-sans block text-[11px]">
                          هدف دوم (TP2 — تسویه کامل)
                        </span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 ltr-num block mt-0.5">
                          ${formatSmartPrice(sig.tp2)} (خالص +{sig.netProfitTp2Pct}%)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          معادل {sig.tp2Irt.toLocaleString('fa-IR')} ت ({sig.netRrTp2}R)
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      <strong className="text-slate-900 dark:text-slate-100">تحلیل تکنیکال و بنیادی: </strong>
                      {sig.rationale}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={lockingId === sig.id}
                      onClick={() => handleLockClick(sig.id)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                        sig.isLocked
                          ? 'bg-amber-500 text-white hover:bg-amber-600'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {sig.isLocked ? (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>حذف قفل پایش</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>قفل سیگنال و پایش</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onSendTelegram(
                          formatTelegramSignalMessage(sig, settings),
                          `سیگنال ${sig.symbol}`
                        )
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>ارسال به تلگرام</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickRegister(sig)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>ثبت ورود</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
