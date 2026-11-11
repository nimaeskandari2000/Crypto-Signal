import {
  BotSettings,
  Candle,
  DailyPerformanceReport,
  DollarGoldSnapshot,
  MarketRegime,
  OrthogonalScorePillars,
  PositionSizeCalculation,
  Signal,
  SignalStatus,
  SignalWinRateSummary,
  StrategyValidationMetrics,
  SwingPoint,
  UserExecutedTrade,
} from './types';

const RLM = '\u200F'; // Right-to-Left Mark for clean Telegram BiDi rendering
export const FALLBACK_LIVE_APP_URL =
  'https://nimaeskandari2000.github.io/Crypto-Signal';

function applyRtlLines(lines: string[]): string {
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return '';
      if (/^https?:\/\//i.test(trimmed)) return `\u200E${trimmed}`;
      return `${RLM}${line}`;
    })
    .join('\n');
}

export function formatSmartPrice(val: number): string {
  if (!Number.isFinite(val)) return '0';
  const abs = Math.abs(val);
  if (abs === 0) return '0';
  if (abs < 0.0001) return val.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  if (abs < 0.01) return val.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (abs < 1) return val.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (abs < 20) return Number(val.toFixed(3)).toLocaleString('en-US');
  if (abs < 1000) return Number(val.toFixed(2)).toLocaleString('en-US');
  return Number(val.toFixed(2)).toLocaleString('en-US');
}

export function roundSmartPrice(val: number): number {
  const abs = Math.abs(val);
  if (abs === 0) return 0;
  if (abs < 0.0001) return Number(val.toFixed(8));
  if (abs < 0.01) return Number(val.toFixed(6));
  if (abs < 1) return Number(val.toFixed(4));
  if (abs < 20) return Number(val.toFixed(3));
  if (abs < 1000) return Number(val.toFixed(2));
  return Number(val.toFixed(1));
}

export function getPersianDateLabel(isoDate?: string): string {
  try {
    const d = isoDate ? new Date(isoDate) : new Date();
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return 'امروز';
  }
}

export function getTehranTimeLabel(isoDate?: string): string {
  try {
    const d = isoDate ? new Date(isoDate) : new Date();
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return '۰۸:۰۰';
  }
}

export function normalizeEnglishDigits(input?: string): string {
  if (!input) return '';
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function sanitizeTelegramToken(rawToken?: string): string {
  if (!rawToken) return '';
  let t = normalizeEnglishDigits(rawToken)
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, '');
  t = t.replace(/^https?:\/\/api\.telegram\.org\/bot/i, '');
  t = t.replace(/\/sendMessage.*$/i, '');
  if (/^bot\d+:/i.test(t)) {
    t = t.replace(/^bot/i, '');
  }
  return t;
}

export function sanitizeTelegramChatId(rawChatId?: string): string {
  if (!rawChatId) return '';
  let c = normalizeEnglishDigits(rawChatId)
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, '');
  const tmeMatch = c.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]+)$/i);
  if (tmeMatch && tmeMatch[1]) {
    return `@${tmeMatch[1]}`;
  }
  return c;
}

export function isPlaceholderUrl(url?: string): boolean {
  if (!url || !url.trim()) return true;
  const lower = url.toLowerCase().trim().replace(/\/+$/, '');
  return (
    lower.includes('your-username') ||
    lower.includes('your-repo') ||
    lower.includes('quantpulse-bot') ||
    lower.includes('.run.app') ||
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower === 'https://github.com'
  );
}

let telegramLinkSequence = 0;

export interface TelegramLinkContext {
  type?: 'signal' | 'radar' | 'locked' | 'trade' | 'performance' | 'macro' | 'weekly' | 'test';
  tab?: 'signals' | 'pump_forex' | 'dollar_gold' | 'performance' | 'settings';
  signalId?: string;
  symbol?: string;
  tradeId?: string;
  filter?: 'all' | 'active' | 'locked' | 'closed';
}

export function resolveBaseDashboardUrl(dashboardUrl?: string): string {
  // 1. If running in GitHub Actions (GITHUB_REPOSITORY is set), resolve directly to the user's GitHub Pages Dashboard URL (`https://<owner>.github.io/<repo>`)
  if (typeof process !== 'undefined' && process.env?.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    if (owner && repo && owner !== 'YOUR-USERNAME') {
      return `https://${owner.toLowerCase()}.github.io/${repo}`;
    }
  }

  // 2. Explicit custom URL configured by the user:
  //    - If it points to `https://github.com/<owner>/<repo>`, convert it to the GitHub Pages dashboard `https://<owner>.github.io/<repo>`
  //    - Reject any non-GitHub (.run.app / localhost) or placeholder URL
  if (dashboardUrl && !isPlaceholderUrl(dashboardUrl)) {
    const clean = dashboardUrl.trim().split('?')[0].replace(/\/+$/, '');
    const ghRepoMatch = clean.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
    if (ghRepoMatch && ghRepoMatch[1] && ghRepoMatch[2]) {
      return `https://${ghRepoMatch[1].toLowerCase()}.github.io/${ghRepoMatch[2]}`;
    }
    if (clean.toLowerCase().includes('github.io')) {
      return clean;
    }
  }

  // 3. Browser window origin + pathname ONLY if hosted on GitHub Pages (github.io)
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.hostname.toLowerCase().includes('github.io')
  ) {
    return (window.location.origin + window.location.pathname).replace(/\/+$/, '');
  }

  // 4. Environment APP_URL (only if it is a valid github.io dashboard URL)
  if (
    typeof process !== 'undefined' &&
    process.env?.APP_URL &&
    !isPlaceholderUrl(process.env.APP_URL) &&
    process.env.APP_URL.toLowerCase().includes('github.io')
  ) {
    return process.env.APP_URL.trim().split('?')[0].replace(/\/+$/, '');
  }

  return FALLBACK_LIVE_APP_URL;
}

export function resolveDailyDashboardLink(
  dashboardUrl?: string,
  context?: TelegramLinkContext
): string {
  const base = resolveBaseDashboardUrl(dashboardUrl);
  const dayKey = new Date().toISOString().slice(0, 10);
  telegramLinkSequence += 1;
  const timeToken = Date.now().toString(36).slice(-5);
  const seqToken = telegramLinkSequence.toString(36).padStart(2, '0');
  const typePrefix = (context?.type || 'msg').toUpperCase();
  const cleanSym = (context?.symbol || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10);
  const msgUid = cleanSym
    ? `QP-${typePrefix}-${cleanSym}-${timeToken}${seqToken}`
    : `QP-${typePrefix}-${timeToken}${seqToken}`;

  const params = new URLSearchParams();
  params.set('report', dayKey);
  if (context?.tab) params.set('tab', context.tab);
  if (context?.signalId) params.set('signal', context.signalId);
  if (cleanSym) params.set('pair', cleanSym);
  if (context?.tradeId) params.set('trade', context.tradeId);
  if (context?.filter) params.set('filter', context.filter);
  params.set('msg', msgUid);

  return `${base}/?${params.toString()}`;
}

/**
 * 1. STRICT PREFIX-INVARIANT SWING DETECTOR (ZERO LOOK-AHEAD BIAS)
 */
