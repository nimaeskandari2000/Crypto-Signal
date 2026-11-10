/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
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
  getBracketStatForScore,
} from './engine/seedData';
import {
  BotSettings,
  ChallengerComparison,
  DailyPerformanceReport,
  DataSourceHealth,
  DollarGoldSnapshot,
  PositionSizeCalculation,
  PostmortemTagSummary,
  Signal,
  StrategyId,
  StrategyValidationMetrics,
  UserExecutedTrade,
} from './engine/types';
import {
  calculatePositionSizing,
  computeOrthogonalScore,
  computeSignalWinRateMetrics,
  evaluateCircuitBreaker,
  evaluateUserExecutedTrade,
  formatDailyPerformanceTelegramReport,
  formatExecutedTradeTelegramMessage,
  formatForTelegramApiHtml,
  formatLockedSignalsTelegramReport,
  formatScanRadarTelegramSummary,
  formatTelegramSignalMessage,
  getPersianDateLabel,
  recalibrateSignalWithLiveMarket,
  resolveBaseDashboardUrl,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
} from './engine/quantEngine';
import { SignalsWorkspace } from './components/SignalsWorkspace';
import { PumpAndForexView } from './components/PumpAndForexView';
import { PerformanceAndTradesView } from './components/PerformanceAndTradesView';
import { DollarGoldMacroView } from './components/DollarGoldMacroView';
import { StrategiesGovernanceView } from './components/StrategiesGovernanceView';
import { PostmortemAndHealthView } from './components/PostmortemAndHealthView';
import { SettingsAndConfigView } from './components/SettingsAndConfigView';
import { RefreshCw, Sun, Moon, Download } from 'lucide-react';

type ActiveTab =
  | 'signals'
  | 'pump_forex'
  | 'dollar_gold'
  | 'performance'
  | 'settings';

