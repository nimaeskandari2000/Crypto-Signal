import React from 'react';
import {
  DataSourceHealth,
  PostmortemTagSummary,
} from '../engine/types';
import { SCORE_BRACKET_STATS } from '../engine/seedData';
import { FileSearch, Server } from 'lucide-react';

interface PostmortemAndHealthViewProps {
  postmortem: PostmortemTagSummary[];
  sourceHealth: DataSourceHealth[];
}

export const PostmortemAndHealthView: React.FC<PostmortemAndHealthViewProps> = ({
  postmortem,
  sourceHealth,
}) => {
  const brackets = Object.values(SCORE_BRACKET_STATS);

  return (
    <div className="space-y-8">
      {/* Section 1: Automated Loss Postmortem Table */}
      <section aria-label="کالبدشکافی خودکار معاملات ضررده" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>کالبدشکافی خودکار ضررها (Postmortem Engine) و قوانین پیشنهادی</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            هر معامله‌ای که با حد ضرر بسته می‌شود، بر اساس اسنپ‌شات بازار در لحظه ورود و خروج به صورت خودکار برچسب‌گذاری شده و قانون اصلاحی متناظر استخراج می‌شود.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                <th className="py-3 px-4 font-medium">برچسب علت ضرر</th>
                <th className="py-3 px-4 font-medium">تعداد رخداد</th>
                <th className="py-3 px-4 font-medium">سهم از کل ضررها</th>
                <th className="py-3 px-4 font-medium">میانگین R ثبت‌شده</th>
                <th className="py-3 px-4 font-medium">قانون محافظتی استخراج‌شده توسط موتور یادگیری</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {postmortem.map((item) => (
                <tr key={item.tag} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {item.persianLabel}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      {item.tag}
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {item.occurrences} مورد
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    <span className="ltr-num">{item.shareOfLossesPct}%</span>
                  </td>

                  <td className="py-3.5 px-4 font-mono tabular-nums text-rose-600 dark:text-rose-400 font-medium">
                    <span className="ltr-num">{item.avgRealizedR}R</span>
                  </td>

                  <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 leading-relaxed max-w-md">
                    {item.suggestedRule}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Empirical Score Bracket Calibration Table */}
      <section aria-label="جدول کالیبراسیون بازه‌های امتیازی" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            جدول کالیبراسیون واقعی بازه‌های امتیاز (Empirical Score Calibration)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            آمار واقعی که در پایین هر پیام تلگرام درج می‌شود (بازه‌هایی که کمتر از ۳۰ نمونه دارند با برچسب «داده کافی نیست» مشخص می‌شوند).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                <th className="py-3 px-4 font-medium">بازه امتیاز کیفیت</th>
                <th className="py-3 px-4 font-medium">تعداد نمونه واقعی (N)</th>
                <th className="py-3 px-4 font-medium">نرخ رسیدن به هدف اول (TP1)</th>
                <th className="py-3 px-4 font-medium">میانگین امید ریاضی خالص (R)</th>
                <th className="py-3 px-4 font-medium">وضعیت اعتبار آماری و مجوز ارسال</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs font-mono tabular-nums">
              {brackets.map((b) => (
                <tr key={b.bracketLabel} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-sans font-semibold text-slate-900 dark:text-slate-100">
                    امتیاز {b.bracketLabel}
                  </td>
                  <td className="py-3 px-4 text-slate-800 dark:text-slate-200">
                    {b.sampleSize} سیگنال
                  </td>
                  <td className="py-3 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                    {b.sufficientSample ? <span className="ltr-num">{b.tp1WinRatePct}%</span> : 'داده ناکافی (<30)'}
                  </td>
                  <td
                    className={`py-3 px-4 font-semibold ${
                      b.avgNetR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    <span className="ltr-num">
                      {b.avgNetR >= 0 ? '+' : ''}
                      {b.avgNetR}R
                    </span>
                  </td>
                  <td className="py-3 px-4 font-sans text-slate-600 dark:text-slate-300">
                    {b.sufficientSample
                      ? 'معتبر (N ≥ 30) · درج درصد واقعی در سیگنال تلگرام'
                      : 'نمونه کمتر از ۳۰ · فقط ثبت در حالت Shadow'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Data Source Health & Fallback Chain */}
      <section aria-label="سلامت منابع داده رایگان و زنجیره جایگزین" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>سلامت منابع داده رایگان و زنجیره جایگزین (Zero-Downtime Architecture)</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            طبق اصل ۵ سند، قطع شدن هیچ منبعی ربات را متوقف نمی‌کند و به صورت خودکار به صرافی جایگزین یا اسنپ‌شات کش‌شده سوییچ می‌شود.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/50">
                <th className="py-3 px-4 font-medium">منبع داده</th>
                <th className="py-3 px-4 font-medium">دسته‌بندی</th>
                <th className="py-3 px-4 font-medium">وضعیت اتصال</th>
                <th className="py-3 px-4 font-medium">تأخیر پاسخ</th>
                <th className="py-3 px-4 font-medium">مسیر جایگزین (Fallback)</th>
                <th className="py-3 px-4 font-medium">توضیحات فنی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {sourceHealth.map((src) => (
                <tr key={src.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                    {src.name}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                    {src.category}
                  </td>
                  <td className="py-3.5 px-4">
                    <span
                      className={`font-medium ${
                        src.status === 'online'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : src.status === 'fallback'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {src.status === 'online'
                        ? 'متصل و برخط (Online)'
                        : src.status === 'fallback'
                          ? 'زنجیره جایگزین فعال (Fallback)'
                          : 'خطا (رد لایه)'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {src.latencyMs} ms
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                    {src.fallbackUsed}
                  </td>
                  <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                    {src.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