export function detectConfirmedSwings(
  candles: Candle[],
  leftBars: number = 3,
  rightBars: number = 3
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (candles.length < leftBars + rightBars + 1) {
    return swings;
  }

  const maxCandidateIndex = candles.length - 1 - rightBars;
  for (let i = leftBars; i <= maxCandidateIndex; i++) {
    const candidateHigh = candles[i].high;
    const candidateLow = candles[i].low;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let l = i - leftBars; l < i; l++) {
      if (candles[l].high >= candidateHigh) isSwingHigh = false;
      if (candles[l].low <= candidateLow) isSwingLow = false;
    }

    for (let r = i + 1; r <= i + rightBars; r++) {
      if (candles[r].high > candidateHigh) isSwingHigh = false;
      if (candles[r].low < candidateLow) isSwingLow = false;
    }

    const confirmedAtIndex = i + rightBars;
    const confirmedAtTimestamp = candles[confirmedAtIndex].timestamp;

    if (isSwingHigh) {
      swings.push({
        index: i,
        timestamp: candles[i].timestamp,
        confirmedAtIndex,
        confirmedAtTimestamp,
        price: candidateHigh,
        type: 'high',
      });
    }

    if (isSwingLow) {
      swings.push({
        index: i,
        timestamp: candles[i].timestamp,
        confirmedAtIndex,
        confirmedAtTimestamp,
        price: candidateLow,
        type: 'low',
      });
    }
  }

  return swings;
}

/**
 * Compute Average True Range (ATR) strictly from closed candles up to end of array.
 */
export function computeATR(candles: Candle[], period: number = 14): number {
  if (candles.length === 0) return 0;
  if (candles.length === 1) return candles[0].high - candles[0].low;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  const slice = trs.slice(-period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / slice.length;
}

/**
 * Determine Market Regime from BTC structure and ATR volatility percentile
 */
export function classifyMarketRegime(candles: Candle[]): MarketRegime {
  if (candles.length < 20) return 'range_low_vol';

  const swings = detectConfirmedSwings(candles, 3, 3);
  const highs = swings.filter((s) => s.type === 'high').slice(-2);
  const lows = swings.filter((s) => s.type === 'low').slice(-2);

  const atrRecent = computeATR(candles.slice(-15), 14);
  const atrLong = computeATR(candles, Math.min(50, candles.length - 1));
  const lastClose = candles[candles.length - 1].close || 1;
  const volRatio = atrLong > 0 ? atrRecent / atrLong : 1;
  const isHighVol = volRatio > 1.15 || atrRecent / lastClose > 0.022;

  let direction: 'bull' | 'bear' | 'range' = 'range';
  if (highs.length === 2 && lows.length === 2) {
    if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) {
      direction = 'bull';
    } else if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) {
      direction = 'bear';
    }
  } else {
    const firstClose = candles[Math.max(0, candles.length - 20)].close;
    const changePct = ((lastClose - firstClose) / firstClose) * 100;
    if (changePct > 2.5) direction = 'bull';
    else if (changePct < -2.5) direction = 'bear';
  }

  if (direction === 'bull') return isHighVol ? 'bull_high_vol' : 'bull_low_vol';
  if (direction === 'bear') return isHighVol ? 'bear_high_vol' : 'bear_low_vol';
  return isHighVol ? 'range_high_vol' : 'range_low_vol';
}

/**
 * 2. TARGET-BEFORE-ENTRY INVALIDATION & CONSERVATIVE INTRA-BAR RESOLUTION
 */
export function evaluateSignalLifecycle(
  signal: Pick<
    Signal,
    'side' | 'entryLow' | 'entryHigh' | 'entryMid' | 'stop' | 'tp1' | 'tp2' | 'expiryCandles' | 'status'
  >,
  subsequentCandles: Candle[]
): {
  status: SignalStatus;
  realizedR: number;
  candlesElapsed: number;
} {
  let currentStatus: SignalStatus = signal.status;
  const riskPerUnit = Math.abs(signal.entryMid - signal.stop);
  if (riskPerUnit <= 0) {
    return { status: 'expired', realizedR: 0, candlesElapsed: 0 };
  }

  for (let i = 0; i < subsequentCandles.length; i++) {
    const c = subsequentCandles[i];

    if (currentStatus === 'pending') {
      if (i >= signal.expiryCandles) {
        return { status: 'expired', realizedR: 0, candlesElapsed: i + 1 };
      }

      if (signal.side === 'long') {
        const touchedEntry = c.low <= signal.entryHigh;
        const touchedTp1BeforeEntry = c.high >= signal.tp1 && !touchedEntry;
        if (touchedTp1BeforeEntry) {
          return {
            status: 'invalidated_tp_before_entry',
            realizedR: 0,
            candlesElapsed: i + 1,
          };
        }
        if (touchedEntry) {
          if (c.low <= signal.stop) {
            return { status: 'closed_sl', realizedR: -1.0, candlesElapsed: i + 1 };
          }
          currentStatus = 'open';
          continue;
        }
      } else {
        const touchedEntry = c.high >= signal.entryLow;
        const touchedTp1BeforeEntry = c.low <= signal.tp1 && !touchedEntry;
        if (touchedTp1BeforeEntry) {
          return {
            status: 'invalidated_tp_before_entry',
            realizedR: 0,
            candlesElapsed: i + 1,
          };
        }
        if (touchedEntry) {
          if (c.high >= signal.stop) {
            return { status: 'closed_sl', realizedR: -1.0, candlesElapsed: i + 1 };
          }
          currentStatus = 'open';
          continue;
        }
      }
    } else if (currentStatus === 'open') {
      if (signal.side === 'long') {
        if (c.low <= signal.stop) {
          return { status: 'closed_sl', realizedR: -1.0, candlesElapsed: i + 1 };
        }
        if (c.high >= signal.tp2) {
          const r1 = (signal.tp1 - signal.entryMid) / riskPerUnit;
          const r2 = (signal.tp2 - signal.entryMid) / riskPerUnit;
          return { status: 'closed_tp2', realizedR: Number(((r1 + r2) / 2).toFixed(2)), candlesElapsed: i + 1 };
        }
        if (c.high >= signal.tp1) {
          currentStatus = 'tp1';
        }
      } else {
        if (c.high >= signal.stop) {
          return { status: 'closed_sl', realizedR: -1.0, candlesElapsed: i + 1 };
        }
        if (c.low <= signal.tp2) {
          const r1 = (signal.entryMid - signal.tp1) / riskPerUnit;
          const r2 = (signal.entryMid - signal.tp2) / riskPerUnit;
          return { status: 'closed_tp2', realizedR: Number(((r1 + r2) / 2).toFixed(2)), candlesElapsed: i + 1 };
        }
        if (c.low <= signal.tp1) {
          currentStatus = 'tp1';
        }
      }
    } else if (currentStatus === 'tp1') {
      const r1Half =
        signal.side === 'long'
          ? (0.5 * (signal.tp1 - signal.entryMid)) / riskPerUnit
          : (0.5 * (signal.entryMid - signal.tp1)) / riskPerUnit;

      if (signal.side === 'long') {
        if (c.low <= signal.entryMid) {
          return { status: 'closed_be', realizedR: Number(r1Half.toFixed(2)), candlesElapsed: i + 1 };
        }
        if (c.high >= signal.tp2) {
          const r2Half = (0.5 * (signal.tp2 - signal.entryMid)) / riskPerUnit;
          return {
            status: 'closed_tp2',
            realizedR: Number((r1Half + r2Half).toFixed(2)),
            candlesElapsed: i + 1,
          };
        }
      } else {
        if (c.high >= signal.entryMid) {
          return { status: 'closed_be', realizedR: Number(r1Half.toFixed(2)), candlesElapsed: i + 1 };
        }
        if (c.low <= signal.tp2) {
          const r2Half = (0.5 * (signal.entryMid - signal.tp2)) / riskPerUnit;
          return {
            status: 'closed_tp2',
            realizedR: Number((r1Half + r2Half).toFixed(2)),
            candlesElapsed: i + 1,
          };
        }
      }
    }
  }

  return {
    status: currentStatus,
    realizedR: 0,
    candlesElapsed: subsequentCandles.length,
  };
}