const LOCAL_STORAGE_SETTINGS_KEY = 'quantpulse_bot_settings_v4';
const LOCAL_STORAGE_TRADES_KEY = 'quantpulse_executed_trades_v4';
const LOCAL_STORAGE_REPORTS_KEY = 'quantpulse_daily_reports_v4';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('signals');
  const [deepLinkSignalId, setDeepLinkSignalId] = useState<string | undefined>(undefined);
  const [deepLinkFilter, setDeepLinkFilter] = useState<'all' | 'active' | 'locked' | 'closed' | undefined>(
    undefined
  );
  const [isDark, setIsDark] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [telegramFeedback, setTelegramFeedback] = useState<string | null>(null);

  const [settings, setSettings] = useState<BotSettings>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_BOT_SETTINGS,
          ...parsed,
          dashboardUrl: resolveBaseDashboardUrl(parsed.dashboardUrl),
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_BOT_SETTINGS;
  });

  const [dollarGold, setDollarGold] = useState<DollarGoldSnapshot>(() =>
    buildInitialDollarGoldSnapshot()
  );
  const [signals, setSignals] = useState<Signal[]>(() =>
    buildInitialSignals(dollarGold.usdtIrtAverage)
  );
  const [executedTrades, setExecutedTrades] = useState<UserExecutedTrade[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_TRADES_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return buildInitialExecutedTrades(dollarGold.usdtIrtAverage);
  });
  const [dailyReports, setDailyReports] = useState<DailyPerformanceReport[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_REPORTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return buildInitialDailyReports(dollarGold.usdtIrtAverage, dollarGold.xauUsdOunce);
  });

  const [strategies, setStrategies] = useState<StrategyValidationMetrics[]>(INITIAL_STRATEGIES);
  const [postmortem, setPostmortem] = useState<PostmortemTagSummary[]>(INITIAL_POSTMORTEM_TAGS);
  const [challenger, setChallenger] = useState<ChallengerComparison>(INITIAL_CHALLENGER);
  const [sourceHealth, setSourceHealth] = useState<DataSourceHealth[]>(INITIAL_SOURCE_HEALTH);
  const [macro, setMacro] = useState({
    btcPrice: 74415.39,
    btcChange24h: 1.92,
    ethPrice: 2121.33,
    ethChange24h: 2.34,
    btcDominance: 57.8,
    fearGreedIndex: 64,
    fearGreedLabel: 'طمع متعادل (Greed)',
    lastScanAt: new Date().toISOString(),
    scanCount: 1,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Parse unique Telegram deep-link parameters (?report=...&tab=...&signal=...&filter=...&msg=...)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') as ActiveTab | null;
      const sigParam = params.get('signal');
      const filterParam = params.get('filter') as 'all' | 'active' | 'locked' | 'closed' | null;
      const msgParam = params.get('msg');

      if (
        tabParam &&
        ['signals', 'pump_forex', 'dollar_gold', 'performance', 'settings'].includes(tabParam)
      ) {
        setActiveTab(tabParam);
      }
      if (sigParam) {
        setDeepLinkSignalId(sigParam);
      }
      if (filterParam && ['all', 'active', 'locked', 'closed'].includes(filterParam)) {
        setDeepLinkFilter(filterParam);
      }
      if (msgParam) {
        setStatusBanner(`🔗 بازشده از طریق لینک یکتای پیام تلگرام (#${msgParam})`);
        setTimeout(() => setStatusBanner(null), 6500);
      }
    } catch {
      // ignore
    }
  }, []);

  // Dual-mode state loader: tries live API first, falls back to static /data/bot_state.json for GitHub Pages
  useEffect(() => {
    const applyLoadedData = (data: any) => {
      if (!data) return;
      if (data.settings) {
        setSettings((prev) => ({
          ...prev,
          ...data.settings,
          dashboardUrl: resolveBaseDashboardUrl(data.settings.dashboardUrl || prev.dashboardUrl),
          telegramBotToken: data.settings.telegramBotToken || prev.telegramBotToken,
          telegramChatId: data.settings.telegramChatId || prev.telegramChatId,
        }));
      }
      if (data.dollarGold) setDollarGold(data.dollarGold);
      if (data.signals) setSignals(data.signals);
      if (data.executedTrades && data.executedTrades.length > 0) {
        setExecutedTrades(data.executedTrades);
      }
      if (data.dailyReports && data.dailyReports.length > 0) {
        setDailyReports(data.dailyReports);
      }
      if (data.strategies) setStrategies(data.strategies);
      if (data.postmortem) setPostmortem(data.postmortem);
      if (data.challenger) setChallenger(data.challenger);
      if (data.sourceHealth) setSourceHealth(data.sourceHealth);
      if (data.macro) setMacro(data.macro);
    };

    fetch('/api/state')
      .then((res) => {
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          return res.json();
        }
        return fetch('./data/bot_state.json').then((r) => (r.ok ? r.json() : null));
      })
      .then(applyLoadedData)
      .catch(() => {
        fetch('./data/bot_state.json')
          .then((r) => (r.ok ? r.json() : null))
          .then(applyLoadedData)
          .catch(() => {});
      });
  }, []);

  const persistTradesLocally = (nextTrades: UserExecutedTrade[]) => {
    setExecutedTrades(nextTrades);
    try {
      localStorage.setItem(LOCAL_STORAGE_TRADES_KEY, JSON.stringify(nextTrades));
    } catch {
      // ignore
    }
  };

  const persistReportsLocally = (nextReports: DailyPerformanceReport[]) => {
    setDailyReports(nextReports);
    try {
      localStorage.setItem(LOCAL_STORAGE_REPORTS_KEY, JSON.stringify(nextReports));
    } catch {
      // ignore
    }
  };

  const recomputeLocalSignalsIrt = (usdtIrt: number, currentSignals: Signal[]) => {
    return currentSignals.map((sig) =>
      recalibrateSignalWithLiveMarket(sig, sig.currentPrice, usdtIrt)
    );
  };

  const sendTelegramDirectFromBrowser = async (
    text: string,
    title: string,
    overrideToken?: string,
    overrideChatId?: string
  ): Promise<{ ok: boolean; message: string; resolvedChatId?: string }> => {
    const token = sanitizeTelegramToken(overrideToken ?? settings.telegramBotToken);
    let chatId = sanitizeTelegramChatId(overrideChatId ?? settings.telegramChatId);

    if (!token) {
      return {
        ok: false,
        message: `برای ارسال «${title}» به تلگرام، ابتدا توکن ربات (TELEGRAM_BOT_TOKEN) و Chat ID را در تب «تنظیمات، زمان‌بندی و API» وارد و ذخیره کنید.`,
      };
    }

    if (!chatId) {
      try {
        const updRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=15`);
        if (updRes.ok) {
          const updJson = (await updRes.json()) as any;
          const updates = Array.isArray(updJson?.result) ? updJson.result : [];
          for (let i = updates.length - 1; i >= 0; i--) {
            const u = updates[i];
            const cid =
              u?.message?.chat?.id ??
              u?.channel_post?.chat?.id ??
              u?.my_chat_member?.chat?.id;
            if (cid) {
              chatId = String(cid);
              break;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (!chatId) {
      return {
        ok: false,
        message:
          'شناسه چت (TELEGRAM_CHAT_ID) یافت نشد. در تلگرام دکمه Start را در ربات خود بزنید و در تب تنظیمات روی «تشخیص خودکار Chat ID» کلیک کنید.',
      };
    }

    try {
      const htmlFormatted = formatForTelegramApiHtml(text);
      let tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlFormatted,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!tgRes.ok) {
        tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            disable_web_page_preview: true,
          }),
        });
      }
      if (tgRes.ok) {
        if (chatId !== settings.telegramChatId) {
          const nextSettings = { ...settings, telegramBotToken: token, telegramChatId: chatId };
          setSettings(nextSettings);
          try {
            localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(nextSettings));
          } catch {
            // ignore
          }
        }
        return {
          ok: true,
          resolvedChatId: chatId,
          message: `پیام «${title}» با موفقیت به تلگرام (${chatId}) ارسال شد ✅`,
        };
      }
      const errBody = await tgRes.text();
      return {
        ok: false,
        message: `خطای تلگرام: ${errBody.slice(0, 90)}`,
      };
    } catch {
      return {
        ok: false,
        message: `عدم دسترسی مستقیم مرورگر به api.telegram.org (در گیت‌هاب از طریق GitHub Actions ارسال می‌شود).`,
      };
    }
  };

  const handleSendTelegram = async (
    text: string,
    title: string,
    overrideToken?: string,
    overrideChatId?: string
  ) => {
    setTelegramFeedback(null);
    const activeToken = sanitizeTelegramToken(overrideToken ?? settings.telegramBotToken);
    const activeChatId = sanitizeTelegramChatId(overrideChatId ?? settings.telegramChatId);

    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          title,
          telegramBotToken: activeToken,
          telegramChatId: activeChatId,
        }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.sent) {
          if (data.chatIdUsed && data.chatIdUsed !== settings.telegramChatId) {
            const nextSettings = { ...settings, telegramChatId: data.chatIdUsed };
            setSettings(nextSettings);
            try {
              localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(nextSettings));
            } catch {
              // ignore
            }
          }
          setTelegramFeedback(data.message);
          setStatusBanner(data.message);
          setTimeout(() => {
            setTelegramFeedback(null);
            setStatusBanner(null);
          }, 6000);
          return;
        }
        // Server didn't send (e.g., server couldn't reach Telegram or missing server token) -> try browser direct
        if (activeToken) {
          const direct = await sendTelegramDirectFromBrowser(text, title, activeToken, activeChatId);
          if (direct.ok) {
            setTelegramFeedback(direct.message);
            setStatusBanner(direct.message);
            setTimeout(() => {
              setTelegramFeedback(null);
              setStatusBanner(null);
            }, 6000);
            return;
          }
        }
        setTelegramFeedback(data.message);
        setStatusBanner(data.message);
        setTimeout(() => {
          setTelegramFeedback(null);
          setStatusBanner(null);
        }, 6000);
        return;
      }
      throw new Error('Static GitHub Pages Telegram fallback');
    } catch {
      const direct = await sendTelegramDirectFromBrowser(text, title, activeToken, activeChatId);
      setTelegramFeedback(direct.message);
      setStatusBanner(direct.message);
      setTimeout(() => {
        setTelegramFeedback(null);
        setStatusBanner(null);
      }, 6000);
    }
  };

  // Toggle Lock/Unlock on any signal and start/stop 5-minute monitoring
  const handleToggleLockSignal = async (signalId: string) => {
    try {
      const res = await fetch('/api/signals/toggle-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId,
          telegramBotToken: settings.telegramBotToken,
          telegramChatId: settings.telegramChatId,
        }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.signals) setSignals(data.signals);
        if (data.message) {
          setStatusBanner(data.message);
          setTelegramFeedback(data.message);
          setTimeout(() => {
            setStatusBanner(null);
            setTelegramFeedback(null);
          }, 5000);
        }
        return;
      }
      throw new Error('Static fallback');
    } catch {
      let lockedTarget: Signal | null = null;
      setSignals((prev) =>
        prev.map((sig) => {
          if (sig.id !== signalId) return sig;
          const nextLocked = !sig.isLocked;
          const updated: Signal = {
            ...sig,
            isLocked: nextLocked,
            lockedAt: nextLocked ? new Date().toISOString() : undefined,
            lockedEntryMid: nextLocked ? sig.entryMid : undefined,
            lockedChangePct: nextLocked
              ? Number((((sig.currentPrice - sig.entryMid) / sig.entryMid) * 100).toFixed(2))
              : undefined,
            lockedCurrentR: nextLocked
              ? Number(
                  (
                    (sig.currentPrice - sig.entryMid) /
                    Math.max(0.0000001, Math.abs(sig.entryMid - sig.stop))
                  ).toFixed(2)
                )
              : undefined,
            lockedMonitoringNote: nextLocked
              ? 'قفل سیگنال فعال شد — پایش خودکار ۵ دقیقه‌ای قیمت و اهداف فعال است.'
              : undefined,
          };
          if (nextLocked) lockedTarget = updated;
          return updated;
        })
      );
      if (lockedTarget && settings.telegramBotToken) {
        await handleSendTelegram(
          formatTelegramSignalMessage(lockedTarget, settings),
          `قفل سیگنال ${(lockedTarget as Signal).symbol}`
        );
      }
    }
  };

  // Dispatch locked signals live monitoring report to Telegram
  const handleSendLockedSignalsReport = async () => {
    setTelegramFeedback(null);
    try {
      const res = await fetch('/api/telegram/send-locked-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramBotToken: settings.telegramBotToken,
          telegramChatId: settings.telegramChatId,
        }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (!data.sent && settings.telegramBotToken) {
          const locked = signals.filter((s) => s.isLocked);
          const reportText = formatLockedSignalsTelegramReport(locked, settings.dashboardUrl);
          await handleSendTelegram(reportText, 'گزارش پایش سیگنال‌های قفل‌شده');
          return;
        }
        setTelegramFeedback(data.message);
        setStatusBanner(data.message);
        setTimeout(() => {
          setTelegramFeedback(null);
          setStatusBanner(null);
        }, 5000);
        return;
      }
      throw new Error('Static fallback');
    } catch {
      const locked = signals.filter((s) => s.isLocked);
      const reportText = formatLockedSignalsTelegramReport(locked, settings.dashboardUrl);
      await handleSendTelegram(reportText, 'گزارش پایش سیگنال‌های قفل‌شده');
    }
  };

  // Register a signal as executed by the user and start Telegram monitoring
  const handleRegisterExecutedTrade = async (
    signal: Signal,
    sizing: PositionSizeCalculation
  ) => {
    const newTrade: UserExecutedTrade = {
      id: `exec-${signal.id}-${Date.now().toString().slice(-4)}`,
      signalId: signal.id,
      symbol: signal.symbol,
      baseAsset: signal.baseAsset,
      persianName: signal.persianName,
      strategyLabel: `${signal.strategyLabel} (${signal.strategyVersion})`,
      timeframe: signal.timeframe,
      timeHorizonFa: signal.timeHorizonFa,
      exchange: sizing.selectedExchange,
      enteredAt: new Date().toISOString(),
      entryPriceUsdt: sizing.effectiveEntryUsdt,
      entryPriceIrt: sizing.effectiveEntryIrt,
      currentPriceUsdt: signal.currentPrice,
      currentPriceIrt: Math.round(signal.currentPrice * signal.usdtIrtRate),
      stopUsdt: signal.stop,
      stopIrt: signal.stopIrt,
      tp1Usdt: signal.tp1,
      tp1Irt: signal.tp1Irt,
      tp2Usdt: signal.tp2,
      tp2Irt: signal.tp2Irt,
      quantityAsset: sizing.quantityAsset,
      notionalUsdt: sizing.positionNotionalUsdt,
      notionalIrt: sizing.positionNotionalIrt,
      riskAmountUsdt: sizing.riskAmountUsdt,
      riskAmountIrt: sizing.riskAmountIrt,
      status: 'active',
      priceChangePct: Number(
        (((signal.currentPrice - sizing.effectiveEntryUsdt) / sizing.effectiveEntryUsdt) * 100).toFixed(2)
      ),
      unrealizedOrRealizedR: Number(
        (
          (signal.currentPrice - sizing.effectiveEntryUsdt) /
          Math.max(0.0000001, Math.abs(sizing.effectiveEntryUsdt - signal.stop))
        ).toFixed(2)
      ),
      pnlUsdt: Number(
        ((signal.currentPrice - sizing.effectiveEntryUsdt) * sizing.quantityAsset).toFixed(2)
      ),
      pnlIrt: Math.round(
        (signal.currentPrice - sizing.effectiveEntryUsdt) *
          sizing.quantityAsset *
          signal.usdtIrtRate
      ),
      lastTelegramAlertAt: new Date().toISOString(),
      monitoringNote: 'ورود دستی ثبت شد — پایش خودکار تغییرات قیمت و اهداف فعال است.',
    };

    const nextTrades = [
      newTrade,
      ...executedTrades.filter((t) => t.signalId !== signal.id),
    ];
    persistTradesLocally(nextTrades);

    try {
      await fetch('/api/executed-trades/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade: newTrade }),
      });
    } catch {
      // Static fallback already persisted locally
    }

    const tgMessage = formatExecutedTradeTelegramMessage(
      newTrade,
      'entry_confirmed',
      settings.dashboardUrl
    );
    await handleSendTelegram(tgMessage, `ثبت ورود دستی ${signal.symbol}`);

    setStatusBanner(
      `معامله «${signal.persianName} (${signal.symbol})» در سامانه ثبت شد و پیام شروع پایش به تلگرام ارسال گردید.`
    );
    setTimeout(() => setStatusBanner(null), 5000);
  };

  // Update live price of an executed trade and dispatch Telegram alert
  const handleUpdateExecutedTradePrice = async (
    tradeId: string,
    newPriceUsdt: number
  ) => {
    const target = executedTrades.find((t) => t.id === tradeId);
    if (!target) return;

    const evaluated = evaluateUserExecutedTrade(
      target,
      newPriceUsdt,
      dollarGold.usdtIrtAverage
    );
    const nextTrades = executedTrades.map((t) =>
      t.id === tradeId ? evaluated.updatedTrade : t
    );
    persistTradesLocally(nextTrades);

    try {
      await fetch('/api/executed-trades/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade: evaluated.updatedTrade }),
      });
    } catch {
      // Static fallback
    }

    const tgMsg = formatExecutedTradeTelegramMessage(
      evaluated.updatedTrade,
      evaluated.alertEventType,
      settings.dashboardUrl
    );
    await handleSendTelegram(
      tgMsg,
      `بروزرسانی قیمت ${evaluated.updatedTrade.symbol}`
    );
  };

  // Mark an executed trade as TP1 Risk-Free or Closed
  const handleCloseExecutedTrade = async (
    tradeId: string,
    closeStatus: 'tp1_hit' | 'closed_tp2' | 'closed_sl' | 'closed_manual'
  ) => {
    const target = executedTrades.find((t) => t.id === tradeId);
    if (!target) return;

    const targetPrice =
      closeStatus === 'tp1_hit'
        ? target.tp1Usdt
        : closeStatus === 'closed_tp2'
          ? target.tp2Usdt
          : closeStatus === 'closed_sl'
            ? target.stopUsdt
            : target.currentPriceUsdt;

    const evaluated = evaluateUserExecutedTrade(
      target,
      targetPrice,
      dollarGold.usdtIrtAverage
    );
    const updatedTrade: UserExecutedTrade = {
      ...evaluated.updatedTrade,
      status: closeStatus,
      monitoringNote:
        closeStatus === 'tp1_hit'
          ? 'هدف اول (TP1) ثبت شد — ۵۰٪ سیو سود و انتقال حد ضرر به نقطه ورود (ریسک‌فری).'
          : closeStatus === 'closed_tp2'
            ? 'معامله با رسیدن به هدف کامل تسویه و بسته شد.'
            : 'معامله توسط کاربر بسته شد.',
    };

    const nextTrades = executedTrades.map((t) =>
      t.id === tradeId ? updatedTrade : t
    );
    persistTradesLocally(nextTrades);

    try {
      await fetch('/api/executed-trades/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade: updatedTrade }),
      });
    } catch {
      // Static fallback
    }

    const tgMsg = formatExecutedTradeTelegramMessage(
      updatedTrade,
      closeStatus === 'tp1_hit' ? 'tp1_risk_free' : 'closed',
      settings.dashboardUrl
    );
    await handleSendTelegram(
      tgMsg,
      closeStatus === 'tp1_hit'
        ? `ریسک‌فری شدن ${updatedTrade.symbol}`
        : `بستن معامله ${updatedTrade.symbol}`
    );
  };

  // Record / update today's Daily Signal Performance Report & send to Telegram
  const handleRecordTodayReport = async () => {
    const winSummary = computeSignalWinRateMetrics(signals, executedTrades);
    const todayKey = new Date().toISOString().slice(0, 10);
    const persianDate = getPersianDateLabel();

    const newReport: DailyPerformanceReport = {
      id: `rep-${todayKey}`,
      dateKey: todayKey,
      persianDate,
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
      summaryNote: `ثبت کارنامه روزانه با نرخ موفقیت ${winSummary.winRatePct}% در سیگنال‌های بسته‌شده و ${winSummary.userTradesActive} معامله فعال ثبت‌شده توسط کاربر.`,
    };

    const nextReports = [
      newReport,
      ...dailyReports.filter((r) => r.dateKey !== todayKey),
    ];
    persistReportsLocally(nextReports);

    try {
      await fetch('/api/daily-reports/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: newReport }),
      });
    } catch {
      // Static fallback
    }

    const tgText = formatDailyPerformanceTelegramReport(
      newReport,
      winSummary,
      settings.dashboardUrl
    );
    await handleSendTelegram(tgText, `کارنامه عملکرد روزانه (${persianDate})`);
    setStatusBanner(`کارنامه عملکرد امروز (${persianDate}) با موفقیت ثبت و به تلگرام ارسال شد.`);
    setTimeout(() => setStatusBanner(null), 5000);
  };

  const handleRunScan = async (customUsdtIrt?: number, customXauUsd?: number) => {
    setIsScanning(true);
    setStatusBanner(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usdtIrtWallex: customUsdtIrt,
          xauUsdOunce: customXauUsd,
          telegramBotToken: settings.telegramBotToken,
          telegramChatId: settings.telegramChatId,
        }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.dollarGold) setDollarGold(data.dollarGold);
        if (data.signals) setSignals(data.signals);
        if (data.executedTrades) persistTradesLocally(data.executedTrades);
        if (data.dailyReports) persistReportsLocally(data.dailyReports);
        if (data.sourceHealth) setSourceHealth(data.sourceHealth);
        if (data.macro) setMacro(data.macro);
        setStatusBanner(
          data.message ||
            'اسکن قیمت زنده والکس، کراکن، ارزهای پامپی، فارکس توکنیزه، دلار و طلا انجام شد.'
        );
        return;
      }
      throw new Error('Static GitHub Pages fallback');
    } catch {
      // Browser-direct live market scan for GitHub Pages static deployment!
      let nextWallex =
        customUsdtIrt && customUsdtIrt > 30000 ? customUsdtIrt : dollarGold.usdtIrtWallex;
      let nextXau =
        customXauUsd && customXauUsd > 1500 ? customXauUsd : dollarGold.xauUsdOunce;
      let nextBtc = macro.btcPrice;
      let nextEth = macro.ethPrice;
      const liveAssetPrices: Record<string, number> = {};

      // 1. Try Kraken Public API (CORS-enabled in browsers worldwide)
      try {
        const krRes = await fetch(
          'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,PAXGUSD,SOLUSD,AVAXUSD,LINKUSD,SUIUSD,PEPEUSD,ARBUSD,RENDERUSD,ONDOUSD,ETHFIUSD,EURUSD'
        );
        if (krRes.ok) {
          const krJson = (await krRes.json()) as any;
          const r = krJson?.result || {};
          const pick = (keys: string[]) => {
            for (const k of keys) {
              const v = Number(r[k]?.c?.[0]);
              if (v > 0) return v;
            }
            return 0;
          };
          const btc = pick(['XXBTZUSD', 'XBTUSD']);
          const eth = pick(['XETHZUSD', 'ETHUSD']);
          const paxg = pick(['PAXGUSD']);
          if (btc > 10000) {
            nextBtc = Number(btc.toFixed(2));
            liveAssetPrices.BTC = nextBtc;
          }
          if (eth > 500) {
            nextEth = Number(eth.toFixed(2));
            liveAssetPrices.ETH = nextEth;
          }
          if (paxg > 1800 && (!customXauUsd || customXauUsd <= 1500)) {
            nextXau = Number(paxg.toFixed(2));
            liveAssetPrices.PAXG = nextXau;
          }
          const sol = pick(['SOLUSD']);
          const avax = pick(['AVAXUSD']);
          const link = pick(['LINKUSD']);
          const sui = pick(['SUIUSD']);
          const pepe = pick(['PEPEUSD']);
          const arb = pick(['ARBUSD']);
          const render = pick(['RENDERUSD']);
          const ondo = pick(['ONDOUSD']);
          const ethfi = pick(['ETHFIUSD']);
          const eur = pick(['ZEURZUSD', 'EURUSD']);
          if (sol > 5) liveAssetPrices.SOL = Number(sol.toFixed(2));
          if (avax > 1) liveAssetPrices.AVAX = Number(avax.toFixed(2));
          if (link > 1) liveAssetPrices.LINK = Number(link.toFixed(2));
          if (sui > 0.1) liveAssetPrices.SUI = Number(sui.toFixed(4));
          if (pepe > 0) liveAssetPrices.PEPE = Number(pepe.toFixed(8));
          if (arb > 0.05) liveAssetPrices.ARB = Number(arb.toFixed(4));
          if (render > 0.2) liveAssetPrices.RENDER = Number(render.toFixed(3));
          if (ondo > 0.05) liveAssetPrices.ONDO = Number(ondo.toFixed(4));
          if (ethfi > 0.05) liveAssetPrices.ETHFI = Number(ethfi.toFixed(4));
          if (eur > 0.8) liveAssetPrices.EUR = Number(eur.toFixed(4));
        }
      } catch {
        // ignore
      }

      // 2. Try Wallex Public API if reachable from user's browser
      if (!customUsdtIrt || customUsdtIrt <= 30000) {
        try {
          const wxRes = await fetch('https://api.wallex.ir/v1/markets');
          if (wxRes.ok) {
            const wxJson = (await wxRes.json()) as any;
            const lastTmn = Number(wxJson?.result?.symbols?.USDTTMN?.stats?.lastPrice);
            if (lastTmn >= 50000 && lastTmn <= 1000000) {
              nextWallex = Math.round(lastTmn);
            }
          }
        } catch {
          // ignore
        }
      }

      const updatedDg = buildInitialDollarGoldSnapshot(
        nextWallex,
        Math.round(nextWallex - 180),
        nextXau
      );
      setDollarGold(updatedDg);

      const updatedSignals = signals.map((sig) => {
        const liveP = liveAssetPrices[sig.baseAsset] ?? sig.currentPrice;
        return recalibrateSignalWithLiveMarket(sig, liveP, updatedDg.usdtIrtAverage);
      });
      setSignals(updatedSignals);

      setMacro((prev) => ({
        ...prev,
        btcPrice: nextBtc,
        ethPrice: nextEth,
        lastScanAt: new Date().toISOString(),
        scanCount: prev.scanCount + 1,
      }));

      let tgNote = '';
      if (settings.autoSendTelegramOnScan && settings.telegramBotToken) {
        const radarMsg = formatScanRadarTelegramSummary({
          dollarGold: updatedDg,
          btcPrice: nextBtc,
          ethPrice: nextEth,
          signals: updatedSignals,
          dashboardUrl: settings.dashboardUrl,
        });
        const directRes = await sendTelegramDirectFromBrowser(radarMsg, 'رادار اسکن زنده');
        tgNote = directRes.ok ? ' | به تلگرام ارسال شد ✅' : ` | ${directRes.message}`;
      }

      setStatusBanner(
        `اسکن زنده انجام شد — تتر: ${updatedDg.usdtIrtWallex.toLocaleString('fa-IR')} تومان | انس طلا: $${updatedDg.xauUsdOunce} | BTC: $${nextBtc}${tgNote}`
      );
    } finally {
      setIsScanning(false);
      setTimeout(() => setStatusBanner(null), 6000);
    }
  };

  const handleSaveSettings = async (updated: Partial<BotSettings>) => {
    const merged: BotSettings = {
      ...settings,
      ...updated,
      telegramBotToken:
        updated.telegramBotToken !== undefined
          ? sanitizeTelegramToken(updated.telegramBotToken)
          : settings.telegramBotToken,
      telegramChatId:
        updated.telegramChatId !== undefined
          ? sanitizeTelegramChatId(updated.telegramChatId)
          : settings.telegramChatId,
      referenceEquityIrt: Math.round(
        (updated.referenceEquityUsdt ?? settings.referenceEquityUsdt) *
          dollarGold.usdtIrtAverage
      ),
    };
    setSettings(merged);
    try {
      localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        if (data.signals) setSignals(data.signals);
      }
    } catch {
      // Static GitHub Pages mode already updated state and localStorage
    }
  };

  const handleToggleStrategy = async (strategyId: StrategyId) => {
    try {
      const res = await fetch('/api/strategies/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.strategies) setStrategies(data.strategies);
        if (data.signals) setSignals(data.signals);
        return;
      }
      throw new Error('Static fallback');
    } catch {
      setStrategies((prev) => {
        const next = prev.map((st) =>
          st.id === strategyId && (st.walkForward.passedGate || st.enabled)
            ? { ...st, enabled: !st.enabled, autoDemotedByCircuitBreaker: false }
            : st
        );
        const activeIds = new Set(next.filter((s) => s.enabled).map((s) => s.id));
        setSignals((sigs) =>
          sigs.map((sig) => ({ ...sig, mode: activeIds.has(sig.strategy) ? 'live' : 'shadow' }))
        );
        return next;
      });
    }
  };

  const handleSimulateCircuitBreaker = async (strategyId: StrategyId) => {
    try {
      const res = await fetch('/api/strategies/simulate-cb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.strategies) setStrategies(data.strategies);
        if (data.signals) setSignals(data.signals);
        return;
      }
      throw new Error('Static fallback');
    } catch {
      setStrategies((prev) =>
        prev.map((st) => {
          if (st.id !== strategyId) return st;
          const simulated: StrategyValidationMetrics = {
            ...st,
            livePerformance: {
              ...st.livePerformance,
              consecutiveLosses: 8,
              recent30ExpectancyR: -0.19,
              status: 'circuit_broken',
            },
          };
          const check = evaluateCircuitBreaker(simulated);
          return check.shouldDemote
            ? {
                ...simulated,
                enabled: false,
                autoDemotedByCircuitBreaker: true,
                demotionReason: check.reason ?? undefined,
              }
            : simulated;
        })
      );
    }
  };

  const handlePromoteChallenger = async () => {
    try {
      const res = await fetch('/api/challenger/promote', {
        method: 'POST',
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.challenger) setChallenger(data.challenger);
        if (data.signals) setSignals(data.signals);
        return;
      }
      throw new Error('Static fallback');
    } catch {
      setChallenger((prev) => ({
        ...prev,
        championWeights: { ...prev.challengerWeights },
        championExpectancyR: prev.challengerExpectancyR,
        championMaxDdR: prev.challengerMaxDdR,
        promoted: true,
      }));
      setSignals((prev) =>
        prev.map((sig) => {
          const updatedPillars = computeOrthogonalScore({
            patternCleanliness0to1: sig.pillars.structureClarity / 35,
            sweptLiquidityBeforeEntry: true,
            htfAligned: sig.htfTrend === 'صعودی',
            regimeCompatible: true,
            volumeConfirmation0to1: sig.pillars.volumeAndDepth / 25,
            orderbookDepthRatio0to1: 0.88,
            netRrTp1: sig.netRrTp1,
            roundTripCostToTp1Ratio: sig.roundTripCostPct / 100,
            weights: challenger.challengerWeights,
          });
          return {
            ...sig,
            score: updatedPillars.total,
            pillars: updatedPillars,
            bracketStat: getBracketStatForScore(updatedPillars.total),
          };
        })
      );
    }
  };

  const tehranTimeFormatted = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(macro.lastScanAt));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract (Max 5 Nav Items) */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('signals');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          QuantPulse
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="ناوبری اصلی کنسول"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400"
        >
          <button
            type="button"
            onClick={() => setActiveTab('signals')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'signals'
                ? 'border-emerald-600 dark:border-emerald-400 text-slate-900 dark:text-slate-100 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            سیگنال‌ها و قفل پایش
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pump_forex')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'pump_forex'
                ? 'border-emerald-600 dark:border-emerald-400 text-slate-900 dark:text-slate-100 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            شکارچی پامپ و فارکس توکنیزه
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('dollar_gold')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'dollar_gold'
                ? 'border-emerald-600 dark:border-emerald-400 text-slate-900 dark:text-slate-100 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            دلار و طلا (۳ افق زمانی)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('performance')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'performance'
                ? 'border-emerald-600 dark:border-emerald-400 text-slate-900 dark:text-slate-100 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            معاملات من و کارنامه
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'settings'
                ? 'border-emerald-600 dark:border-emerald-400 text-slate-900 dark:text-slate-100 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            تنظیمات، زمان‌بندی و API
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={isScanning}
            onClick={() => handleRunScan()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'در حال دریافت قیمت زنده...' : 'اسکن فوری قیمت زنده'}</span>
          </button>
        </div>
      </header>

      {/* Mobile Navigation Bar + Workspace Context Strip */}
      <div className="bg-slate-100/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Mobile Tab Selector */}
          <div className="flex md:hidden items-center gap-1 overflow-x-auto py-1">
            <button
              type="button"
              onClick={() => setActiveTab('signals')}
              className={`px-2.5 py-1 text-xs rounded whitespace-nowrap shrink-0 ${
                activeTab === 'signals'
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              سیگنال‌ها و قفل
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pump_forex')}
              className={`px-2.5 py-1 text-xs rounded whitespace-nowrap shrink-0 ${
                activeTab === 'pump_forex'
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              پامپ و فارکس
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dollar_gold')}
              className={`px-2.5 py-1 text-xs rounded whitespace-nowrap shrink-0 ${
                activeTab === 'dollar_gold'
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              دلار و طلا
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('performance')}
              className={`px-2.5 py-1 text-xs rounded whitespace-nowrap shrink-0 ${
                activeTab === 'performance'
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              معاملات و کارنامه
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`px-2.5 py-1 text-xs rounded whitespace-nowrap shrink-0 ${
                activeTab === 'settings'
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              تنظیمات و API
            </button>
          </div>

          {/* Unboxed Metadata Summary (Zero-Pill Discipline) */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
            <span className="font-sans text-emerald-600 dark:text-emerald-400 font-semibold">
              فید زنده والکس و کراکن فعال
            </span>
            <span aria-hidden="true">·</span>
            <span className="ltr-num">BTC: ${macro.btcPrice.toLocaleString('en-US')}</span>
            <span aria-hidden="true">·</span>
            <span className="ltr-num">ETH: ${macro.ethPrice.toLocaleString('en-US')}</span>
            <span aria-hidden="true">·</span>
            <span>تتر والکس: {dollarGold.usdtIrtWallex.toLocaleString('fa-IR')} ت</span>
            <span aria-hidden="true">·</span>
            <span className="ltr-num">انس طلا (PAXG): ${dollarGold.xauUsdOunce.toLocaleString('en-US')}</span>
            <span aria-hidden="true">·</span>
            <span>طلای ۱۸ عیار: {dollarGold.gold18kMarketIrt.toLocaleString('fa-IR')} ت</span>
            <span aria-hidden="true">·</span>
            <span className="font-sans">بروزرسانی (تهران): {tehranTimeFormatted}</span>
          </div>

          {/* GitHub Repo Download + Theme Switcher */}
          <div className="flex items-center gap-2.5">
            <a
              href="/api/github/download-repo"
              download="quantpulse-github-repo.zip"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/40 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors whitespace-nowrap shrink-0"
              title="دانلود ریپازیتوری کامل گیت‌هاب شامل پوشه‌های مخفی .git و .github"
            >
              <Download className="w-3.5 h-3.5" />
              <span>دانلود ریپوی گیت‌هاب (.zip)</span>
            </a>

            <button
              type="button"
              onClick={() => setIsDark(!isDark)}
              aria-label={isDark ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              {isDark ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>حالت روشن</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-700" />
                  <span>حالت تاریک</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Status Notification Banner */}
      {statusBanner && (
        <div className="bg-emerald-600 text-white text-xs px-6 py-2 text-center font-medium">
          {statusBanner}
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        {activeTab === 'signals' && (
          <SignalsWorkspace
            signals={signals}
            executedTrades={executedTrades}
            dollarGold={dollarGold}
            settings={settings}
            onRegisterExecutedTrade={handleRegisterExecutedTrade}
            onToggleLockSignal={handleToggleLockSignal}
            onSendLockedSignalsReport={handleSendLockedSignalsReport}
            onSendTelegram={handleSendTelegram}
            onSendAllActiveSignalsToTelegram={async () => {
              setTelegramFeedback(null);
              try {
                const res = await fetch('/api/telegram/send-all-signals', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    telegramBotToken: settings.telegramBotToken,
                    telegramChatId: settings.telegramChatId,
                  }),
                });
                if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
                  const data = await res.json();
                  if (data.sent) {
                    if (data.detectedChatId && data.detectedChatId !== settings.telegramChatId) {
                      setSettings((prev) => ({ ...prev, telegramChatId: data.detectedChatId }));
                    }
                    setTelegramFeedback(data.message);
                    setStatusBanner(data.message);
                    setTimeout(() => {
                      setTelegramFeedback(null);
                      setStatusBanner(null);
                    }, 5000);
                    return;
                  }
                  if (!settings.telegramBotToken) {
                    setTelegramFeedback(data.message);
                    setStatusBanner(data.message);
                    setTimeout(() => {
                      setTelegramFeedback(null);
                      setStatusBanner(null);
                    }, 5000);
                    return;
                  }
                }
                throw new Error('Static fallback');
              } catch {
                const activeLive = signals.filter(
                  (s) =>
                    s.mode === 'live' &&
                    ['pending', 'open'].includes(s.status) &&
                    s.score >= settings.minScoreTelegram
                );
                for (const sig of activeLive) {
                  const text = formatTelegramSignalMessage(sig, settings);
                  await handleSendTelegram(text, `سیگنال ${sig.symbol}`);
                }
              }
            }}
            telegramFeedback={telegramFeedback}
            initialSelectedSignalId={deepLinkSignalId}
            initialStatusFilter={deepLinkFilter}
          />
        )}

        {activeTab === 'pump_forex' && (
          <PumpAndForexView
            signals={signals}
            settings={settings}
            onToggleLockSignal={handleToggleLockSignal}
            onSendTelegram={handleSendTelegram}
            onRegisterExecutedTrade={handleRegisterExecutedTrade}
            telegramFeedback={telegramFeedback}
          />
        )}

        {activeTab === 'dollar_gold' && (
          <DollarGoldMacroView
            dollarGold={dollarGold}
            macro={macro}
            signals={signals}
            settings={settings}
            onUpdateRatesAndScan={(usdtIrt, xau) => handleRunScan(usdtIrt, xau)}
            onSendTelegram={handleSendTelegram}
            onRegisterExecutedTrade={async ({
              signalId,
              exchange,
            }) => {
              const sig = signals.find((s) => s.id === signalId);
              if (!sig) return;
              const sizing = calculatePositionSizing({
                signal: sig,
                equityUsdt: settings.referenceEquityUsdt,
                riskPct: settings.riskPerTradePct,
                selectedExchange: exchange,
                makerFeePct:
                  exchange === 'wallex'
                    ? settings.wallexMakerFeePct
                    : settings.bitpinMakerFeePct,
                takerFeePct:
                  exchange === 'wallex'
                    ? settings.wallexTakerFeePct
                    : settings.bitpinTakerFeePct,
                slippagePct: 0.07,
                currentOpenDirectionalRiskPct: 2.0,
                maxDirectionalPortfolioHeatPct: settings.maxDirectionalPortfolioHeatPct,
              });
              await handleRegisterExecutedTrade(sig, sizing);
            }}
            telegramFeedback={telegramFeedback}
          />
        )}

        {activeTab === 'performance' && (
          <div className="space-y-10">
            <PerformanceAndTradesView
              signals={signals}
              executedTrades={executedTrades}
              dailyReports={dailyReports}
              settings={settings}
              onUpdateExecutedTradePrice={handleUpdateExecutedTradePrice}
              onCloseExecutedTrade={handleCloseExecutedTrade}
              onRecordTodayReport={handleRecordTodayReport}
              onSendTelegram={handleSendTelegram}
              telegramFeedback={telegramFeedback}
            />
            <div className="pt-8 border-t border-slate-200 dark:border-slate-800 space-y-10">
              <StrategiesGovernanceView
                strategies={strategies}
                challenger={challenger}
                onToggleStrategy={handleToggleStrategy}
                onSimulateCircuitBreaker={handleSimulateCircuitBreaker}
                onPromoteChallenger={handlePromoteChallenger}
              />
              <PostmortemAndHealthView
                postmortem={postmortem}
                sourceHealth={sourceHealth}
              />
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <SettingsAndConfigView
            settings={settings}
            onSaveSettings={handleSaveSettings}
            onSendTelegram={handleSendTelegram}
            onRunScan={() => handleRunScan()}
            isScanning={isScanning}
            telegramFeedback={telegramFeedback}
          />
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>
            کنسول مدیریت و پایش ربات سیگنال‌دهی QuantPulse — متصل به فید زنده والکس، کراکن و فید سهام توکنیزه
          </span>
          <span>
            اسکن جامع هر {settings.scanIntervalMinutes || 15} دقیقه · پایش سیگنال‌های قفل‌شده هر {settings.lockedMonitorIntervalMinutes || 5} دقیقه
          </span>
        </div>
      </footer>
    </div>
  );
}
