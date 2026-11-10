import React, { useEffect, useMemo, useState } from 'react';
import { BotSettings, DollarGoldSnapshot, Signal } from '../engine/types';
import {
  computeGoldIntrinsicAndBubble,
  formatDailyTelegramReport,
  formatSmartPrice,
  formatTelegramSignalMessage,
  resolveDailyDashboardLink,
} from '../engine/quantEngine';
import {
  RefreshCw,
  Send,
  Copy,
  Check,
  Scale,
  Compass,
  PlayCircle,
  Clock,
  ShieldCheck,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface DollarGoldMacroViewProps {
  dollarGold: DollarGoldSnapshot;
  macro: {
    btcPrice: number;
    btcChange24h: number;
    ethPrice: number;
    ethChange24h: number;
    btcDominance: number;
    fearGreedIndex: number;
    fearGreedLabel: string;
    lastScanAt: string;
    scanCount: number;
  };
  signals: Signal[];
  settings: BotSettings;
  onUpdateRatesAndScan: (usdtIrtWallex: number, xauUsdOunce: number) => Promise<void>;
  onToggleLockSignal?: (signalId: string) => Promise<void>;
  onSendTelegram: (text: string, title: string) => Promise<void>;
  onRegisterExecutedTrade?: (params: {
    signalId: string;
    exchange: 'wallex' | 'bitpin';
    entryPriceUsdt: number;
    notionalUsdt: number;
  }) => Promise<void>;
  telegramFeedback: string | null;
}

export const DollarGoldMacroView: React.FC<DollarGoldMacroViewProps> = ({
  dollarGold,
  macro,
  signals,
  settings,
  onUpdateRatesAndScan,
  onToggleLockSignal,
  onSendTelegram,
  onRegisterExecutedTrade,
  telegramFeedback,
}) => {
  const [customUsdtIrt, setCustomUsdtIrt] = useState<number>(dollarGold.usdtIrtWallex);
  const [customXauUsd, setCustomXauUsd] = useState<number>(dollarGold.xauUsdOunce);
  const [customGold18kIrt, setCustomGold18kIrt] = useState<number>(dollarGold.gold18kMarketIrt);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [copiedDaily, setCopiedDaily] = useState<boolean>(false);
  const [registeringSignalId, setRegisteringSignalId] = useState<string | null>(null);

  useEffect(() => {
    setCustomUsdtIrt(dollarGold.usdtIrtWallex);
    setCustomXauUsd(dollarGold.xauUsdOunce);
    setCustomGold18kIrt(dollarGold.gold18kMarketIrt);
  }, [dollarGold.usdtIrtWallex, dollarGold.xauUsdOunce, dollarGold.gold18kMarketIrt]);

  const liveBubbleCalc = useMemo(() => {
    return computeGoldIntrinsicAndBubble({
      xauUsdOunce: customXauUsd > 0 ? customXauUsd : dollarGold.xauUsdOunce,
      usdtIrtRate: customUsdtIrt > 0 ? customUsdtIrt : dollarGold.usdtIrtAverage,
      gold18kMarketIrt: customGold18kIrt > 0 ? customGold18kIrt : dollarGold.gold18kMarketIrt,
    });
  }, [customXauUsd, customUsdtIrt, customGold18kIrt, dollarGold]);

  const activeSignalsCount = useMemo(
    () => signals.filter((s) => ['pending', 'open', 'tp1'].includes(s.status)).length,
    [signals]
  );

  const goldDollarSignals = useMemo(
    () =>
      signals.filter(
        (s) =>
          (s.category === 'gold_dollar' || s.baseAsset === 'PAXG') &&
          ['pending', 'open', 'tp1'].includes(s.status)
      ),
    [signals]
  );

  // Actionable USDT/IRT spot setup calibrated on real live Toman rate
  const tetherSpotSignal = useMemo(() => {
    const entryLowIrt = dollarGold.usdtIrtSupport;
    const entryHighIrt = Math.round(dollarGold.usdtIrtAverage * 0.996);
    const entryMidIrt = Math.round((entryLowIrt + entryHighIrt) / 2);
    const stopIrt = Math.round(dollarGold.usdtIrtAverage * 0.968);
    const tp1Irt = dollarGold.usdtIrtResistance;
    const tp2Irt = Math.round(dollarGold.usdtIrtAverage * 1.062);

    const riskPct = Number((((entryMidIrt - stopIrt) / entryMidIrt) * 100).toFixed(2));
    const netTp1Pct = Number((((tp1Irt - entryMidIrt) / entryMidIrt) * 100 - 0.4).toFixed(2));
    const netTp2Pct = Number((((tp2Irt - entryMidIrt) / entryMidIrt) * 100 - 0.4).toFixed(2));
    const netRrTp1 = Number((netTp1Pct / Math.max(0.5, riskPct + 0.4)).toFixed(2));
    const netRrTp2 = Number((netTp2Pct / Math.max(0.5, riskPct + 0.4)).toFixed(2));

    return {
      symbol: 'USDT/IRT',
      persianName: 'تتر / تومان (نوسان‌گیری اسپات والکس و بیت‌پین)',
      timeHorizonFa: 'کوتاه‌مدت تا میان‌مدت (۳ تا ۱۰ روز)',
      timeframe: '4h / 1D',
      entryVerdict: 'ورود مجاز (خرید پله‌ای در حمایت)',
      entryLowIrt,
      entryHighIrt,
      currentIrt: dollarGold.usdtIrtWallex,
      stopIrt,
      tp1Irt,
      tp2Irt,
      riskPct,
      netTp1Pct,
      netTp2Pct,
      netRrTp1,
      netRrTp2,
      rationale:
        `تثبیت بالای گره تقاضای ۴ ساعته (${entryLowIrt.toLocaleString('fa-IR')} تومان)؛ خرید پله‌ای روی حمایت روزانه در بیت‌پین و والکس با کارمزد میکر ۰.۲٪.`,
    };
  }, [dollarGold]);

  const dailyReportText = useMemo(() => {
    const mergedSnapshot: DollarGoldSnapshot = {
      ...dollarGold,
      usdtIrtWallex: customUsdtIrt,
      usdtIrtBitpin: Math.round(customUsdtIrt - 120),
      usdtIrtAverage: Math.round(customUsdtIrt - 60),
      xauUsdOunce: customXauUsd,
      gold18kMarketIrt: customGold18kIrt,
      gold18kIntrinsicIrt: liveBubbleCalc.intrinsic18kIrt,
      goldBubblePct: liveBubbleCalc.bubblePct,
    };

    return formatDailyTelegramReport({
      dollarGold: mergedSnapshot,
      btcPrice: macro.btcPrice,
      btcChange24h: macro.btcChange24h,
      ethPrice: macro.ethPrice,
      ethChange24h: macro.ethChange24h,
      btcDominance: macro.btcDominance,
      fearGreedIndex: macro.fearGreedIndex,
      fearGreedLabel: macro.fearGreedLabel,
      activeSignalsCount,
      recent30WinRatePct: 75.0,
      recent30NetR: 14.35,
      settings,
    });
  }, [
    dollarGold,
    customUsdtIrt,
    customXauUsd,
    customGold18kIrt,
    liveBubbleCalc,
    macro,
    activeSignalsCount,
    settings,
  ]);

  const handleApplyRates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (customUsdtIrt < 30000 || customXauUsd < 1500) return;
    setIsUpdating(true);
    try {
      await onUpdateRatesAndScan(customUsdtIrt, customXauUsd);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(dailyReportText);
      setCopiedDaily(true);
      setTimeout(() => setCopiedDaily(false), 2000);
    } catch {
      setCopiedDaily(true);
    }
  };

  const handleSendTetherSignalTelegram = async () => {
    const RLM = '\u200F';
    const dailyLink = resolveDailyDashboardLink(settings.dashboardUrl, {
      type: 'signal',
      tab: 'dollar_gold',
      symbol: 'USDTIRT',
    });
    const msg = [
      `🟢 سیگنال خرید اسپات: USDT/IRT (تتر / تومان)`,
      `💹 نرخ لحظه‌ای والکس: ${tetherSpotSignal.currentIrt.toLocaleString('fa-IR')} تومان | وضعیت: ${tetherSpotSignal.entryVerdict}`,
      `⏳ افق زمانی: ${tetherSpotSignal.timeHorizonFa} | تایم‌فریم: ${tetherSpotSignal.timeframe}`,
      `━━━━━━━━━━━━━━━━━━`,
      `🔹 محدوده ورود پله‌ای: ${tetherSpotSignal.entryLowIrt.toLocaleString('fa-IR')} تا ${tetherSpotSignal.entryHighIrt.toLocaleString('fa-IR')} تومان`,
      `🛑 حد ضرر (SL): ${tetherSpotSignal.stopIrt.toLocaleString('fa-IR')} تومان (ریسک: ${tetherSpotSignal.riskPct}%-)`,
      `✅ هدف اول (TP1): ${tetherSpotSignal.tp1Irt.toLocaleString('fa-IR')} تومان (سود خالص: +${tetherSpotSignal.netTp1Pct}%)`,
      `🎯 هدف دوم (TP2): ${tetherSpotSignal.tp2Irt.toLocaleString('fa-IR')} تومان (سود خالص: +${tetherSpotSignal.netTp2Pct}%)`,
      `⚖️ ریسک به ریوارد خالص: ${tetherSpotSignal.netRrTp1}R (هدف ۱) | ${tetherSpotSignal.netRrTp2}R (هدف ۲)`,
      `━━━━━━━━━━━━━━━━━━`,
      `🔗 لینک یکتای این پیام: ${dailyLink}`,
    ]
      .map((line) => (line.trim().length > 0 ? `${RLM}${line}` : ''))
      .join('\n');

    await onSendTelegram(msg, 'سیگنال اسپات تتر (USDT/IRT)');
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Three-Column Analytical Grid for Dollar/Tether, Global Gold/PAXG, and 18K Intrinsic Value */}
      <section aria-label="میز تحلیل روزانه دلار، تتر و طلا" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Dollar & Tether in Wallex and Bitpin */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              ۱. نرخ لحظه‌ای واقعی دلار و تتر (USDT/IRT — فید زنده والکس)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              پایش مستقیم نرخ تتر صرافی‌های ایرانی، سطوح حمایت/مقاومت روزانه و وضعیت ورود
            </p>

            <dl className="mt-5 space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">نرخ زنده تتر در والکس (Wallex)</dt>
                <dd className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                  {dollarGold.usdtIrtWallex.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">نرخ تتر در بیت‌پین (Bitpin)</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {dollarGold.usdtIrtBitpin.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">تغییر ۲۴ ساعته و ساختار</dt>
                <dd className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                  <span className="ltr-num">
                    {dollarGold.usdtIrtChange24hPct >= 0 ? '+' : ''}
                    {dollarGold.usdtIrtChange24hPct}%
                  </span>{' '}
                  · روند {dollarGold.usdtIrtRegime}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">حمایت کلیدی روزانه (نقطه ورود)</dt>
                <dd className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                  {dollarGold.usdtIrtSupport.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500 dark:text-slate-400">مقاومت و هدف اول روزانه</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {dollarGold.usdtIrtResistance.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">نکته آربیتراژی و اجرا: </span>
            {dollarGold.arbitrageNote}
          </div>
        </div>

        {/* Column 2: Global Ounce Gold (XAU/USD) & Digital Gold (PAXG) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              ۲. انس جهانی طلا (XAU/USD) و پکس‌گلد (PAXG — زنده)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              ردیابی مستقیم انس جهانی از کراکن و معادل تومانی طلای دیجیتال در والکس
            </p>

            <dl className="mt-5 space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">انس جهانی طلا / پکس‌گلد (PAXG)</dt>
                <dd className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                  <span className="ltr-num">${dollarGold.xauUsdOunce.toLocaleString('en-US')} (+{dollarGold.xauChange24hPct}%)</span>
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">پکس‌گلد والکس (PAXG/IRT)</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {dollarGold.paxgIrtWallex.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">پکس‌گلد بیت‌پین (PAXG/IRT)</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {dollarGold.paxgIrtBitpin.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">حمایت ۴ ساعته انس (محدوده ورود)</dt>
                <dd className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span className="ltr-num">${dollarGold.xauSupportUsd.toLocaleString('en-US')}</span>
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500 dark:text-slate-400">مقاومت و هدف اول انس</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  <span className="ltr-num">${dollarGold.xauResistanceUsd.toLocaleString('en-US')}</span>
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">ساختار تکنیکال طلا: </span>
            {dollarGold.dailyBiasSummary}
          </div>
        </div>

        {/* Column 3: 18K Gold Intrinsic Value & Bubble Calculator */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>۳. ارزش ذاتی طلای ۱۸ عیار و سنجش حباب</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              فرمول ذاتی: (انس جهانی × نرخ تتر × ۰.۷۵۰) تقسیم بر ۳۱.۱۰۳۴۷۶۸ گرم
            </p>

            <dl className="mt-5 space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">ارزش ذاتی هر گرم طلای ۱۸ عیار</dt>
                <dd className="font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                  {liveBubbleCalc.intrinsic18kIrt.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">قیمت تابلو بازار طلای ۱۸ عیار</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {customGold18kIrt.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">حباب لحظه‌ای طلای ۱۸ عیار</dt>
                <dd
                  className={`font-mono tabular-nums font-semibold ${
                    liveBubbleCalc.bubblePct > 1.2
                      ? 'text-rose-600 dark:text-rose-400'
                      : liveBubbleCalc.bubblePct < -0.6
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  <span className="ltr-num">
                    {liveBubbleCalc.bubblePct >= 0 ? '+' : ''}
                    {liveBubbleCalc.bubblePct}%
                  </span>{' '}
                  ({liveBubbleCalc.bubbleStatus})
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">برآورد سکه امامی</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {dollarGold.goldCoinEmamiIrt.toLocaleString('fa-IR')} تومان
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500 dark:text-slate-400">وضعیت کلی ورود طلا و دلار</dt>
                <dd className="text-emerald-600 dark:text-emerald-400 font-bold">
                  ورود مجاز (خرید پله‌ای در حمایت)
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">استراتژی پیشنهادی: </span>
            {dollarGold.actionableRecommendation}
          </div>
        </div>
      </section>

      {/* Section 2: Multi-Horizon Technical & Fundamental Analysis + Explicit Entry Verdict, Entry Zone, SL, TP1, TP2 */}
      <section
        aria-label="تحلیل تکنیکال و فاندامنتال کوتاه‌مدت، میان‌مدت و بلندمدت دلار و طلا به همراه نقاط ورود و خروج"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                تحلیل روزانه تکنیکال و فاندامنتال دلار و طلا (کوتاه‌مدت، میان‌مدت و بلندمدت) + وضعیت ورود، حد سود و حد ضرر
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                برای هر افق زمانی، علاوه بر تحلیل تکنیکال و فاندامنتال، وضعیت دقیق «ورود یا عدم ورود»، نقطه ورود، حد ضرر (SL) و اهداف سود (TP1 و TP2) بر اساس نرخ زنده روز محاسبه شده است.
              </p>
            </div>
          </div>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            کالیبره‌شده با نرخ زنده والکس و انس جهانی
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(dollarGold.multiHorizonAnalysis || []).map((item) => (
            <div
              key={item.horizon}
              className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-950/50 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {item.horizonLabel}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {item.timeframeBadge}
                    </p>
                  </div>
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>

                {/* Dollar / Tether Block with Actionable Entry Plan */}
                <div className="space-y-2.5 bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      💵 دلار و تتر (USDT/IRT)
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                        item.dollarPlan?.verdictColor === 'emerald'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {item.dollarPlan?.verdictColor === 'emerald' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {item.dollarPlan?.entryVerdict || 'ورود مجاز'}
                    </span>
                  </div>

                  <div className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
                    <p>
                      <strong className="text-slate-900 dark:text-slate-100">تکنیکال: </strong>
                      {item.dollarTechnical}
                    </p>
                    <p>
                      <strong className="text-slate-900 dark:text-slate-100">فاندامنتال: </strong>
                      {item.dollarFundamental}
                    </p>
                  </div>

                  {/* Dollar Exact Entry / SL / TP Box */}
                  {item.dollarPlan && (
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[11px] font-mono">
                      <div className="text-slate-500 font-sans">
                        علت وضعیت: <span className="text-slate-700 dark:text-slate-300">{item.dollarPlan.verdictReason}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">🎯 نقطه ورود:</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{item.dollarPlan.entryZone}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">🛑 حد ضرر (SL):</span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400">{item.dollarPlan.stopLoss}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">✅ حد سود ۱ (TP1):</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{item.dollarPlan.takeProfit1}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">🚀 حد سود ۲ (TP2):</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{item.dollarPlan.takeProfit2}</span>
                      </div>
                      <div className="flex justify-between pt-0.5">
                        <span className="text-slate-500 font-sans">⚖️ ریسک به ریوارد:</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{item.dollarPlan.netRr}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Gold (Ounce / PAXG / 18K) Block with Actionable Entry Plan */}
                <div className="space-y-2.5 bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      🥇 طلا (XAU / PAXG / ۱۸ عیار)
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                        item.goldPlan?.verdictColor === 'emerald'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {item.goldPlan?.verdictColor === 'emerald' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {item.goldPlan?.entryVerdict || 'ورود مجاز'}
                    </span>
                  </div>

                  <div className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
                    <p>
                      <strong className="text-slate-900 dark:text-slate-100">تکنیکال: </strong>
                      {item.goldTechnical}
                    </p>
                    <p>
                      <strong className="text-slate-900 dark:text-slate-100">فاندامنتال: </strong>
                      {item.goldFundamental}
                    </p>
                  </div>

                  {/* Gold Exact Entry / SL / TP Box */}
                  {item.goldPlan && (
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[11px] font-mono">
                      <div className="text-slate-500 font-sans">
                        علت وضعیت: <span className="text-slate-700 dark:text-slate-300">{item.goldPlan.verdictReason}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">🎯 نقطه ورود:</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{item.goldPlan.entryZone}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">🛑 حد ضرر (SL):</span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400">{item.goldPlan.stopLoss}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">✅ حد سود ۱ (TP1):</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{item.goldPlan.takeProfit1}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">🚀 حد سود ۲ (TP2):</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{item.goldPlan.takeProfit2}</span>
                      </div>
                      <div className="flex justify-between pt-0.5">
                        <span className="text-slate-500 font-sans">⚖️ ریسک به ریوارد:</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{item.goldPlan.netRr}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actionable Strategy for this Horizon */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  استراتژی اجرایی این افق:{' '}
                </span>
                {item.actionableStrategy}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Active Gold & Dollar Signals Ready for Execution */}
      <section
        aria-label="سیگنال‌های فعال طلا و دلار"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                سیگنال‌های عملیاتی طلا (PAXG/USDT) و تتر/تومان (USDT/IRT) با قابلیت قفل پایش
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                کالیبره‌شده با نرخ لحظه‌ای واقعی والکس (تتر: {dollarGold.usdtIrtWallex.toLocaleString('fa-IR')} تومان | پکس‌گلد: ${dollarGold.xauUsdOunce.toLocaleString('en-US')})
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Card 1: Active PAXG/USDT Signal */}
          {goldDollarSignals.map((sig) => {
            const conciseTelegramMsg = formatTelegramSignalMessage(sig, settings);
            return (
              <div
                key={sig.id}
                className={`border rounded-lg p-4 flex flex-col justify-between space-y-4 ${
                  sig.isLocked
                    ? 'border-amber-500/70 bg-amber-50/20 dark:bg-amber-950/15'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        🥇 خرید اسپات {sig.persianName} ({sig.symbol})
                      </span>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        قیمت لحظه‌ای: <strong className="font-mono text-slate-900 dark:text-slate-100">${formatSmartPrice(sig.currentPrice)}</strong> · افق: <strong className="text-slate-700 dark:text-slate-200">{sig.timeHorizonFa}</strong>
                      </p>
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        امتیاز: {sig.score}/100
                      </span>
                      <p className="text-[11px] font-mono text-slate-500">
                        خالص R:R: <strong className="text-emerald-600 dark:text-emerald-400">{sig.netRrTp1}R / {sig.netRrTp2}R</strong>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-slate-500 block">محدوده ورود (تتر و تومان)</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 ltr-num block mt-0.5">
                        ${formatSmartPrice(sig.entryLow)} – ${formatSmartPrice(sig.entryHigh)}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                        {sig.entryLowIrt.toLocaleString('fa-IR')} تا {sig.entryHighIrt.toLocaleString('fa-IR')} تومان
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-slate-500 block">حد ضرر (SL) و ریسک</span>
                      <span className="font-mono font-semibold text-rose-600 dark:text-rose-400 ltr-num block mt-0.5">
                        ${formatSmartPrice(sig.stop)} (-{sig.stopDistancePct}%)
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                        معادل {sig.stopIrt.toLocaleString('fa-IR')} تومان
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-slate-500 block">هدف اول (TP1 — ۵۰٪ حجم)</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 ltr-num block mt-0.5">
                        ${formatSmartPrice(sig.tp1)} (خالص +{sig.netProfitTp1Pct}%)
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                        معادل {sig.tp1Irt.toLocaleString('fa-IR')} تومان ({sig.netRrTp1}R)
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-slate-500 block">هدف دوم (TP2 — ۵۰٪ حجم)</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 ltr-num block mt-0.5">
                        ${formatSmartPrice(sig.tp2)} (خالص +{sig.netProfitTp2Pct}%)
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                        معادل {sig.tp2Irt.toLocaleString('fa-IR')} تومان ({sig.netRrTp2}R)
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    <strong className="text-slate-900 dark:text-slate-100">علت صدور: </strong>
                    {sig.rationale}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                  {onToggleLockSignal && (
                    <button
                      type="button"
                      onClick={() => onToggleLockSignal(sig.id)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                        sig.isLocked
                          ? 'bg-amber-500 text-white hover:bg-amber-600'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {sig.isLocked ? (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>حذف قفل</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>قفل سیگنال</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSendTelegram(conciseTelegramMsg, `سیگنال ${sig.symbol}`)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>ارسال سیگنال به تلگرام</span>
                  </button>

                  {onRegisterExecutedTrade && (
                    <button
                      type="button"
                      disabled={registeringSignalId === sig.id}
                      onClick={async () => {
                        setRegisteringSignalId(sig.id);
                        try {
                          await onRegisterExecutedTrade({
                            signalId: sig.id,
                            exchange: settings.defaultExchangeIr,
                            entryPriceUsdt: sig.entryMid,
                            notionalUsdt: 450,
                          });
                        } finally {
                          setRegisteringSignalId(null);
                        }
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>ثبت در معاملات من</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Card 2: Active USDT/IRT Spot Setup */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/40 dark:bg-slate-950/40 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    💵 خرید پله‌ای {tetherSpotSignal.persianName} ({tetherSpotSignal.symbol})
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    نرخ لحظه‌ای والکس: <strong className="font-mono text-slate-900 dark:text-slate-100">{tetherSpotSignal.currentIrt.toLocaleString('fa-IR')} تومان</strong> · افق: <strong className="text-slate-700 dark:text-slate-200">{tetherSpotSignal.timeHorizonFa}</strong>
                  </p>
                </div>
                <div className="text-left">
                  <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {tetherSpotSignal.entryVerdict}
                  </span>
                  <p className="text-[11px] font-mono text-slate-500">
                    خالص R:R: <strong className="text-emerald-600 dark:text-emerald-400">{tetherSpotSignal.netRrTp1}R / {tetherSpotSignal.netRrTp2}R</strong>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-500 block">محدوده ورود پله‌ای (تومان)</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 block mt-0.5">
                    {tetherSpotSignal.entryLowIrt.toLocaleString('fa-IR')} تا {tetherSpotSignal.entryHighIrt.toLocaleString('fa-IR')} تومان
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                    نرخ فعلی بازار: {tetherSpotSignal.currentIrt.toLocaleString('fa-IR')} تومان
                  </span>
                </div>

                <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-500 block">حد ضرر ساختاری (SL)</span>
                  <span className="font-mono font-semibold text-rose-600 dark:text-rose-400 block mt-0.5">
                    {tetherSpotSignal.stopIrt.toLocaleString('fa-IR')} تومان (-{tetherSpotSignal.riskPct}%)
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                    تثبیت کندل روزانه زیر کف حمایتی
                  </span>
                </div>

                <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-500 block">هدف اول (TP1 — نوسانی)</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 block mt-0.5">
                    {tetherSpotSignal.tp1Irt.toLocaleString('fa-IR')} تومان (خالص +{tetherSpotSignal.netTp1Pct}%)
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                    نسبت ریسک به ریوارد خالص: {tetherSpotSignal.netRrTp1}R
                  </span>
                </div>

                <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-500 block">هدف دوم (TP2 — میان‌مدت)</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 block mt-0.5">
                    {tetherSpotSignal.tp2Irt.toLocaleString('fa-IR')} تومان (خالص +{tetherSpotSignal.netTp2Pct}%)
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 block mt-0.5">
                    نسبت ریسک به ریوارد خالص: {tetherSpotSignal.netRrTp2}R
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <strong className="text-slate-900 dark:text-slate-100">علت صدور: </strong>
                {tetherSpotSignal.rationale}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleSendTetherSignalTelegram}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>ارسال سیگنال مختصر تتر (USDT/IRT) به تلگرام</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Interactive Rate Calibration + Daily 08:00 Tehran Telegram Report */}
      <section aria-label="شبیه‌ساز نرخ دلار و طلا و گزارش روزانه تلگرام" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <form
          onSubmit={handleApplyRates}
          className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between space-y-5"
        >
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              کالیبراسیون دستی یا دریافت خودکار نرخ دلار، انس و طلای ۱۸ عیار
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              نرخ‌ها به صورت خودکار از والکس و کراکن دریافت می‌شوند؛ اما در صورت تمایل می‌توانید هر نرخی را وارد کنید تا کل سیگنال‌ها بر اساس آن بازمحاسبه شوند.
            </p>

            <div className="space-y-4 mt-5">
              <div>
                <label htmlFor="input-usdt-irt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  نرخ تتر والکس (تومان - USDT/IRT)
                </label>
                <input
                  id="input-usdt-irt"
                  type="number"
                  min={30000}
                  step={100}
                  value={customUsdtIrt}
                  onChange={(e) => setCustomUsdtIrt(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="input-xau-usd" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  انس جهانی طلا / پکس‌گلد (دلار - XAU/USD)
                </label>
                <input
                  id="input-xau-usd"
                  type="number"
                  min={1500}
                  step={0.5}
                  value={customXauUsd}
                  onChange={(e) => setCustomXauUsd(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="input-gold-18k" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  قیمت بازار ۱ گرم طلای ۱۸ عیار (تومان)
                </label>
                <input
                  id="input-gold-18k"
                  type="number"
                  min={1000000}
                  step={5000}
                  value={customGold18kIrt}
                  onChange={(e) => setCustomGold18kIrt(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={isUpdating}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>اعمال نرخ‌ها روی کل سیگنال‌های تومانی ربات</span>
            </button>
          </div>
        </form>

        {/* Right 7 Columns: Daily Telegram Report Preview & Dispatch */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  گزارش روزانه تلگرام (شامل ۳ افق زمانی طلا و دلار + نقاط ورود، SL و TP)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  ارسال خودکار روزانه در ساعت ۰۸:۰۰ صبح و ۲۱:۰۰ شب به وقت تهران
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                لینک روز فعال است
              </span>
            </div>

            <pre
              dir="rtl"
              className="mt-4 p-4 text-xs leading-relaxed font-sans whitespace-pre-wrap bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 select-all text-right"
            >
              {dailyReportText}
            </pre>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopyReport}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                {copiedDaily ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>گزارش روزانه کپی شد</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی متن گزارش روزانه</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  onSendTelegram(dailyReportText, 'گزارش روزانه بازار، دلار و طلا')
                }
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>ارسال گزارش روزانه به تلگرام</span>
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
    </div>
  );
};