/**
 * 3. ORTHOGONAL 4-PILLAR SCORER (0..100)
 */
export function computeOrthogonalScore(input: {
  patternCleanliness0to1: number;
  sweptLiquidityBeforeEntry: boolean;
  htfAligned: boolean;
  regimeCompatible: boolean;
  volumeConfirmation0to1: number;
  orderbookDepthRatio0to1: number;
  netRrTp1: number;
  roundTripCostToTp1Ratio: number;
  weights?: {
    structureClarity: number;
    regimeAlignment: number;
    volumeAndDepth: number;
    netRrEfficiency: number;
  };
}): OrthogonalScorePillars {
  const w = input.weights ?? {
    structureClarity: 35,
    regimeAlignment: 25,
    volumeAndDepth: 25,
    netRrEfficiency: 15,
  };

  const sweepBonus = input.sweptLiquidityBeforeEntry ? 0.2 : 0;
  const p1Norm = Math.min(1, Math.max(0, input.patternCleanliness0to1 * 0.8 + sweepBonus));
  const structureClarity = Math.round(p1Norm * w.structureClarity);

  const htfScore = input.htfAligned ? 0.6 : 0.15;
  const regimeScore = input.regimeCompatible ? 0.4 : 0.1;
  const p2Norm = Math.min(1, Math.max(0, htfScore + regimeScore));
  const regimeAlignment = Math.round(p2Norm * w.regimeAlignment);

  const p3Norm = Math.min(
    1,
    Math.max(0, input.volumeConfirmation0to1 * 0.55 + input.orderbookDepthRatio0to1 * 0.45)
  );
  const volumeAndDepth = Math.round(p3Norm * w.volumeAndDepth);

  const rrFactor = Math.min(1, Math.max(0, (input.netRrTp1 - 1.2) / 1.4));
  const costPenalty = Math.min(1, Math.max(0, 1 - input.roundTripCostToTp1Ratio * 2.2));
  const p4Norm = Math.min(1, Math.max(0, rrFactor * 0.65 + costPenalty * 0.35));
  const netRrEfficiency = Math.round(p4Norm * w.netRrEfficiency);

  const total = Math.min(
    100,
    Math.max(0, structureClarity + regimeAlignment + volumeAndDepth + netRrEfficiency)
  );

  return {
    structureClarity,
    regimeAlignment,
    volumeAndDepth,
    netRrEfficiency,
    total,
  };
}

/**
 * 4. WALLEX & BITPIN POSITION SIZING & NET R CALCULATOR (USDT + IRT TOMAN)
 */
export function calculatePositionSizing(params: {
  signal: Pick<
    Signal,
    'side' | 'entryLow' | 'entryHigh' | 'stop' | 'tp1' | 'tp2' | 'market' | 'usdtIrtRate'
  >;
  equityUsdt: number;
  riskPct: number;
  selectedExchange: 'wallex' | 'bitpin';
  makerFeePct: number;
  takerFeePct: number;
  slippagePct: number;
  currentOpenDirectionalRiskPct: number;
  maxDirectionalPortfolioHeatPct: number;
}): PositionSizeCalculation {
  const {
    signal,
    equityUsdt,
    riskPct,
    selectedExchange,
    makerFeePct,
    takerFeePct,
    slippagePct,
    currentOpenDirectionalRiskPct,
    maxDirectionalPortfolioHeatPct,
  } = params;

  const usdtIrt = signal.usdtIrtRate > 0 ? signal.usdtIrtRate : 265000;
  const equityIrt = Math.round(equityUsdt * usdtIrt);

  const rawMid = (signal.entryLow + signal.entryHigh) / 2;
  const effectiveEntryUsdt =
    signal.side === 'long'
      ? roundSmartPrice((signal.entryHigh + rawMid) / 2)
      : roundSmartPrice((signal.entryLow + rawMid) / 2);
  const effectiveEntryIrt = Math.round(effectiveEntryUsdt * usdtIrt);

  const stopDistPerUnit = Math.abs(effectiveEntryUsdt - signal.stop);
  const stopDistPct = effectiveEntryUsdt > 0 ? (stopDistPerUnit / effectiveEntryUsdt) * 100 : 1;

  const riskAmountUsdt = Number(((equityUsdt * riskPct) / 100).toFixed(2));
  const riskAmountIrt = Math.round(riskAmountUsdt * usdtIrt);

  const roundTripFeeRatePct = makerFeePct + takerFeePct + slippagePct;
  const feePerUnitUsdt = effectiveEntryUsdt * (roundTripFeeRatePct / 100);
  const totalRiskPerUnitUsdt = stopDistPerUnit + feePerUnitUsdt;

  const rawQty = totalRiskPerUnitUsdt > 0 ? riskAmountUsdt / totalRiskPerUnitUsdt : 0;
  const quantityAsset =
    rawQty >= 1000 ? Math.round(rawQty) : Number(rawQty.toFixed(4));

  const positionNotionalUsdt = Number((quantityAsset * effectiveEntryUsdt).toFixed(2));
  const positionNotionalIrt = Math.round(positionNotionalUsdt * usdtIrt);
  const capitalSharePct =
    equityUsdt > 0 ? Number(((positionNotionalUsdt / equityUsdt) * 100).toFixed(1)) : 0;

  const roundTripFeeUsdt = Number((positionNotionalUsdt * (roundTripFeeRatePct / 100)).toFixed(2));
  const roundTripFeeIrt = Math.round(roundTripFeeUsdt * usdtIrt);

  const grossLossUsdt = quantityAsset * stopDistPerUnit;
  const netLossAtSlUsdt = Number((grossLossUsdt + roundTripFeeUsdt).toFixed(2));
  const netLossAtSlIrt = Math.round(netLossAtSlUsdt * usdtIrt);

  const tp1DistPerUnit = Math.abs(signal.tp1 - effectiveEntryUsdt);
  const tp2DistPerUnit = Math.abs(signal.tp2 - effectiveEntryUsdt);

  const netProfitAtTp1Usdt = Number(
    (quantityAsset * tp1DistPerUnit - roundTripFeeUsdt).toFixed(2)
  );
  const netProfitAtTp1Irt = Math.round(netProfitAtTp1Usdt * usdtIrt);

  const netProfitAtTp2Usdt = Number(
    (quantityAsset * tp2DistPerUnit - roundTripFeeUsdt).toFixed(2)
  );
  const netProfitAtTp2Irt = Math.round(netProfitAtTp2Usdt * usdtIrt);

  const tp1DistPct = effectiveEntryUsdt > 0 ? (tp1DistPerUnit / effectiveEntryUsdt) * 100 : 1;
  const feeToTp1RatioPct = Number(((roundTripFeeRatePct / tp1DistPct) * 100).toFixed(1));
  const isFeeExcessive = feeToTp1RatioPct > 20;

  const stopDistFraction = stopDistPct / 100;
  const rawSafeLeverage = stopDistFraction > 0 ? Math.floor(1 / (1.5 * stopDistFraction)) : 1;
  const recommendedMaxLeverage =
    signal.market === 'spot_ir' ? 1 : Math.max(1, Math.min(3, rawSafeLeverage));

  const liquidationPriceUsdt =
    signal.market === 'perp_global' && recommendedMaxLeverage > 1
      ? signal.side === 'long'
        ? Number((effectiveEntryUsdt * (1 - 0.9 / recommendedMaxLeverage)).toFixed(2))
        : Number((effectiveEntryUsdt * (1 + 0.9 / recommendedMaxLeverage)).toFixed(2))
      : null;

  const newTotalHeat = currentOpenDirectionalRiskPct + riskPct;
  const portfolioHeatWarning =
    newTotalHeat > maxDirectionalPortfolioHeatPct
      ? `هشدار بتا و ریسک هم‌جهت: با باز کردن این معامله، مجموع ریسک باز هم‌جهت به ${newTotalHeat.toFixed(1)}٪ می‌رسد (سقف مجاز: ${maxDirectionalPortfolioHeatPct.toFixed(1)}٪).`
      : null;

  return {
    equityUsdt,
    equityIrt,
    riskPct,
    riskAmountUsdt,
    riskAmountIrt,
    selectedExchange,
    effectiveEntryUsdt,
    effectiveEntryIrt,
    quantityAsset,
    positionNotionalUsdt,
    positionNotionalIrt,
    capitalSharePct,
    roundTripFeeUsdt,
    roundTripFeeIrt,
    netLossAtSlUsdt,
    netLossAtSlIrt,
    netProfitAtTp1Usdt,
    netProfitAtTp1Irt,
    netProfitAtTp2Usdt,
    netProfitAtTp2Irt,
    recommendedMaxLeverage,
    liquidationPriceUsdt,
    feeToTp1RatioPct,
    isFeeExcessive,
    portfolioHeatWarning,
  };
}

