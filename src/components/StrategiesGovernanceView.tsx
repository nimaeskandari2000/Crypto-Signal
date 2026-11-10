import React from 'react';
import {
  ChallengerComparison,
  StrategyId,
  StrategyValidationMetrics,
} from '../engine/types';
import { ShieldCheck, AlertTriangle, ArrowUpRight, Power } from 'lucide-react';

interface StrategiesGovernanceViewProps {
  strategies: StrategyValidationMetrics[];
  challenger: ChallengerComparison;
  onToggleStrategy: (id: StrategyId) => Promise<void>;
  onSimulateCircuitBreaker: (id: StrategyId) => Promise<void>;
  onPromoteChallenger: () => Promise<void>;
}

export const StrategiesGovernanceView: React.FC<StrategiesGovernanceViewProps> = ({
  strategies,
  challenger,
  onToggleStrategy,
  onSimulateCircuitBreaker,
  onPromoteChallenger,
}) => {
  return (
    <div className="space-y-8">
      {/* Walk-Forward Acceptance Gate Summary */}
      <section aria-label="قواعد دروازه پذیرش بک‌تست و نگهبان عملکرد" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              مدیریت استراتژی‌ها، اعتبارسنجی Walk-Forward و کلید قطع خودکار (Circuit Breaker)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              طبق فلسفه ربات، هیچ مدلی بدون عبور از دروازه پذیرش (امید ریاضی خارج از نمونه ≥ +0.15R، ضریب سود ≥ 1.25، و حداقل ۶۰٪ پنجره‌های Walk-Forward مثبت) اجازه ورود به حالت عملیاتی (Live) را ندارد.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>مدل‌های فعال (Live): {strategies.filter((s) => s.enabled).length}</span>
            <span aria-hidden="true">·</span>
            <span>مدل‌های آزمایشی (Shadow): {strategies.filter((s) => !s.enabled).length}</span>
          </div>
        </div>
      </section>

      {/* Strategies Table */}
      <section aria-label="جدول مدل‌های تحلیلی و آمار بک‌تست" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                <th className="py-3 px-4 font-medium">مدل تحلیلی و نسخه</th>
                <th className="py-3 px-4 font-medium">بازارها و تایم‌فریم</th>
                <th className="py-3 px-4 font-medium">امید ریاضی و PF (خارج از نمونه)</th>
                <th className="py-3 px-4 font-medium">پنجره‌های Walk-Forward</th>
                <th className="py-3 px-4 font-medium">مونت‌کارلو (۹۵٪ افت)</th>
                <th className="py-3 px-4 font-medium">عملکرد زنده (۳۰ معامله اخیر)</th>
                <th className="py-3 px-4 font-medium">وضعیت فعلی</th>
                <th className="py-3 px-4 font-medium">عملیات و تست ایمنی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {strategies.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 max-w-xs">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {st.persianName}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      <span className="font-mono">{st.id}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono">{st.version}</span>
                      <span aria-hidden="true"> · </span>
                      <span>حداقل R:R: {st.params.minRr}</span>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {st.description}
                    </p>
                    {st.autoDemotedByCircuitBreaker && st.demotionReason && (
                      <div className="mt-2 p-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 rounded text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{st.demotionReason}</span>
                      </div>
                    )}
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums">
                    <div className="text-slate-900 dark:text-slate-100">
                      {st.markets.includes('spot_ir') && st.markets.includes('perp_global')
                        ? 'اسپات ایران + پرپچوال'
                        : st.markets.includes('spot_ir')
                          ? 'فقط اسپات ایران'
                          : 'پرپچوال جهانی'}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      بازه: {st.timeframes.join(' / ')}
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums">
                    <div
                      className={`font-semibold ${
                        st.walkForward.expectancyR >= 0.15
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      <span className="ltr-num">+{st.walkForward.expectancyR}R</span> · <span className="ltr-num">PF {st.walkForward.profitFactor}</span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      برد: <span className="ltr-num">{st.walkForward.winRatePct}%</span> ({st.walkForward.outOfSampleTrades} معامله)
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums">
                    <div className="text-slate-900 dark:text-slate-100 font-medium">
                      <span className="ltr-num">{st.walkForward.positiveWindowsPct}%</span> مثبت
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      پایداری پارامتر: <span className="ltr-num">{st.walkForward.parameterStabilityScore}/100</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums">
                    <div className="text-slate-900 dark:text-slate-100">
                      <span className="ltr-num">−{st.walkForward.monteCarlo95MaxDdR}R</span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      سقف مجاز: <span className="ltr-num">−{st.livePerformance.maxAllowedDrawdownR}R</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums">
                    <div
                      className={`font-semibold ${
                        st.livePerformance.recent30ExpectancyR >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      <span className="ltr-num">
                        {st.livePerformance.recent30ExpectancyR >= 0 ? '+' : ''}
                        {st.livePerformance.recent30ExpectancyR}R
                      </span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      ضرر پیاپی: {st.livePerformance.consecutiveLosses} · افت جاری: <span className="ltr-num">−{st.livePerformance.currentDrawdownR}R</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <div
                      className={`font-semibold ${
                        st.enabled
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : st.autoDemotedByCircuitBreaker
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {st.enabled
                        ? 'فعال در تلگرام (Live)'
                        : st.autoDemotedByCircuitBreaker
                          ? 'متوقف توسط کلید قطع (Shadow)'
                          : 'آزمایشی (Shadow)'}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {st.walkForward.passedGate ? 'تأییدشده در دروازه بک‌تست' : 'ردشده در دروازه (کمتر از 0.15R)'}
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!st.walkForward.passedGate && !st.enabled}
                        onClick={() => onToggleStrategy(st.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                          st.enabled
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                            : st.walkForward.passedGate
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-slate-100 dark:bg-slate-900 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{st.enabled ? 'انتقال به Shadow' : 'فعال‌سازی Live'}</span>
                      </button>

                      {st.enabled && (
                        <button
                          type="button"
                          onClick={() => onSimulateCircuitBreaker(st.id)}
                          className="px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors whitespace-nowrap shrink-0"
                        >
                          تست کلید قطع (۸ ضرر)
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Champion vs Challenger Calibration Section */}
      <section aria-label="کالیبراسیون امتیازدهی قهرمان و رقیب" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>کالیبراسیون محافظت‌شده وزن‌ها: قهرمان (Champion) در برابر رقیب (Challenger)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              وزن‌های ۴ ستون متعامد امتیازدهی با رگرسیون لجستیک منظم‌شده روی {challenger.shadowTradesCount} معامله بسته شده در {challenger.weeksRunning} هفته اخیر بازتنظیم شده‌اند (حداکثر تغییر مجاز در هر نوبت: ±۳ امتیاز).
            </p>
          </div>

          <button
            type="button"
            disabled={challenger.promoted}
            onClick={onPromoteChallenger}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>
              {challenger.promoted
                ? 'وزن‌های رقیب با موفقیت جایگزین قهرمان شد'
                : 'تأیید و ارتقای وزن‌های رقیب به قهرمان (Live)'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
          {/* Performance Comparison */}
          <div className="space-y-3 text-xs">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
              مقایسه آماری عملکرد در دوره آزمایش موازی ({challenger.weeksRunning} هفته)
            </h4>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">امید ریاضی قهرمان فعلی (Champion)</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                +{challenger.championExpectancyR}R (حداکثر افت: −{challenger.championMaxDdR}R)
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">امید ریاضی تنظیمات رقیب (Challenger)</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                +{challenger.challengerExpectancyR}R (حداکثر افت: −{challenger.challengerMaxDdR}R)
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-slate-500 dark:text-slate-400">کران پایین فاصله اطمینان ۸۰٪ برتری رقیب</span>
              <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                +{challenger.confidenceLowerBoundDiffR}R (&gt; 0 تأیید آماری)
              </span>
            </div>
          </div>

          {/* 4-Pillar Weight Comparison */}
          <div className="space-y-3 text-xs">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
              مقایسه وزن ۴ ستون متعامد امتیازدهی (مجموع = ۱۰۰)
            </h4>
            <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="font-sans text-slate-500 dark:text-slate-400">۱. وضوح ساختار و پرایس اکشن</div>
                <div className="mt-1 text-slate-900 dark:text-slate-100">
                  قهرمان: {challenger.championWeights.structureClarity} ← رقیب: <strong>{challenger.challengerWeights.structureClarity}</strong>
                </div>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="font-sans text-slate-500 dark:text-slate-400">۲. هم‌راستایی رژیم و تایم‌فریم بالاتر</div>
                <div className="mt-1 text-slate-900 dark:text-slate-100">
                  قهرمان: {challenger.championWeights.regimeAlignment} ← رقیب: <strong>{challenger.challengerWeights.regimeAlignment}</strong>
                </div>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="font-sans text-slate-500 dark:text-slate-400">۳. حجم و عمق اردربوک والکس/بیت‌پین</div>
                <div className="mt-1 text-slate-900 dark:text-slate-100">
                  قهرمان: {challenger.championWeights.volumeAndDepth} ← رقیب: <strong>{challenger.challengerWeights.volumeAndDepth}</strong>
                </div>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="font-sans text-slate-500 dark:text-slate-400">۴. بهینگی R:R خالص پس از کارمزد</div>
                <div className="mt-1 text-slate-900 dark:text-slate-100">
                  قهرمان: {challenger.championWeights.netRrEfficiency} ← رقیب: <strong>{challenger.challengerWeights.netRrEfficiency}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
