import React, { useMemo, useState } from 'react';
import {
  BotSettings,
  DailyPerformanceReport,
  Signal,
  UserExecutedTrade,
} from '../engine/types';
import {
  computeSignalWinRateMetrics,
  formatDailyPerformanceTelegramReport,
  formatExecutedTradeTelegramMessage,
} from '../engine/quantEngine';
import {
  CheckCircle2,
  Send,
  Copy,
  Check,
  Activity,
  FileSpreadsheet,
  RefreshCw,
  CheckSquare,
  XCircle,
} from 'lucide-react';

interface PerformanceAndTradesViewProps {
  signals: Signal[];
  executedTrades: UserExecutedTrade[];
  dailyReports: DailyPerformanceReport[];
  settings: BotSettings;
  onUpdateExecutedTradePrice: (tradeId: string, newPriceUsdt: number) => void;
  onCloseExecutedTrade: (
    tradeId: string,
    closeStatus: 'tp1_hit' | 'closed_tp2' | 'closed_sl' | 'closed_manual'
  ) => void;
  onRecordTodayReport: () => void;
  onSendTelegram: (text: string, title: string) => Promise<void>;
  telegramFeedback: string | null;
}

const TRADE_STATUS_BADGE: Record<
  UserExecutedTrade['status'],
  { label: string; colorClass: string }
> = {
  active: {
    label: 'در حال پایش زنده (فعال)',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  },
  tp1_hit: {
    label: 'رسیده به هدف ۱ (ریسک‌فری‌شده)',
    colorClass: 'text-emerald-600 dark:text-emerald-400 font-semibold',
  },
  closed_tp2: {
    label: 'بسته‌شده در هدف ۲ (سود کامل)',
    colorClass: 'text-emerald-600 dark:text-emerald-400 font-semibold',
  },
  closed_sl: {
    label: 'بسته‌شده در حد ضرر (SL)',
    colorClass: 'text-rose-600 dark:text-rose-400',
  },
  closed_manual: {
    label: 'بسته‌شده دستی توسط کاربر',
    colorClass: 'text-slate-600 dark:text-slate-400',
  },
};