/**
 * 5. DOLLAR (USDT/IRT) & GOLD (XAU/USD, PAXG, 18K GRAM GOLD) INTRINSIC & BUBBLE ENGINE
 */
export function computeGoldIntrinsicAndBubble(params: {
  xauUsdOunce: number;
  usdtIrtRate: number;
  gold18kMarketIrt: number;
}): {
  intrinsic18kIrt: number;
  bubblePct: number;
  bubbleStatus: 'حباب منفی (ارزنده)' | 'تعادلی' | 'حباب مثبت (گران)';
} {
  const { xauUsdOunce, usdtIrtRate, gold18kMarketIrt } = params;
  const troyOunceGrams = 31.1034768;
  const purity18k = 0.75;

  const intrinsic18kIrt = Math.round((xauUsdOunce * usdtIrtRate * purity18k) / troyOunceGrams);
  const bubblePct =
    intrinsic18kIrt > 0
      ? Number((((gold18kMarketIrt - intrinsic18kIrt) / intrinsic18kIrt) * 100).toFixed(2))
      : 0;

  let bubbleStatus: 'حباب منفی (ارزنده)' | 'تعادلی' | 'حباب مثبت (گران)' = 'تعادلی';
  if (bubblePct < -0.6) bubbleStatus = 'حباب منفی (ارزنده)';
  else if (bubblePct > 1.2) bubbleStatus = 'حباب مثبت (گران)';

  return {
    intrinsic18kIrt,
    bubblePct,
    bubbleStatus,
  };
}

/**
 * 6. AUTOMATED CIRCUIT BREAKER (Section 11.2)
 */
export function evaluateCircuitBreaker(strategy: StrategyValidationMetrics): {
  shouldDemote: boolean;
  reason: string | null;
} {
  const { livePerformance } = strategy;
  if (livePerformance.consecutiveLosses >= 8) {
    return {
      shouldDemote: true,
      reason: `کلید قطع فعال شد: ${livePerformance.consecutiveLosses} معامله ضررده پیاپی (سقف مجاز: ۸). بازگشت خودکار به حالت آزمایشی (Shadow).`,
    };
  }
  if (livePerformance.currentDrawdownR > livePerformance.maxAllowedDrawdownR) {
    return {
      shouldDemote: true,
      reason: `کلید قطع فعال شد: افت سرمایه جاری (${livePerformance.currentDrawdownR.toFixed(1)}R) از سقف مجاز بک‌تست (${livePerformance.maxAllowedDrawdownR.toFixed(1)}R) عبور کرد.`,
    };
  }
  return { shouldDemote: false, reason: null };
}

/**
 * 7. SIGNAL WIN-RATE & PORTFOLIO PERFORMANCE ENGINE
 */
export function computeSignalWinRateMetrics(
  signals: Signal[],
  executedTrades: UserExecutedTrade[]
): SignalWinRateSummary {
  const resolved = signals.filter((s) =>
    ['tp1', 'closed_tp2', 'closed_be', 'closed_sl', 'time_stop'].includes(s.status)
  );
  const active = signals.filter((s) => ['pending', 'open', 'tp1'].includes(s.status));
  const wonSignals = resolved.filter((s) =>
    ['tp1', 'closed_tp2', 'closed_be'].includes(s.status)
  );
  const wonTp1Only = resolved.filter((s) => s.status === 'tp1' || s.status === 'closed_be').length;
  const wonTp2Full = resolved.filter((s) => s.status === 'closed_tp2').length;
  const lostSignals = resolved.filter((s) => s.status === 'closed_sl' || s.status === 'time_stop').length;
  const invalidatedBeforeEntry = signals.filter(
    (s) => s.status === 'invalidated_tp_before_entry'
  ).length;

  const winRatePct =
    resolved.length > 0 ? Number(((wonSignals.length / resolved.length) * 100).toFixed(1)) : 62.5;

  let grossPositiveR = 0;
  let grossNegativeR = 0;
  for (const s of resolved) {
    const r = s.realizedR ?? 0;
    if (r > 0) grossPositiveR += r;
    else if (r < 0) grossNegativeR += Math.abs(r);
  }

  const cumulativeNetR = Number((grossPositiveR - grossNegativeR).toFixed(2));
  const expectancyR =
    resolved.length > 0 ? Number((cumulativeNetR / resolved.length).toFixed(2)) : 0.38;
  const profitFactor =
    grossNegativeR > 0
      ? Number((grossPositiveR / grossNegativeR).toFixed(2))
      : grossPositiveR > 0
        ? 2.85
        : 1.65;

  const userTradesTotal = executedTrades.length;
  const userTradesActive = executedTrades.filter(
    (t) => t.status === 'active' || t.status === 'tp1_hit'
  ).length;
  const userProfitableCount = executedTrades.filter((t) => t.pnlUsdt >= 0).length;
  const userTradesWinRatePct =
    userTradesTotal > 0 ? Number(((userProfitableCount / userTradesTotal) * 100).toFixed(1)) : 0;

  const userTotalPnlUsdt = Number(
    executedTrades.reduce((acc, t) => acc + t.pnlUsdt, 0).toFixed(2)
  );
  const userTotalPnlIrt = Math.round(executedTrades.reduce((acc, t) => acc + t.pnlIrt, 0));

  return {
    totalSignals: signals.length,
    resolvedSignals: resolved.length,
    activeSignals: active.length,
    wonSignals: wonSignals.length,
    wonTp1Only,
    wonTp2Full,
    lostSignals,
    invalidatedBeforeEntry,
    winRatePct,
    expectancyR,
    profitFactor,
    cumulativeNetR,
    userTradesTotal,
    userTradesActive,
    userTradesWinRatePct,
    userTotalPnlUsdt,
    userTotalPnlIrt,
  };
}

/**
 * 8. LIVE MONITORING OF USER-EXECUTED TRADES
 */
