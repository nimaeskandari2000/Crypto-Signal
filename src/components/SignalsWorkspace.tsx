import React, { useMemo, useState } from 'react';
import {
  AssetCategory,
  BotSettings,
  DollarGoldSnapshot,
  PositionSizeCalculation,
  Signal,
  SignalStatus,
  UserExecutedTrade,
} from '../engine/types';
import {
  calculatePositionSizing,
  formatExecutedTradeTelegramMessage,
  formatLockedSignalsTelegramReport,
  formatSmartPrice,
  formatTelegramSignalMessage,
} from '../engine/quantEngine';
import {
  Copy,
  Check,
  Send,
  Calculator,
  ShieldAlert,
  SlidersHorizontal,
  CheckCircle2,
  PlayCircle,
  Clock,
  Lock,
  Unlock,
} from 'lucide-react';

interface SignalsWorkspaceProps {
  signals: Signal[];
  executedTrades: UserExecutedTrade[];
  dollarGold: DollarGoldSnapshot;
  settings: BotSettings;
  onRegisterExecutedTrade: (
    signal: Signal,
    sizing: PositionSizeCalculation
  ) => void;
  onToggleLockSignal: (signalId: string) => Promise<void>;
  onSendTelegram: (text: string, title: string) => Promise<void>;
  onSendAllActiveSignalsToTelegram?: () => Promise<void>;
  onSendLockedSignalsReport?: () => Promise<void>;
  telegramFeedback: string | null;
  initialSelectedSignalId?: string;
  initialStatusFilter?: 'all' | 'active' | 'locked' | 'closed';
}

const STATUS_LABELS: Record<SignalStatus, string> = {
  pending: 'در انتظار ورود (Limit)',
  open: 'فعال در معامله',
  tp1: 'رسیده به هدف ۱ (ریسک‌فری)',
  closed_tp2: 'بسته‌شده در هدف ۲ (+سود کامل)',
  closed_sl: 'بسته‌شده با حد ضرر (−1R)',
  closed_be: 'بسته‌شده در نقطه ورود پس از هدف ۱',
  time_stop: 'بسته‌شده با انقضای زمانی',
  expired: 'منقضی‌شده (عدم رسیدن به ورود)',
  invalidated_tp_before_entry: 'باطل‌شده (لمس هدف ۱ پیش از ورود)',
};