export const PerformanceAndTradesView: React.FC<PerformanceAndTradesViewProps> = ({
  signals,
  executedTrades,
  dailyReports,
  settings,
  onUpdateExecutedTradePrice,
  onCloseExecutedTrade,
  onRecordTodayReport,
  onSendTelegram,
  telegramFeedback,
}) => {
  const [selectedReportId, setSelectedReportId] = useState<string>(
    dailyReports[0]?.id || ''
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({});

  const winRateSummary = useMemo(
    () => computeSignalWinRateMetrics(signals, executedTrades),
    [signals, executedTrades]
  );

  const selectedReport = useMemo(
    () =>
      dailyReports.find((r) => r.id === selectedReportId) ||
      dailyReports[0] ||
      null,
    [dailyReports, selectedReportId]
  );

  const selectedReportTelegramText = useMemo(() => {
    if (!selectedReport) return '';
    return formatDailyPerformanceTelegramReport(
      selectedReport,
      winRateSummary,
      settings.dashboardUrl
    );
  }, [selectedReport, winRateSummary, settings.dashboardUrl]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(id);
    }
  };

  return (
    <div className="space-y-8">
      {/* 1. Supervisory Win-Rate & Portfolio Performance KPIs */}
      <section
        aria-label="خلاصه نرخ موفقیت سیگنال‌ها و عملکرد معاملات شما"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
      >
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            نرخ موفقیت کل سیگنال‌ها (Win Rate)
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            <span className="ltr-num">{winRateSummary.winRatePct}%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {winRateSummary.wonSignals} برد از {winRateSummary.resolvedSignals} معامله بسته‌شده ·{' '}
            {winRateSummary.invalidatedBeforeEntry} ابطال هوشمند
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            امید ریاضی و فاکتور سود (Profit Factor)
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            <span className="ltr-num">
              {winRateSummary.expectancyR >= 0 ? '+' : ''}
              {winRateSummary.expectancyR}R
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            فاکتور سود خالص:{' '}
            <span className="font-mono tabular-nums ltr-num">
              {winRateSummary.profitFactor}
            </span>{' '}
            · پس از کسر کارمزد
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            بازدهی تجمعی ثبت‌شده ربات
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            <span className="ltr-num">+14.35R</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            میانگین نرخ برد ۵ روز اخیر:{' '}
            <span className="font-mono tabular-nums ltr-num">66.3%</span>
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            معاملات عملی‌شده توسط شما
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {winRateSummary.userTradesTotal} معامله
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            در حال پایش زنده:{' '}
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {winRateSummary.userTradesActive}
            </span>{' '}
            · نرخ برد شما:{' '}
            <span className="font-mono tabular-nums ltr-num">
              {winRateSummary.userTradesWinRatePct}%
            </span>
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            سود / زیان خالص معاملات ثبت‌شده شما
          </p>
          <p
            className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
              winRateSummary.userTotalPnlUsdt >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            <span className="ltr-num">
              {winRateSummary.userTotalPnlUsdt >= 0 ? '+' : ''}
              {winRateSummary.userTotalPnlUsdt} USDT
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            محاسبه خالص پس از کسر کارمزد صرافی
          </p>
        </div>
      </section>

      {/* 2. Live Monitoring Ledger for User-Executed Trades */}
      <section
        aria-label="میز پایش زنده معاملات عملی‌شده توسط کاربر"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                پایش زنده سیگنال‌های عملی‌شده توسط شما (ارسال خودکار تغییرات قیمت و عملکرد به تلگرام)
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              هر سیگنالی را که در تب «سیگنال‌ها» با دکمه «ثبت عملی کردن معامله» ثبت کنید، در این جدول قرار می‌گیرد و تغییرات قیمت، رسیدن به TP1 (ریسک‌فری) و سود/زیان تتری و مضرب R آن پایش و به تلگرام شما ارسال می‌شود.
            </p>
          </div>
          {telegramFeedback && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {telegramFeedback}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                <th className="py-3 px-4 font-medium">نماد و صرافی</th>
                <th className="py-3 px-4 font-medium">افق زمانی و مدل</th>
                <th className="py-3 px-4 font-medium">ورود ثبت‌شده و حجم</th>
                <th className="py-3 px-4 font-medium">قیمت فعلی و درصد تغییر</th>
                <th className="py-3 px-4 font-medium">سود / زیان لحظه‌ای (USDT / R)</th>
                <th className="py-3 px-4 font-medium">حد ضرر و اهداف</th>
                <th className="py-3 px-4 font-medium">وضعیت پایش</th>
                <th className="py-3 px-4 font-medium">ارسال تلگرام و مدیریت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {executedTrades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    هنوز معامله‌ای ثبت نکرده‌اید. از تب «سیگنال‌ها و اجرای معامله» روی دکمه «ثبت عملی کردن سیگنال» کلیک کنید.
                  </td>
                </tr>
              ) : (
                executedTrades.map((trade) => {
                  const badge = TRADE_STATUS_BADGE[trade.status];
                  const isPositive = trade.pnlUsdt >= 0;
                  const priceInputVal =
                    customPrices[trade.id] !== undefined
                      ? customPrices[trade.id]
                      : String(trade.currentPriceUsdt);

                  return (
                    <tr
                      key={trade.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {trade.symbol}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          <span>{trade.persianName}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {trade.exchange === 'wallex' ? 'والکس' : 'بیت‌پین'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {trade.timeHorizonFa}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {trade.strategyLabel}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums">
                        <div className="text-slate-900 dark:text-slate-100 font-medium">
                          ورود: <span className="ltr-num">${trade.entryPriceUsdt.toLocaleString('en-US')} USDT</span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          حجم: <span className="ltr-num">{trade.quantityAsset} {trade.baseAsset}</span> (<span className="ltr-num">${trade.notionalUsdt.toLocaleString('en-US')}</span>)
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="any"
                            aria-label={`قیمت فعلی ${trade.symbol}`}
                            value={priceInputVal}
                            onChange={(e) =>
                              setCustomPrices((prev) => ({
                                ...prev,
                                [trade.id]: e.target.value,
                              }))
                            }
                            className="w-24 px-2 py-1 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const parsed = Number(priceInputVal);
                              if (!Number.isNaN(parsed) && parsed > 0) {
                                onUpdateExecutedTradePrice(trade.id, parsed);
                              }
                            }}
                            title="به‌روزرسانی قیمت و بررسی هشدار هدف/استاپ"
                            className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded transition-colors"
                          >
                            بروزرسانی
                          </button>
                        </div>
                        <div
                          className={`mt-1 font-medium ${
                            trade.priceChangePct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          تغییر از ورود:{' '}
                          <span className="ltr-num">
                            {trade.priceChangePct >= 0 ? '+' : ''}
                            {trade.priceChangePct}%
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums">
                        <div
                          className={`font-semibold ${
                            isPositive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          <span className="ltr-num">
                            {isPositive ? '+' : ''}
                            {trade.pnlUsdt} USDT
                          </span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 ltr-num">
                          بازده استاندارد: {isPositive ? '+' : ''}
                          {trade.unrealizedOrRealizedR}R
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums">
                        <div className="text-rose-600 dark:text-rose-400">
                          SL: <span className="ltr-num">${trade.stopUsdt.toLocaleString('en-US')}</span>
                        </div>
                        <div className="text-emerald-600 dark:text-emerald-400 mt-0.5">
                          TP1: <span className="ltr-num">${trade.tp1Usdt.toLocaleString('en-US')}</span> · TP2:{' '}
                          <span className="ltr-num">${trade.tp2Usdt.toLocaleString('en-US')}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className={badge.colorClass}>{badge.label}</div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 max-w-[230px]">
                          {trade.monitoringNote}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const msg = formatExecutedTradeTelegramMessage(
                                trade,
                                trade.status === 'tp1_hit' ? 'tp1_risk_free' : 'live_update',
                                settings.dashboardUrl
                              );
                              onSendTelegram(msg, `پایش قیمت ${trade.symbol}`);
                            }}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors whitespace-nowrap"
                          >
                            <Send className="w-3 h-3" />
                            <span>ارسال تغییرات به تلگرام</span>
                          </button>

                          <div className="flex items-center gap-1">
                            {trade.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => onCloseExecutedTrade(trade.id, 'tp1_hit')}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded transition-colors whitespace-nowrap"
                              >
                                <CheckSquare className="w-3 h-3" />
                                <span>ریسک‌فری (TP1)</span>
                              </button>
                            )}
                            {(trade.status === 'active' || trade.status === 'tp1_hit') && (
                              <button
                                type="button"
                                onClick={() => onCloseExecutedTrade(trade.id, 'closed_tp2')}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded transition-colors whitespace-nowrap"
                              >
                                <XCircle className="w-3 h-3" />
                                <span>بستن معامله</span>
                              </button>
                            )}
                          </div>
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

      {/* 3. Daily Signal Performance Reports Archive & Telegram Output */}
      <section
        aria-label="آرشیو گزارش‌های روزانه نرخ موفقیت سیگنال‌ها"
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
      >
        {/* Left 7 Columns: Daily Reports Table */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>کارنامه روزانه نرخ موفقیت سیگنال‌ها (ثبت خودکار روزانه)</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  هر روز خلاصه عملکرد سیگنال‌ها، نرخ برد (Win Rate)، برآیند R و نرخ پایانی دلار و طلا در این بخش ثبت و آرشیو می‌شود.
                </p>
              </div>

              <button
                type="button"
                onClick={onRecordTodayReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>ثبت / بروزرسانی کارنامه امروز و ارسال تلگرام</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                    <th className="py-3 px-4 font-medium">تاریخ کارنامه</th>
                    <th className="py-3 px-4 font-medium">سیگنال‌ها (TP1 / TP2 / SL)</th>
                    <th className="py-3 px-4 font-medium">نرخ موفقیت روز</th>
                    <th className="py-3 px-4 font-medium">برآیند خالص روز</th>
                    <th className="py-3 px-4 font-medium">برترین سیگنال</th>
                    <th className="py-3 px-4 font-medium">تتر و طلای ۱۸ عیار</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {dailyReports.map((rep) => {
                    const isSelected = selectedReport?.id === rep.id;
                    return (
                      <tr
                        key={rep.id}
                        onClick={() => setSelectedReportId(rep.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {rep.persianDate}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                            {rep.dateKey}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="text-slate-900 dark:text-slate-100 font-medium">
                            کل: {rep.totalSignalsIssued} · بسته‌شده: {rep.resolvedCount}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                            TP1: {rep.wonTp1Count} · TP2: {rep.wonTp2Count} · SL: {rep.stoppedSlCount}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="font-bold text-emerald-600 dark:text-emerald-400">
                            <span className="ltr-num">{rep.winRatePct}%</span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                            تجمعی: <span className="ltr-num">{rep.cumulativeWinRatePct}%</span>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div
                            className={`font-semibold ${
                              rep.netRealizedR >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            <span className="ltr-num">
                              {rep.netRealizedR >= 0 ? '+' : ''}
                              {rep.netRealizedR}R
                            </span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                            کل: <span className="ltr-num">+{rep.cumulativeNetR}R</span>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {rep.bestSignalSymbol}
                          </div>
                          <div className="text-emerald-600 dark:text-emerald-400 mt-0.5">
                            <span className="ltr-num">+{rep.bestSignalR}R</span>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="text-slate-900 dark:text-slate-100">
                            تتر: {rep.usdtIrtClose.toLocaleString('fa-IR')} ت
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                            طلا: {rep.gold18kCloseIrt.toLocaleString('fa-IR')} ت
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedReport && (
            <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  یادداشت نظارتی ({selectedReport.persianDate}):{' '}
                </span>
                <span>{selectedReport.summaryNote}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right 5 Columns: Selected Day's Structured Telegram Report Preview */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                متن ساختارمند کارنامه روزانه برای تلگرام ({selectedReport?.persianDate})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                شامل نرخ موفقیت روزانه و تجمعی، وضعیت معاملات شما و لینک مستقیم گزارش روز
              </p>
            </div>

            <pre
              dir="rtl"
              className="mt-4 p-3.5 text-xs leading-relaxed font-sans whitespace-pre-wrap bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 select-all text-right"
            >
              {selectedReportTelegramText}
            </pre>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                handleCopy(selectedReportTelegramText, selectedReport?.id || 'rep')
              }
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              {copiedId === (selectedReport?.id || 'rep') ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>کپی شد</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>کپی متن کارنامه</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                onSendTelegram(
                  selectedReportTelegramText,
                  `کارنامه عملکرد ${selectedReport?.persianDate || 'امروز'}`
                )
              }
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>ارسال کارنامه به تلگرام</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