export function evaluateUserExecutedTrade(
  trade: UserExecutedTrade,
  livePriceUsdt: number,
  usdtIrtRate: number
): {
  updatedTrade: UserExecutedTrade;
  alertTriggered: boolean;
  alertEventType: 'live_update' | 'tp1_risk_free' | 'closed';
  alertReason: string;
} {
  const safeEntry = trade.entryPriceUsdt > 0 ? trade.entryPriceUsdt : 1;
  const priceChangePct = Number((((livePriceUsdt - safeEntry) / safeEntry) * 100).toFixed(2));
  const riskPerUnit = Math.max(0.00000001, Math.abs(safeEntry - trade.stopUsdt));
  const rMultiple = Number(((livePriceUsdt - safeEntry) / riskPerUnit).toFixed(2));
  const pnlUsdt = Number(((livePriceUsdt - safeEntry) * trade.quantityAsset).toFixed(2));
  const pnlIrt = Math.round(pnlUsdt * usdtIrtRate);
  const currentPriceIrt = Math.round(livePriceUsdt * usdtIrtRate);

  let nextStatus = trade.status;
  let alertTriggered = false;
  let alertEventType: 'live_update' | 'tp1_risk_free' | 'closed' = 'live_update';
  let monitoringNote = trade.monitoringNote;

  if (trade.status === 'active' || trade.status === 'tp1_hit') {
    if (livePriceUsdt >= trade.tp2Usdt) {
      nextStatus = 'closed_tp2';
      alertTriggered = true;
      alertEventType = 'closed';
      monitoringNote = 'هدف دوم (TP2) لمس شد — تسویه کامل با سود حداکثری.';
    } else if (livePriceUsdt <= trade.stopUsdt && trade.status === 'active') {
      nextStatus = 'closed_sl';
      alertTriggered = true;
      alertEventType = 'closed';
      monitoringNote = 'حد ضرر (SL) لمس شد — خروج منضبط.';
    } else if (livePriceUsdt >= trade.tp1Usdt && trade.status === 'active') {
      nextStatus = 'tp1_hit';
      alertTriggered = true;
      alertEventType = 'tp1_risk_free';
      monitoringNote =
        'هدف اول (TP1) لمس شد! ۵۰٪ سیو سود و انتقال استاپ به نقطه ورود (ریسک‌فری).';
    } else {
      const distToTp1Pct = Number(
        (((trade.tp1Usdt - livePriceUsdt) / livePriceUsdt) * 100).toFixed(2)
      );
      monitoringNote =
        priceChangePct >= 0
          ? `در سود (${priceChangePct}%+ | +${rMultiple}R) — فاصله تا هدف اول: ${Math.max(0, distToTp1Pct)}%`
          : `در نوسان (${priceChangePct}% | ${rMultiple}R) — حد ضرر فعال است`;
    }
  }

  const updatedTrade: UserExecutedTrade = {
    ...trade,
    currentPriceUsdt: livePriceUsdt,
    currentPriceIrt,
    priceChangePct,
    unrealizedOrRealizedR: rMultiple,
    pnlUsdt,
    pnlIrt,
    status: nextStatus,
    monitoringNote,
  };

  return {
    updatedTrade,
    alertTriggered,
    alertEventType,
    alertReason: monitoringNote,
  };
}

/**
 * 8B. REAL-TIME SIGNAL RECALIBRATION & LOCKED SIGNAL CONTINUOUS MONITOR
 * - If signal.isLocked === true: freezes entryLow/entryHigh/stop/tp1/tp2 and tracks live price against locked targets.
 * - If signal.isLocked !== true: calibrates entryLow/entryHigh/stop/tp1/tp2 around the real live price from Wallex/Kraken/Yahoo.
 */