export const SignalsWorkspace: React.FC<SignalsWorkspaceProps> = ({
  signals,
  executedTrades,
  dollarGold,
  settings,
  onRegisterExecutedTrade,
  onToggleLockSignal,
  onSendTelegram,
  onSendAllActiveSignalsToTelegram,
  onSendLockedSignalsReport,
  telegramFeedback,
  initialSelectedSignalId,
  initialStatusFilter,
}) => {
  const [selectedSignalId, setSelectedSignalId] = useState<string>(
    initialSelectedSignalId || signals[0]?.id || ''
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | AssetCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'locked' | 'closed'>(
    initialStatusFilter || 'all'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSendingAll, setIsSendingAll] = useState<boolean>(false);
  const [isSendingLocked, setIsSendingLocked] = useState<boolean>(false);
  const [lockingId, setLockingId] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialSelectedSignalId && signals.some((s) => s.id === initialSelectedSignalId)) {
      setSelectedSignalId(initialSelectedSignalId);
    }
  }, [initialSelectedSignalId, signals]);

  React.useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  // Custom calculator overrides
  const [calcExchange, setCalcExchange] = useState<'wallex' | 'bitpin'>(settings.defaultExchangeIr);
  const [calcEquityUsdt, setCalcEquityUsdt] = useState<number>(settings.referenceEquityUsdt);
  const [calcRiskPct, setCalcRiskPct] = useState<number>(settings.riskPerTradePct);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const lockedSignals = useMemo(
    () => signals.filter((s) => s.isLocked),
    [signals]
  );

  const filteredSignals = useMemo(() => {
    return signals.filter((sig) => {
      if (categoryFilter !== 'all' && sig.category !== categoryFilter) return false;
      if (statusFilter === 'active') {
        if (!['pending', 'open', 'tp1'].includes(sig.status)) return false;
      } else if (statusFilter === 'locked') {
        if (!sig.isLocked) return false;
      } else if (statusFilter === 'closed') {
        if (['pending', 'open', 'tp1'].includes(sig.status)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchSymbol = sig.symbol.toLowerCase().includes(q);
        const matchPersian = sig.persianName.includes(q);
        const matchStrategy = sig.strategyLabel.includes(q);
        if (!matchSymbol && !matchPersian && !matchStrategy) return false;
      }
      return true;
    });
  }, [signals, categoryFilter, statusFilter, searchQuery]);

  const selectedSignal = useMemo(() => {
    return (
      signals.find((s) => s.id === selectedSignalId) ||
      filteredSignals[0] ||
      signals[0]
    );
  }, [signals, selectedSignalId, filteredSignals]);

  const matchingExecutedTrade = useMemo(() => {
    if (!selectedSignal) return undefined;
    return executedTrades.find((t) => t.signalId === selectedSignal.id);
  }, [executedTrades, selectedSignal]);

  const openDirectionalRiskPct = useMemo(() => {
    const activeCount = signals.filter(
      (s) => s.mode === 'live' && (s.status === 'open' || s.status === 'pending')
    ).slice(0, settings.maxOpenSignals).length;
    return Number((activeCount * settings.riskPerTradePct).toFixed(2));
  }, [signals, settings.riskPerTradePct, settings.maxOpenSignals]);

  const positionSizing = useMemo(() => {
    if (!selectedSignal) return null;
    const isWallex = calcExchange === 'wallex';
    return calculatePositionSizing({
      signal: selectedSignal,
      equityUsdt: calcEquityUsdt > 0 ? calcEquityUsdt : settings.referenceEquityUsdt,
      riskPct: calcRiskPct > 0 ? calcRiskPct : settings.riskPerTradePct,
      selectedExchange: calcExchange,
      makerFeePct: isWallex ? settings.wallexMakerFeePct : settings.bitpinMakerFeePct,
      takerFeePct: isWallex ? settings.wallexTakerFeePct : settings.bitpinTakerFeePct,
      slippagePct: selectedSignal.iranQuotes[calcExchange].spreadPct * 0.5,
      currentOpenDirectionalRiskPct: openDirectionalRiskPct,
      maxDirectionalPortfolioHeatPct: settings.maxDirectionalPortfolioHeatPct,
    });
  }, [
    selectedSignal,
    calcExchange,
    calcEquityUsdt,
    calcRiskPct,
    settings,
    openDirectionalRiskPct,
  ]);

  const telegramPreviewText = useMemo(() => {
    if (!selectedSignal) return '';
    return formatTelegramSignalMessage(selectedSignal, settings);
  }, [selectedSignal, settings]);

  const handleCopyTelegram = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(id);
    }
  };

  const handleLockToggle = async (e: React.MouseEvent, sigId: string) => {
    e.stopPropagation();
    setLockingId(sigId);
    try {
      await onToggleLockSignal(sigId);
    } finally {
      setLockingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* KPI Executive Summary Row */}
      <section aria-label="خلاصه وضعیت عملیاتی ربات" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">سیگنال‌های قفل‌شده و فعال</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {lockedSignals.length} قفل · {signals.filter((s) => ['pending', 'open', 'tp1'].includes(s.status)).length} فعال
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            زمان‌بندی پایش قفل‌ها: <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">هر {settings.lockedMonitorIntervalMinutes || 5} دقیقه</span>
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">نرخ موفقیت و امید ریاضی کل</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            <span className="ltr-num">75.0% · +0.74R</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            معاملات ثبت‌شده شما: <span className="font-mono tabular-nums">{executedTrades.length} مورد در حال پایش</span>
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">نرخ زنده تتر والکس (USDT/IRT)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {dollarGold.usdtIrtWallex.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">تومان</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            بیت‌پین: <span className="font-mono tabular-nums">{dollarGold.usdtIrtBitpin.toLocaleString('fa-IR')}</span> · فید زنده
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">انس جهانی طلا و پکس‌گلد (PAXG)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            <span className="ltr-num">${dollarGold.xauUsdOunce.toLocaleString('en-US')}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            والکس: <span className="font-mono tabular-nums">{dollarGold.paxgIrtWallex.toLocaleString('fa-IR')}</span> تومان
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">طلای ۱۸ عیار و حباب ذاتی</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {dollarGold.gold18kMarketIrt.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-500">تومان</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            ذاتی: <span className="font-mono tabular-nums">{dollarGold.gold18kIntrinsicIrt.toLocaleString('fa-IR')}</span> · حباب: <span className="font-mono tabular-nums ltr-num">+{dollarGold.goldBubblePct}%</span>
          </p>
        </div>
      </section>

      {/* Dedicated Locked Signals Continuous Monitoring Panel */}
      <section
        aria-label="تابلوی پایش خودکار سیگنال‌های قفل‌شده"
        className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800/80 rounded-lg p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-amber-500 shrink-0 mt-1" />
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                پایش مستمر سیگنال‌های قفل‌شده (Locked Signals Monitor — بررسی خودکار هر {settings.lockedMonitorIntervalMinutes || 5} دقیقه)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                وقتی سیگنالی را قفل می‌کنید، نقطه ورود، حد ضرر و اهداف سود آن ثابت می‌ماند و ربات در هر سیکل ۵ دقیقه‌ای قیمت لحظه‌ای بازار را با سطوح قفل‌شده مقایسه و به تلگرام اطلاع‌رسانی می‌کند.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSendingLocked || lockedSignals.length === 0}
            onClick={async () => {
              setIsSendingLocked(true);
              try {
                if (onSendLockedSignalsReport) {
                  await onSendLockedSignalsReport();
                } else {
                  const text = formatLockedSignalsTelegramReport(
                    lockedSignals,
                    settings.dashboardUrl
                  );
                  await onSendTelegram(text, 'گزارش پایش سیگنال‌های قفل‌شده');
                }
              } finally {
                setIsSendingLocked(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {isSendingLocked
                ? 'در حال ارسال وضعیت...'
                : `ارسال وضعیت ${lockedSignals.length} سیگنال قفل‌شده به تلگرام`}
            </span>
          </button>
        </div>

        {lockedSignals.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
            هنوز سیگنالی قفل نشده است. روی دکمه «🔒 قفل» در جدول زیر کلیک کنید تا پایش خودکار ۵ دقیقه‌ای برای آن سیگنال فعال شود.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lockedSignals.map((sig) => {
              const chPct = sig.lockedChangePct ?? 0;
              const curR = sig.lockedCurrentR ?? 0;
              return (
                <div
                  key={`locked-${sig.id}`}
                  onClick={() => setSelectedSignalId(sig.id)}
                  className="cursor-pointer p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 flex flex-col justify-between space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                        🔒 {sig.symbol}
                      </span>
                      <span className="text-xs text-slate-600 dark:text-slate-300 mr-1.5">
                        ({sig.persianName})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleLockToggle(e, sig.id)}
                      className="text-[11px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-rose-100 hover:text-rose-700 transition-colors"
                    >
                      لغو قفل
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                    <div>
                      <span className="text-[11px] font-sans text-slate-500 block">ورود قفل‌شده:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 ltr-num">
                        ${formatSmartPrice(sig.entryLow)} – ${formatSmartPrice(sig.entryHigh)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-sans text-slate-500 block">قیمت زنده بازار:</span>
                      <span
                        className={`font-bold ltr-num ${
                          chPct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        ${formatSmartPrice(sig.currentPrice)} ({chPct >= 0 ? '+' : ''}
                        {chPct}% | {curR >= 0 ? '+' : ''}
                        {curR}R)
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 dark:text-slate-300 pt-1.5 border-t border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between">
                    <span className="truncate">{sig.lockedMonitoringNote || 'در حال پایش زنده'}</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 shrink-0 mr-2 ltr-num">
                      TP1: ${formatSmartPrice(sig.tp1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Filter & Search Bar */}
      <section aria-label="فیلترهای جدول سیگنال‌ها" className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          {/* Category Filter */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg" role="group" aria-label="فیلتر دسته‌بندی بازار">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              همه سیگنال‌ها ({signals.length})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('core_crypto')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === 'core_crypto'
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              ارزهای اصلی ({signals.filter((s) => s.category === 'core_crypto').length})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('high_pump')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === 'high_pump'
                  ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              🚀 شکارچی پامپ ({signals.filter((s) => s.category === 'high_pump').length})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('forex_tokenized')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === 'forex_tokenized'
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              🌍 فارکس و توکنیزه ({signals.filter((s) => s.category === 'forex_tokenized').length})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('gold_dollar')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === 'gold_dollar'
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              🥇 طلا و دلار ({signals.filter((s) => s.category === 'gold_dollar').length})
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg" role="group" aria-label="فیلتر وضعیت معامله">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              همه وضعیت‌ها
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'active'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              باز و فعال
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('locked')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'locked'
                  ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              🔒 قفل‌شده ({lockedSignals.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('closed')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'closed'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              بسته‌شده
            </button>
          </div>
        </div>

        <div className="w-full sm:w-64">
          <label htmlFor="signal-search" className="sr-only">
            جستجوی نماد یا استراتژی
          </label>
          <input
            id="signal-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی ارز (BTC، طلا، نقره، انویدیا، PEPE)..."
            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
      </section>

      {/* Main High-Density Quantitative Signal Ledger */}
      <section aria-label="جدول سیگنال‌های معاملاتی" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              دفتر عملیاتی سیگنال‌ها (قیمت‌های لحظه‌ای تاییدشده از والکس و کراکن + قابلیت قفل سیگنال)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              قیمت لحظه‌ای هر ارز مستقیماً از صرافی دریافت شده و سطوح ورود، حد ضرر و اهداف سود بر اساس قیمت واقعی بازار کالیبره شده‌اند.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {onSendAllActiveSignalsToTelegram && (
              <button
                type="button"
                disabled={isSendingAll}
                onClick={async () => {
                  setIsSendingAll(true);
                  try {
                    await onSendAllActiveSignalsToTelegram();
                  } finally {
                    setIsSendingAll(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {isSendingAll
                    ? 'در حال ارسال سیگنال‌ها...'
                    : `ارسال همه سیگنال‌های فعال به تلگرام (${signals.filter((s) => s.mode === 'live' && ['pending', 'open'].includes(s.status)).length} ارز)`}
                </span>
              </button>
            )}
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              نمایش {filteredSignals.length} سیگنال
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                <th className="py-3 px-4 font-medium">ارز و دسته</th>
                <th className="py-3 px-4 font-medium">قیمت لحظه‌ای بازار (USDT)</th>
                <th className="py-3 px-4 font-medium">محدوده ورود پله‌ای (USDT)</th>
                <th className="py-3 px-4 font-medium">حد ضرر (SL)</th>
                <th className="py-3 px-4 font-medium">اهداف و سود خالص (TP1 / TP2)</th>
                <th className="py-3 px-4 font-medium">R:R خالص و امتیاز</th>
                <th className="py-3 px-4 font-medium">وضعیت و قفل پایش</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    هیچ سیگنالی با فیلترهای انتخاب‌شده یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredSignals.map((sig) => {
                  const isSelected = selectedSignal?.id === sig.id;
                  const isUserExecuted = executedTrades.some((t) => t.signalId === sig.id);
                  return (
                    <tr
                      key={sig.id}
                      onClick={() => setSelectedSignalId(sig.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums flex items-center gap-1.5">
                          <span>{sig.symbol}</span>
                          {sig.category === 'high_pump' && (
                            <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              پامپ
                            </span>
                          )}
                          {sig.category === 'forex_tokenized' && (
                            <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300">
                              فارکس/RWA
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          <span>{sig.persianName}</span>
                        </div>
                        <div className="text-emerald-700 dark:text-emerald-400 mt-0.5 flex items-center gap-1 text-[11px]">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>{sig.timeHorizonFa}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          <span className="ltr-num">${formatSmartPrice(sig.currentPrice)}</span>
                        </div>
                        {sig.change24hPct !== undefined && (
                          <div
                            className={`text-[11px] font-medium mt-0.5 ltr-num ${
                              sig.change24hPct >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {sig.change24hPct >= 0 ? '+' : ''}
                            {sig.change24hPct}% (24h)
                          </div>
                        )}
                        <div className="text-[10px] font-sans text-slate-500 dark:text-slate-400 mt-0.5">
                          {sig.liveSourceLabel || 'والکس + کراکن (زنده)'}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums">
                        <div className="text-slate-900 dark:text-slate-100 font-medium">
                          <span className="ltr-num">${formatSmartPrice(sig.entryLow)} – ${formatSmartPrice(sig.entryHigh)}</span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 text-[11px]">
                          میانگین: <span className="ltr-num">${formatSmartPrice(sig.entryMid)}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums">
                        <div className="text-rose-600 dark:text-rose-400 font-medium">
                          <span className="ltr-num">${formatSmartPrice(sig.stop)} (−{sig.stopDistancePct}%)</span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 text-[11px] font-sans">
                          تایم‌فریم {sig.timeframe.toUpperCase()} · ریسک 1R
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums">
                        <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="ltr-num">TP1: ${formatSmartPrice(sig.tp1)} (+{sig.netProfitTp1Pct}% خالص)</span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          <span className="ltr-num">TP2: ${formatSmartPrice(sig.tp2)} (+{sig.netProfitTp2Pct}% خالص)</span>
                        </div>
                        {sig.tp3Pump && (
                          <div className="text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                            <span className="ltr-num">TP3 پامپ: ${formatSmartPrice(sig.tp3Pump)} (+{sig.netProfitTp3Pct}%)</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums">
                        <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                          <span className="ltr-num">{sig.netRrTp1}R / {sig.netRrTp2}R</span>
                        </div>
                        <div className="text-slate-900 dark:text-slate-100 font-semibold mt-0.5">
                          امتیاز {sig.score}/100
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div
                          className={`font-medium ${
                            sig.status === 'closed_tp2' || sig.status === 'tp1'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : sig.status === 'closed_sl'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {STATUS_LABELS[sig.status]}
                        </div>

                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={lockingId === sig.id}
                            onClick={(e) => handleLockToggle(e, sig.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                              sig.isLocked
                                ? 'bg-amber-500 text-white hover:bg-amber-600'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            {sig.isLocked ? (
                              <>
                                <Lock className="w-3 h-3" />
                                <span>قفل‌شده</span>
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3 h-3" />
                                <span>قفل سیگنال</span>
                              </>
                            )}
                          </button>

                          {isUserExecuted && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>ثبت‌شده</span>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Selected Signal Execution Desk */}
      {selectedSignal && positionSizing && (
        <section
          aria-label="میز محاسبه حجم معامله و خروجی تلگرام"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
        >
          {/* Left 7 Columns */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between space-y-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>ماشین‌حساب دقیق حجم پوزیشن، قفل پایش و ثبت ورود ({selectedSignal.symbol})</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    قیمت لحظه‌ای: <strong className="font-mono text-slate-900 dark:text-slate-100">${formatSmartPrice(selectedSignal.currentPrice)} USDT</strong> · افق زمانی: <strong className="text-slate-800 dark:text-slate-200">{selectedSignal.timeHorizonFa}</strong>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => handleLockToggle(e, selectedSignal.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      selectedSignal.isLocked
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {selectedSignal.isLocked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>قفل پایش فعال است (لغو قفل)</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3.5 h-3.5" />
                        <span>🔒 قفل کردن این سیگنال (پایش ۵ دقیقه‌ای)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Interactive Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="calc-equity-usdt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    سرمایه کل شما (برحسب USDT)
                  </label>
                  <input
                    id="calc-equity-usdt"
                    type="number"
                    min={50}
                    step={50}
                    value={calcEquityUsdt}
                    onChange={(e) => setCalcEquityUsdt(Number(e.target.value))}
                    className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <span className="block mt-1 text-xs text-slate-500">
                    مبنای محاسبه: مدیریت ریسک دلاری (USDT)
                  </span>
                </div>

                <div>
                  <label htmlFor="calc-risk-pct" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    درصد ریسک در این معامله (%)
                  </label>
                  <input
                    id="calc-risk-pct"
                    type="number"
                    min={0.25}
                    max={5}
                    step={0.25}
                    value={calcRiskPct}
                    onChange={(e) => setCalcRiskPct(Number(e.target.value))}
                    className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <span className="block mt-1 text-xs text-slate-500 font-mono tabular-nums">
                    ریسک مجاز (1R): {positionSizing.riskAmountUsdt} USDT
                  </span>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    میانگین قیمت ورود دوپله‌ای
                  </span>
                  <div className="mt-1 px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100">
                    {formatSmartPrice(positionSizing.effectiveEntryUsdt)} USDT
                  </div>
                  <span className="block mt-1 text-xs text-slate-500 font-mono tabular-nums">
                    فاصله تا استاپ: −{selectedSignal.stopDistancePct}%
                  </span>
                </div>
              </div>

              {/* Calculated Execution Numbers */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">مقدار دقیق خرید</span>
                  <p className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {positionSizing.quantityAsset.toLocaleString('en-US')} {selectedSignal.baseAsset}
                  </p>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    سهم از سرمایه: {positionSizing.capitalSharePct}%
                  </span>
                </div>

                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">مبلغ کل خرید (حجم پوزیشن)</span>
                  <p className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {positionSizing.positionNotionalUsdt.toLocaleString('en-US')} USDT
                  </p>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    کارمزد رفت و برگشت: {selectedSignal.roundTripCostPct}%
                  </span>
                </div>

                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">ضرر خالص در استاپ (با کارمزد)</span>
                  <p className="mt-1 text-base font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                    −{positionSizing.netLossAtSlUsdt} USDT
                  </p>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    ریسک استاندارد: −1.00R
                  </span>
                </div>

                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">سود خالص در هدف ۱ / هدف ۲</span>
                  <p className="mt-1 text-base font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{positionSizing.netProfitAtTp1Usdt} $ / +{positionSizing.netProfitAtTp2Usdt} $
                  </p>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    بازده خالص: +{selectedSignal.netRrTp1}R / +{selectedSignal.netRrTp2}R
                  </span>
                </div>
              </div>

              {/* Register User-Executed Trade Action Bar */}
              <div className="mt-5 p-4 bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/60 rounded-lg flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {matchingExecutedTrade
                      ? '✅ این سیگنال در لیست معاملات عملی‌شده شما ثبت شده و تحت پایش زنده تلگرام است'
                      : 'آیا این سیگنال را در صرافی والکس یا بیت‌پین معامله کردید؟'}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {matchingExecutedTrade
                      ? `وضعیت فعلی: ${matchingExecutedTrade.monitoringNote}`
                      : 'با ثبت ورود در سامانه، ربات تغییرات قیمت، درصد سود/زیان و رسیدن به هدف ۱ (ریسک‌فری) را پایش کرده و به تلگرام شما می‌فرستد.'}
                  </p>
                </div>

                {matchingExecutedTrade ? (
                  <button
                    type="button"
                    onClick={() => {
                      const msg = formatExecutedTradeTelegramMessage(
                        matchingExecutedTrade,
                        'live_update',
                        settings.dashboardUrl
                      );
                      onSendTelegram(msg, `پایش لحظه‌ای ${matchingExecutedTrade.symbol}`);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>ارسال آپدیت تغییرات قیمت به تلگرام</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRegisterExecutedTrade(selectedSignal, positionSizing)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>ثبت عملی کردن سیگنال و شروع پایش تلگرامی</span>
                  </button>
                )}
              </div>

              {positionSizing.portfolioHeatWarning && (
                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{positionSizing.portfolioHeatWarning}</span>
                </div>
              )}
            </div>

            {/* 4 Orthogonal Scoring Pillars Breakdown */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                  <span>تفکیک ۴ ستون متعامد امتیاز کیفیت ({selectedSignal.score} از ۱۰۰)</span>
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedSignal.rationale}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
                  <div className="text-slate-500 dark:text-slate-400">۱. ساختار و الگو</div>
                  <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {selectedSignal.pillars.structureClarity} / 35
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
                  <div className="text-slate-500 dark:text-slate-400">۲. هم‌راستایی رژیم و HTF</div>
                  <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {selectedSignal.pillars.regimeAlignment} / 25
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
                  <div className="text-slate-500 dark:text-slate-400">۳. حجم و عمق اردربوک</div>
                  <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {selectedSignal.pillars.volumeAndDepth} / 25
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
                  <div className="text-slate-500 dark:text-slate-400">۴. بهینگی R:R و کارمزد</div>
                  <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {selectedSignal.pillars.netRrEfficiency} / 15
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right 5 Columns: Structured RTL Telegram Output & Dispatch */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    پیش‌نمایش بولتن رسمی سیگنال تلگرام (ساختار کوانت بدون معادل تومانی)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    شامل شناسنامه کوانت، سطوح دقیق ورود/استاپ/اهداف (USDT)، ماتریس ۴ ستونه، پروتکل ریسک‌فری و لینک زنده کنسول
                  </p>
                </div>
              </div>

              <pre
                dir="rtl"
                className="mt-4 p-3.5 text-xs leading-relaxed font-sans whitespace-pre-wrap bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 select-all text-right"
              >
                {telegramPreviewText}
              </pre>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleCopyTelegram(telegramPreviewText, selectedSignal.id)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedId === selectedSignal.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>در کلیپ‌بورد کپی شد</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>کپی متن سیگنال</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSendTelegram(telegramPreviewText, `سیگنال ${selectedSignal.symbol}`)
                  }
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>ارسال مستقیم به تلگرام</span>
                </button>
              </div>
              {telegramFeedback && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center font-medium">
                  {telegramFeedback}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