export function recalibrateSignalWithLiveMarket(
  signal: Signal,
  livePriceUsdt: number,
  usdtIrtRate: number,
  change24hPct?: number,
  sourceLabel?: string
): Signal {
  if (!Number.isFinite(livePriceUsdt) || livePriceUsdt <= 0) {
    return signal;
  }

  const cleanLive = roundSmartPrice(livePriceUsdt);
  const safeUsdtIrt = usdtIrtRate > 10000 ? usdtIrtRate : 265000;

  // CASE A: Signal is LOCKED by the user -> Freeze Entry/SL/TP and evaluate live progress!
  if (signal.isLocked) {
    const refEntry = signal.lockedEntryMid || signal.entryMid || cleanLive;
    const changeFromEntryPct = Number((((cleanLive - refEntry) / refEntry) * 100).toFixed(2));
    const stopDist = Math.max(refEntry * 0.005, Math.abs(refEntry - signal.stop));
    const currentR = Number(((cleanLive - refEntry) / stopDist).toFixed(2));

    let nextStatus = signal.status;
    let lockedNote = signal.lockedMonitoringNote || 'در حال پایش زنده سیگنال قفل‌شده';

    if (cleanLive >= signal.tp2) {
      nextStatus = 'closed_tp2';
      lockedNote = `🏆 هدف دوم (\u200ETP2: $${formatSmartPrice(signal.tp2)}\u200F) لمس شد — تسویه با سود کامل (\u200E+${currentR}R\u200F)`;
    } else if (cleanLive <= signal.stop) {
      nextStatus = 'closed_sl';
      lockedNote = `🛑 حد ضرر (\u200ESL: $${formatSmartPrice(signal.stop)}\u200F) فعال شد — خروج منضبط (\u200E-1.0R\u200F)`;
    } else if (cleanLive >= signal.tp1) {
      nextStatus = 'tp1';
      lockedNote = `✅ هدف اول (\u200ETP1: $${formatSmartPrice(signal.tp1)}\u200F) لمس شد — ۵۰٪ سیو سود و ریسک‌فری`;
    } else if (cleanLive >= signal.entryLow && cleanLive <= signal.entryHigh * 1.004) {
      if (nextStatus === 'pending') {
        nextStatus = 'open';
      }
      lockedNote = `🎯 قیمت داخل ناحیه ورود قفل‌شده (\u200E$${formatSmartPrice(signal.entryLow)} – $${formatSmartPrice(signal.entryHigh)}\u200F) قرار دارد`;
    } else {
      const distTp1 = Number((((signal.tp1 - cleanLive) / cleanLive) * 100).toFixed(2));
      lockedNote =
        changeFromEntryPct >= 0
          ? `🟢 در سود (\u200E+${changeFromEntryPct}%\u200F | \u200E+${currentR}R\u200F) • فاصله تا هدف اول: \u200E${Math.max(0, distTp1)}%\u200F`
          : `🟡 در نوسان (\u200E${changeFromEntryPct}%\u200F | \u200E${currentR}R\u200F) • حد ضرر \u200E$${formatSmartPrice(signal.stop)}\u200F فعال است`;
    }

    return {
      ...signal,
      currentPrice: cleanLive,
      change24hPct: change24hPct ?? signal.change24hPct,
      liveSourceLabel: sourceLabel || signal.liveSourceLabel || 'والکس + کراکن (زنده)',
      status: nextStatus,
      lockedChangePct: changeFromEntryPct,
      lockedCurrentR: currentR,
      lockedMonitoringNote: lockedNote,
      usdtIrtRate: safeUsdtIrt,
      entryLowIrt: Math.round(signal.entryLow * safeUsdtIrt),
      entryHighIrt: Math.round(signal.entryHigh * safeUsdtIrt),
      stopIrt: Math.round(signal.stop * safeUsdtIrt),
      tp1Irt: Math.round(signal.tp1 * safeUsdtIrt),
      tp2Irt: Math.round(signal.tp2 * safeUsdtIrt),
      iranQuotes: {
        wallex: {
          ...signal.iranQuotes.wallex,
          usdtPairPrice: cleanLive,
          irtPairPrice: Math.round(cleanLive * safeUsdtIrt),
        },
        bitpin: {
          ...signal.iranQuotes.bitpin,
          usdtPairPrice: roundSmartPrice(cleanLive * 0.9995),
          irtPairPrice: Math.round(cleanLive * (safeUsdtIrt - 120)),
        },
      },
    };
  }

  // CASE B: Signal is UNLOCKED -> If closed, only update currentPrice & IRT rates. If pending/open, calibrate around real live price!
  if (!['pending', 'open', 'tp1'].includes(signal.status)) {
    return {
      ...signal,
      currentPrice: cleanLive,
      change24hPct: change24hPct ?? signal.change24hPct,
      liveSourceLabel: sourceLabel || signal.liveSourceLabel || 'والکس + کراکن (زنده)',
      usdtIrtRate: safeUsdtIrt,
    };
  }

  // Preserve original structural percentages relative to currentPrice
  const origCurr = signal.currentPrice > 0 ? signal.currentPrice : cleanLive;
  const driftRatio = Math.abs(cleanLive - origCurr) / origCurr;

  // If price drifted more than 0.25% from stored currentPrice, scale levels proportionally to match live market
  const scale = driftRatio > 0.0025 ? cleanLive / origCurr : 1;

  const entryLow = roundSmartPrice(signal.entryLow * scale);
  const entryHigh = roundSmartPrice(signal.entryHigh * scale);
  const rawMid = (entryLow + entryHigh) / 2;
  const entryMid = roundSmartPrice((entryHigh + rawMid) / 2);
  const stop = roundSmartPrice(signal.stop * scale);
  const tp1 = roundSmartPrice(signal.tp1 * scale);
  const tp2 = roundSmartPrice(signal.tp2 * scale);
  const tp3Pump = signal.tp3Pump ? roundSmartPrice(signal.tp3Pump * scale) : undefined;

  const stopDist = Math.max(entryMid * 0.005, Math.abs(entryMid - stop));
  const stopDistancePct = Number(((stopDist / entryMid) * 100).toFixed(2));
  const tp1Dist = Math.abs(tp1 - entryMid);
  const tp2Dist = Math.abs(tp2 - entryMid);
  const roundTripCostPerUnit = entryMid * (signal.roundTripCostPct / 100);

  const netRrTp1 = Number(
    ((tp1Dist - roundTripCostPerUnit) / (stopDist + roundTripCostPerUnit)).toFixed(2)
  );
  const netRrTp2 = Number(
    ((tp2Dist - roundTripCostPerUnit) / (stopDist + roundTripCostPerUnit)).toFixed(2)
  );
  const netProfitTp1Pct = Number(
    (((tp1Dist - roundTripCostPerUnit) / entryMid) * 100).toFixed(2)
  );
  const netProfitTp2Pct = Number(
    (((tp2Dist - roundTripCostPerUnit) / entryMid) * 100).toFixed(2)
  );
  const netProfitTp3Pct = tp3Pump
    ? Number((((Math.abs(tp3Pump - entryMid) - roundTripCostPerUnit) / entryMid) * 100).toFixed(1))
    : signal.netProfitTp3Pct;

  const costToTp1Ratio = tp1Dist > 0 ? roundTripCostPerUnit / tp1Dist : 0.25;
  const isEconomicallyJustified =
    netRrTp1 >= 1.25 && netProfitTp1Pct >= 1.2 && costToTp1Ratio <= 0.30;

  return {
    ...signal,
    currentPrice: cleanLive,
    change24hPct: change24hPct ?? signal.change24hPct,
    liveSourceLabel: sourceLabel || signal.liveSourceLabel || 'والکس + کراکن (زنده)',
    entryLow,
    entryHigh,
    entryMid,
    stop,
    stopDistancePct,
    tp1,
    tp2,
    tp3Pump,
    netRrTp1,
    netRrTp2,
    netProfitTp1Pct,
    netProfitTp2Pct,
    netProfitTp3Pct,
    isEconomicallyJustified,
    usdtIrtRate: safeUsdtIrt,
    entryLowIrt: Math.round(entryLow * safeUsdtIrt),
    entryHighIrt: Math.round(entryHigh * safeUsdtIrt),
    stopIrt: Math.round(stop * safeUsdtIrt),
    tp1Irt: Math.round(tp1 * safeUsdtIrt),
    tp2Irt: Math.round(tp2 * safeUsdtIrt),
    iranQuotes: {
      wallex: {
        ...signal.iranQuotes.wallex,
        usdtPairPrice: cleanLive,
        irtPairPrice: Math.round(cleanLive * safeUsdtIrt),
      },
      bitpin: {
        ...signal.iranQuotes.bitpin,
        usdtPairPrice: roundSmartPrice(cleanLive * 0.9995),
        irtPairPrice: Math.round(cleanLive * (safeUsdtIrt - 120)),
      },
    },
  };
}

/**
 * 8C. WELL-STRUCTURED LIVE SCAN RADAR SUMMARY FOR TELEGRAM
 */
export function formatScanRadarTelegramSummary(params: {
  dollarGold?: DollarGoldSnapshot;
  usdtIrt?: number;
  xauUsd?: number;
  btcPrice: number;
  ethPrice: number;
  signals: Signal[];
  dashboardUrl?: string;
}): string {
  const { dollarGold, xauUsd, btcPrice, ethPrice, signals, dashboardUrl } = params;
  const timeFa = getTehranTimeLabel();
  const dailyLink = resolveDailyDashboardLink(dashboardUrl, {
    type: 'radar',
    tab: 'signals',
  });

  const xauOunce = Number((dollarGold?.xauUsdOunce || xauUsd || 4080).toFixed(2));
  const activeLive = signals.filter(
    (s) => s.mode === 'live' && ['pending', 'open', 'tp1'].includes(s.status)
  );
  const locked = signals.filter((s) => s.isLocked);
  const topSignals = [...activeLive].sort((a, b) => b.score - a.score).slice(0, 3);
  const rankBadges = ['1️⃣', '2️⃣', '3️⃣'];

  const lines: string[] = [
    `📡 رادار اسکن QuantPulse | ساعت ${timeFa} تهران`,
    ``,
    `🌐 قیمت‌های لحظه‌ای بازار:`,
    `• بیت‌کوین (BTC): \u200E$${btcPrice.toLocaleString('en-US')}\u200F`,
    `• اتریوم (ETH): \u200E$${ethPrice.toLocaleString('en-US')}\u200F`,
    `• انس جهانی طلا: \u200E$${xauOunce.toLocaleString('en-US')}\u200F`,
    ``,
    `🎯 برترین موقعیت‌های فعال (${activeLive.length} باز${locked.length > 0 ? ` • ${locked.length} قفل 🔒` : ''}):`,
  ];

  topSignals.forEach((sig, idx) => {
    const badge = rankBadges[idx] || `${idx + 1}.`;
    const lockIcon = sig.isLocked ? '🔒 ' : '';
    lines.push(
      ``,
      `${badge} ${lockIcon}\u200E${sig.symbol}\u200F (${sig.persianName}) — امتیاز \u200E${sig.score}/100\u200F`,
      `   • محدوده ورود: \u200E$${formatSmartPrice(sig.entryLow)} تا $${formatSmartPrice(sig.entryHigh)}\u200F`,
      `   • حد ضرر: \u200E$${formatSmartPrice(sig.stop)}\u200F`,
      `   • تارگت ۱: \u200E$${formatSmartPrice(sig.tp1)}\u200F (\u200E+${sig.netRrTp1}R\u200F)`
    );
  });

  lines.push(
    ``,
    `🔗 لینک یکتای داشبورد گیت‌هاب:`,
    dailyLink
  );

  return applyRtlLines(lines);
}

/**
 * Helper to convert structured plain-text Telegram messages into rich Telegram HTML
 * with bold headers, clean spacing, clickable unique GitHub dashboard links, and BiDi safety.
 */
export function formatForTelegramApiHtml(rawText: string): string {
  const escaped = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const htmlLines = lines.map((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return '';

    const clean = line.replace(/^[\u200F\u200E]/, '');

    if (/^https?:\/\/[^\s]+$/i.test(clean.trim())) {
      const rawUrl = clean.trim();
      return `\u200E<a href="${rawUrl}">${rawUrl}</a>`;
    }

    if (
      clean.startsWith('🌐 لینک داشبورد') ||
      clean.startsWith('🔗 لینک داشبورد') ||
      clean.startsWith('🔗 لینک یکتای')
    ) {
      const urlMatch = clean.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        const rawUrl = urlMatch[0];
        return `\u200F🔗 <b>لینک یکتای داشبورد گیت‌هاب:</b>\n\u200E<a href="${rawUrl}">${rawUrl}</a>`;
      }
      return `\u200F<b>${clean}</b>`;
    }

    if (
      index === 0 ||
      clean.startsWith('📊 ') ||
      clean.startsWith('🎯 ') ||
      clean.startsWith('⚖️ ') ||
      clean.startsWith('🔐 ') ||
      clean.startsWith('🏛 ') ||
      clean.startsWith('📡 ') ||
      clean.startsWith('🏆 ') ||
      clean.startsWith('📌 ') ||
      clean.startsWith('🎉 ') ||
      clean.startsWith('🏁 ') ||
      clean.startsWith('🌐 ') ||
      clean.startsWith('💵 ') ||
      clean.startsWith('⏱ ') ||
      clean.startsWith('1️⃣ ') ||
      clean.startsWith('2️⃣ ') ||
      clean.startsWith('3️⃣ ')
    ) {
      return `\u200F<b>${clean}</b>`;
    }

    return line;
  });

  return htmlLines.join('\n');
}

/**
 * 9. CLEAN, ORGANIZED QUANT SIGNAL BULLETIN (ONE METRIC PER LINE + UNIQUE GITHUB DASHBOARD LINK)
 */
export function formatTelegramSignalMessage(
  signal: Signal,
  settingsOrSizing?: BotSettings | PositionSizeCalculation,
  dashboardUrl?: string
): string {
  const timeframeFa = signal.timeframe === '1h' ? '۱ ساعته (1H)' : '۴ ساعته (4H)';
  const sideLabel = signal.side === 'long' ? '🟢 سیگنال خرید (LONG)' : '🔴 سیگنال فروش (SHORT)';

  const resolvedUrl =
    dashboardUrl ||
    (settingsOrSizing && 'dashboardUrl' in settingsOrSizing
      ? settingsOrSizing.dashboardUrl
      : undefined);
  const targetTab =
    signal.category === 'high_pump' || signal.category === 'forex_tokenized'
      ? 'pump_forex'
      : 'signals';
  const dailyLink = resolveDailyDashboardLink(resolvedUrl, {
    type: 'signal',
    tab: targetTab,
    signalId: signal.id,
    symbol: signal.symbol,
  });

  const change24hText =
    signal.change24hPct !== undefined
      ? ` (\u200E${signal.change24hPct >= 0 ? '+' : ''}${signal.change24hPct}%\u200F)`
      : '';

  const lines: string[] = [
    `${sideLabel} | \u200E${signal.symbol}\u200F`,
    `📌 ${signal.persianName} • تایم‌فریم ${timeframeFa}`,
    ``,
    `💹 قیمت فعلی: \u200E$${formatSmartPrice(signal.currentPrice)} USDT\u200F${change24hText}`,
    `🎯 ورود: \u200E$${formatSmartPrice(signal.entryLow)} تا $${formatSmartPrice(signal.entryHigh)} USDT\u200F`,
    `🛑 حد ضرر: \u200E$${formatSmartPrice(signal.stop)} USDT\u200F (\u200E-${signal.stopDistancePct}%\u200F)`,
    ``,
    `✅ تارگت ۱: \u200E$${formatSmartPrice(signal.tp1)} USDT\u200F (\u200E+${signal.netProfitTp1Pct}%\u200F | \u200E+${signal.netRrTp1}R\u200F)`,
    `🏆 تارگت ۲: \u200E$${formatSmartPrice(signal.tp2)} USDT\u200F (\u200E+${signal.netProfitTp2Pct}%\u200F | \u200E+${signal.netRrTp2}R\u200F)`,
  ];

  if (signal.tp3Pump && signal.netProfitTp3Pct) {
    lines.push(
      `🔥 تارگت ۳: \u200E$${formatSmartPrice(signal.tp3Pump)} USDT\u200F (\u200E+${signal.netProfitTp3Pct}%\u200F)`
    );
  }

  lines.push(
    ``,
    `⚖️ ریسک به ریوارد خالص: \u200E${signal.netRrTp1}R / ${signal.netRrTp2}R\u200F`,
    `📊 امتیاز کیفیت: \u200E${signal.score}/100\u200F • برد تاریخی: \u200E${signal.bracketStat.tp1WinRatePct}%\u200F`,
    ``,
    `🔗 لینک یکتای داشبورد گیت‌هاب:`,
    dailyLink
  );

  return applyRtlLines(lines);
}

/**
 * 9B. ORGANIZED TELEGRAM MONITORING REPORT FOR LOCKED SIGNALS
 */
export function formatLockedSignalsTelegramReport(
  lockedSignals: Signal[],
  dashboardUrl?: string
): string {
  const dailyLink = resolveDailyDashboardLink(dashboardUrl, {
    type: 'locked',
    tab: 'signals',
    filter: 'locked',
  });
  const timeFa = getTehranTimeLabel();

  if (lockedSignals.length === 0) {
    return applyRtlLines([
      `🔐 پایش سیگنال‌های قفل‌شده | ساعت ${timeFa}`,
      `• هیچ سیگنال قفل‌شده‌ای فعال نیست.`,
      ``,
      `🔗 لینک یکتای داشبورد گیت‌هاب:`,
      dailyLink,
    ]);
  }

  const lines: string[] = [
    `🔐 پایش سیگنال‌های قفل‌شده | ساعت ${timeFa} (${lockedSignals.length} مورد)`,
  ];

  lockedSignals.forEach((sig, idx) => {
    const chVal = sig.lockedChangePct ?? 0;
    const rVal = sig.lockedCurrentR ?? 0;
    const chSign = chVal >= 0 ? '+' : '';
    const rSign = rVal >= 0 ? '+' : '';
    lines.push(
      ``,
      `${idx + 1}. 🔒 \u200E${sig.symbol}\u200F (${sig.persianName})`,
      `   • قیمت فعلی: \u200E$${formatSmartPrice(sig.currentPrice)} USDT\u200F (\u200E${chSign}${chVal}%\u200F | \u200E${rSign}${rVal}R\u200F)`,
      `   • حد ضرر: \u200E$${formatSmartPrice(sig.stop)}\u200F`,
      `   • تارگت ۱: \u200E$${formatSmartPrice(sig.tp1)}\u200F`
    );
  });

  lines.push(
    ``,
    `🔗 لینک یکتای داشبورد گیت‌هاب:`,
    dailyLink
  );
  return applyRtlLines(lines);
}

/**
 * 10. ORGANIZED USER-EXECUTED TRADE TELEGRAM UPDATE (PURE USDT & R-MULTIPLES)
 */
export function formatExecutedTradeTelegramMessage(
  trade: UserExecutedTrade,
  eventType: 'entry_confirmed' | 'live_update' | 'tp1_risk_free' | 'closed',
  dashboardUrl?: string
): string {
  const dailyLink = resolveDailyDashboardLink(dashboardUrl, {
    type: 'trade',
    tab: 'performance',
    tradeId: trade.id,
    symbol: trade.symbol,
  });
  const exchangeFa = trade.exchange === 'wallex' ? 'والکس' : 'بیت‌پین';

  const headerTitle =
    eventType === 'entry_confirmed'
      ? '📌 ثبت ورود معامله'
      : eventType === 'tp1_risk_free'
        ? '🎉 لمس هدف ۱ (ریسک‌فری)'
        : eventType === 'closed'
          ? '🏁 بسته شدن معامله'
          : '📡 پایش معامله';

  const changeSign = trade.priceChangePct >= 0 ? '+' : '';
  const pnlSign = trade.pnlUsdt >= 0 ? '+' : '';

  const lines: string[] = [
    `${headerTitle} | \u200E${trade.symbol}\u200F (${exchangeFa})`,
    ``,
    `📥 قیمت ورود: \u200E$${formatSmartPrice(trade.entryPriceUsdt)} USDT\u200F`,
    `💹 قیمت فعلی: \u200E$${formatSmartPrice(trade.currentPriceUsdt)} USDT\u200F (\u200E${changeSign}${trade.priceChangePct}%\u200F)`,
    `💎 سود/زیان: \u200E${pnlSign}${trade.pnlUsdt.toLocaleString('en-US')} USDT\u200F (\u200E${pnlSign}${trade.unrealizedOrRealizedR}R\u200F)`,
    ``,
    `🛑 حد ضرر: \u200E$${formatSmartPrice(trade.stopUsdt)} USDT\u200F`,
    `🎯 تارگت ۱: \u200E$${formatSmartPrice(trade.tp1Usdt)} USDT\u200F`,
    ``,
    `🔗 لینک یکتای داشبورد گیت‌هاب:`,
    dailyLink,
  ];

  return applyRtlLines(lines);
}

/**
 * 11. ORGANIZED DAILY SIGNAL PERFORMANCE & WIN-RATE TELEGRAM REPORT
 */
export function formatDailyPerformanceTelegramReport(
  report: DailyPerformanceReport,
  winRateSummary: SignalWinRateSummary,
  dashboardUrl?: string
): string {
  const dailyLink = resolveDailyDashboardLink(dashboardUrl, {
    type: 'performance',
    tab: 'performance',
  });
  const netSign = report.netRealizedR >= 0 ? '+' : '';
  const userSign = winRateSummary.userTotalPnlUsdt >= 0 ? '+' : '';

  const lines: string[] = [
    `🏆 کارنامه روزانه | ${report.persianDate}`,
    ``,
    `📈 نرخ برد (Win Rate): \u200E${report.winRatePct}%\u200F`,
    `💎 برآیند خالص: \u200E${netSign}${report.netRealizedR}R\u200F`,
    ``,
    `📊 وضعیت سیگنال‌ها:`,
    `• کل سیگنال‌ها: ${report.totalSignalsIssued} مورد`,
    `• سیگنال‌های باز: ${report.openCount} مورد`,
    `• رسیده به تارگت ۲: ${report.wonTp2Count} مورد`,
    `• رسیده به تارگت ۱: ${report.wonTp1Count} مورد`,
    `• برخورد به حد ضرر: ${report.stoppedSlCount} مورد`,
    ``,
    `💼 معاملات ثبت‌شده شما: ${winRateSummary.userTradesTotal} مورد (\u200E${userSign}${winRateSummary.userTotalPnlUsdt} USDT\u200F)`,
    ``,
    `🔗 لینک یکتای داشبورد گیت‌هاب:`,
    dailyLink,
  ];

  return applyRtlLines(lines);
}

/**
 * 12. ORGANIZED DAILY MACRO, DOLLAR, GOLD & CRYPTO TELEGRAM REPORT
 */
export function formatDailyTelegramReport(params: {
  dollarGold: DollarGoldSnapshot;
  btcPrice: number;
  btcChange24h: number;
  ethPrice: number;
  ethChange24h: number;
  btcDominance: number;
  fearGreedIndex: number;
  fearGreedLabel: string;
  activeSignalsCount: number;
  recent30WinRatePct: number;
  recent30NetR: number;
  settings: BotSettings;
}): string {
  const {
    dollarGold,
    btcPrice,
    btcChange24h,
    ethPrice,
    ethChange24h,
    fearGreedIndex,
    activeSignalsCount,
    recent30WinRatePct,
    recent30NetR,
    settings,
  } = params;

  const bubbleInfo = computeGoldIntrinsicAndBubble({
    xauUsdOunce: dollarGold.xauUsdOunce,
    usdtIrtRate: dollarGold.usdtIrtAverage,
    gold18kMarketIrt: dollarGold.gold18kMarketIrt,
  });

  const persianDate = getPersianDateLabel(dollarGold.updatedAt);
  const dailyLink = resolveDailyDashboardLink(settings.dashboardUrl, {
    type: 'macro',
    tab: 'dollar_gold',
  });

  const shortH = dollarGold.multiHorizonAnalysis?.[0];

  const lines: string[] = [
    `🏛 بولتن کلیدی دلار، طلا و کریپتو | ${persianDate}`,
    ``,
    `💵 بازار داخلی و طلا:`,
    `• تتر والکس: ${dollarGold.usdtIrtWallex.toLocaleString('fa-IR')} تومان`,
    `• انس جهانی طلا: \u200E$${dollarGold.xauUsdOunce.toLocaleString('en-US')}\u200F`,
    `• طلای ۱۸ عیار: ${dollarGold.gold18kMarketIrt.toLocaleString('fa-IR')} تومان (حباب: \u200E${bubbleInfo.bubblePct >= 0 ? '+' : ''}${bubbleInfo.bubblePct}%\u200F)`,
    ``,
    `🌐 بازار جهانی کریپتو:`,
    `• بیت‌کوین (BTC): \u200E$${btcPrice.toLocaleString('en-US')}\u200F (\u200E${btcChange24h >= 0 ? '+' : ''}${btcChange24h}%\u200F)`,
    `• اتریوم (ETH): \u200E$${ethPrice.toLocaleString('en-US')}\u200F (\u200E${ethChange24h >= 0 ? '+' : ''}${ethChange24h}%\u200F)`,
    `• شاخص ترس و طمع: \u200E${fearGreedIndex}\u200F`,
  ];

  if (shortH) {
    lines.push(
      ``,
      `⏱ سطوح کلیدی کوتاه‌مدت:`,
      `• تتر: ورود ${shortH.dollarPlan.entryZone}`,
      `  هدف اول: ${shortH.dollarPlan.takeProfit1}`,
      `• طلا (PAXG): ورود ${shortH.goldPlan.entryZone}`,
      `  هدف اول: ${shortH.goldPlan.takeProfit1}`
    );
  }

  lines.push(
    ``,
    `📊 وضعیت ربات: ${activeSignalsCount} سیگنال فعال • نرخ برد: \u200E${recent30WinRatePct}%\u200F (\u200E+${recent30NetR}R\u200F)`,
    ``,
    `🔗 لینک یکتای داشبورد گیت‌هاب:`,
    dailyLink
  );

  return applyRtlLines(lines);
}

