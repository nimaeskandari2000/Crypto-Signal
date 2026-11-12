export type MarketType = 'spot_ir' | 'perp_global';
export type SignalSide = 'long' | 'short';
export type SignalMode = 'live' | 'shadow';
export type SignalTimeframe = '1h' | '4h' | '1d' | '1w';
export type AssetCategory =
  | 'core_crypto'
  | 'gold_dollar'
  | 'high_pump'
  | 'forex_tokenized';

export type MarketRegime =
  | 'bull_low_vol'
  | 'bull_high_vol'
  | 'bear_low_vol'
  | 'bear_high_vol'
  | 'range_low_vol'
  | 'range_high_vol';

export type SignalStatus =
  | 'pending'
  | 'open'
  | 'tp1'
  | 'closed_tp2'
  | 'closed_sl'
  | 'closed_be'
  | 'time_stop'
  | 'expired'
  | 'invalidated_tp_before_entry';

export type StrategyId =
  | 'liquidity_sweep'
  | 'break_retest'
  | 'trend_pullback'
  | 'range_reversal'
  | 'squeeze_breakout'
  | 'relative_strength'
  | 'gold_dollar_hedge';

export interface Candle {
  timestamp: number; // UTC ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SwingPoint {
  index: number;
  timestamp: number;
  confirmedAtIndex: number;
  confirmedAtTimestamp: number;
  price: number;
  type: 'high' | 'low';
}

export interface OrthogonalScorePillars {
  structureClarity: number; // 0..35 (Pillar 1: کیفیت ساختار و پرایس اکشن)
  regimeAlignment: number; // 0..25 (Pillar 2: هم‌راستایی رژیم و تایم‌فریم بالاتر)
  volumeAndDepth: number; // 0..25 (Pillar 3: حجم و عمق اردربوک والکس/بیت‌پین)
  netRrEfficiency: number; // 0..15 (Pillar 4: بهینگی ریسک به ریوارد خالص پس از کارمزد)
  total: number; // 0..100
}

export interface ScoreBracketStat {
  bracketLabel: string; // e.g. "80 تا 90"
  sampleSize: number;
  tp1WinRatePct: number;
  avgNetR: number;
  sufficientSample: boolean; // N >= 30
}

export interface IranExchangeQuote {
  exchange: 'wallex' | 'bitpin';
  exchangeLabel: string;
  available: boolean;
  usdtPairPrice: number;
  irtPairPrice: number;
  spreadPct: number;
  orderbookDepthUsd: number;
  depthStatus: 'کافی' | 'متوسط' | 'کم';
  makerFeePct: number;
  takerFeePct: number;
}

export interface Signal {
  id: string;
  createdAt: string; // ISO UTC
  symbol: string; // e.g. "SOL/USDT", "PAXG/USDT", "BTC/USDT", "SLVON/USDT"
  baseAsset: string;
  persianName: string;
  category?: AssetCategory;
  market: MarketType;
  side: SignalSide;
  strategy: StrategyId;
  strategyLabel: string;
  strategyVersion: string;
  timeframe: SignalTimeframe;
  timeHorizonFa: string; // e.g. "کوتاه‌مدت (۱۲ تا ۳۶ ساعت)" or "میان‌مدت (۱ تا ۳ روز)"
  expectedHoldHours: string;
  entryLow: number;
  entryHigh: number;
  entryMid: number; // Two-tranche blended fill price
  currentPrice: number;
  change24hPct?: number;
  isTop24hGainer?: boolean;
  stop: number;
  stopDistancePct: number;
  tp1: number;
  tp2: number;
  tp3Pump?: number; // Extended explosive target for high-pump candidates
  netProfitTp3Pct?: number;
  grossRrTp1: number;
  netRrTp1: number; // After round-trip fee + slippage
  netRrTp2: number; // After round-trip fee + slippage
  netProfitTp1Pct: number; // Net % profit at TP1 after round-trip fee
  netProfitTp2Pct: number; // Net % profit at TP2 after round-trip fee
  isEconomicallyJustified: boolean; // True if netRrTp1 >= 1.75 and netProfitTp1Pct >= 2.0
  roundTripCostPct: number;
  expiryCandles: number;
  expiresAt: string;
  score: number;
  pillars: OrthogonalScorePillars;
  bracketStat: ScoreBracketStat;
  maxLeverage: number;
  rationale: string;
  htfTrend: 'صعودی' | 'نزولی' | 'رنج';
  regime: MarketRegime;
  mode: SignalMode;
  status: SignalStatus;
  realizedR?: number;
  mfeR?: number;
  maeR?: number;
  // Signal Locking & Continuous Monitoring fields
  isLocked?: boolean;
  userLockedExplicitly?: boolean;
  lockedAt?: string;
  lockedPriceAtLock?: number;
  lockedEntryMid?: number;
  lockedChangePct?: number;
  lockedCurrentR?: number;
  lockedMonitoringNote?: string;
  lastLockedAlertAt?: string;
  // Pump & Forex / Tokenized Asset extended metadata
  volumeSurgeMultiplier?: number; // e.g. 3.4x average volume
  pumpPotentialScore?: number; // 0..100 explosive breakout score
  pumpCatalystFa?: string;
  maxAllocationPct?: number; // e.g. 3% of portfolio for high-beta pump coins
  underlyingMarketFa?: string; // e.g. "بورس نزدک آمریکا (NASDAQ)" or "بازار جهانی کامودیتی / فارکس"
  liveSourceLabel?: string; // e.g. "والکس + کراکن (زنده)"
  iranQuotes: {
    wallex: IranExchangeQuote;
    bitpin: IranExchangeQuote;
  };
  usdtIrtRate: number;
  entryLowIrt: number;
  entryHighIrt: number;
  stopIrt: number;
  tp1Irt: number;
  tp2Irt: number;
  lossTags?: string[];
}

export interface UserExecutedTrade {
  id: string;
  signalId: string;
  symbol: string;
  baseAsset: string;
  persianName: string;
  strategyLabel: string;
  timeframe: SignalTimeframe;
  timeHorizonFa: string;
  exchange: 'wallex' | 'bitpin';
  enteredAt: string; // ISO
  entryPriceUsdt: number;
  entryPriceIrt: number;
  currentPriceUsdt: number;
  currentPriceIrt: number;
  stopUsdt: number;
  stopIrt: number;
  tp1Usdt: number;
  tp1Irt: number;
  tp2Usdt: number;
  tp2Irt: number;
  quantityAsset: number;
  notionalUsdt: number;
  notionalIrt: number;
  riskAmountUsdt: number;
  riskAmountIrt: number;
  status: 'active' | 'tp1_hit' | 'closed_tp2' | 'closed_sl' | 'closed_manual';
  priceChangePct: number;
  unrealizedOrRealizedR: number;
  pnlUsdt: number;
  pnlIrt: number;
  lastTelegramAlertAt: string;
  monitoringNote: string;
}

export interface DailyPerformanceReport {
  id: string;
  dateKey: string; // YYYY-MM-DD
  persianDate: string; // e.g. ۱۸ آبان ۱۴۰۵
  createdAt: string;
  totalSignalsIssued: number;
  resolvedCount: number;
  wonTp1Count: number;
  wonTp2Count: number;
  stoppedSlCount: number;
  invalidatedBeforeEntryCount: number;
  openCount: number;
  winRatePct: number;
  netRealizedR: number;
  cumulativeWinRatePct: number;
  cumulativeNetR: number;
  bestSignalSymbol: string;
  bestSignalR: number;
  usdtIrtClose: number;
  xauUsdClose: number;
  gold18kCloseIrt: number;
  summaryNote: string;
}

export interface SignalWinRateSummary {
  totalSignals: number;
  resolvedSignals: number;
  activeSignals: number;
  wonSignals: number;
  wonTp1Only: number;
  wonTp2Full: number;
  lostSignals: number;
  invalidatedBeforeEntry: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  cumulativeNetR: number;
  userTradesTotal: number;
  userTradesActive: number;
  userTradesWinRatePct: number;
  userTotalPnlUsdt: number;
  userTotalPnlIrt: number;
}

export interface HorizonAssetActionPlan {
  entryVerdict: 'ورود مجاز (خرید پله‌ای)' | 'انتظار اصلاح به حمایت' | 'عدم ورود (اشباع / ریسک بالا)';
  verdictColor: 'emerald' | 'amber' | 'rose';
  verdictReason: string;
  entryZone: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  netRr: string;
}

export interface HorizonTechFundAnalysis {
  horizon: 'short' | 'medium' | 'long';
  horizonLabel: string;
  timeframeBadge: string;
  dollarBias: string;
  dollarTechnical: string;
  dollarFundamental: string;
  dollarKeyLevels: string;
  dollarPlan: HorizonAssetActionPlan;
  goldBias: string;
  goldTechnical: string;
  goldFundamental: string;
  goldKeyLevels: string;
  goldPlan: HorizonAssetActionPlan;
  actionableStrategy: string;
}

export interface DollarGoldSnapshot {
  updatedAt: string;
  usdtIrtWallex: number;
  usdtIrtBitpin: number;
  usdtIrtAverage: number;
  usdtIrtChange24hPct: number;
  usdtIrtSpreadPct: number;
  usdtIrtRegime: 'صعودی' | 'نزولی' | 'رنج';
  usdtIrtSupport: number;
  usdtIrtResistance: number;
  xauUsdOunce: number; // Global Gold Ounce USD
  paxgUsdtPrice: number; // PAXG/USDT on Wallex & Bitpin
  paxgIrtWallex: number;
  paxgIrtBitpin: number;
  xauChange24hPct: number;
  xauRegime: 'صعودی' | 'نزولی' | 'رنج';
  xauSupportUsd: number;
  xauResistanceUsd: number;
  gold18kMarketIrt: number; // 1 gram 18K gold in Toman
  gold18kIntrinsicIrt: number; // Calculated from XAU * USDT_IRT * 0.750 / 31.1034768
  goldBubblePct: number; // Percentage difference between market & intrinsic
  goldCoinEmamiIrt: number;
  dailyBiasSummary: string;
  actionableRecommendation: string;
  arbitrageNote: string;
  multiHorizonAnalysis: HorizonTechFundAnalysis[];
}

export interface PositionSizeCalculation {
  equityUsdt: number;
  equityIrt: number;
  riskPct: number;
  riskAmountUsdt: number;
  riskAmountIrt: number;
  selectedExchange: 'wallex' | 'bitpin';
  effectiveEntryUsdt: number;
  effectiveEntryIrt: number;
  quantityAsset: number;
  positionNotionalUsdt: number;
  positionNotionalIrt: number;
  capitalSharePct: number;
  roundTripFeeUsdt: number;
  roundTripFeeIrt: number;
  netLossAtSlUsdt: number;
  netLossAtSlIrt: number;
  netProfitAtTp1Usdt: number;
  netProfitAtTp1Irt: number;
  netProfitAtTp2Usdt: number;
  netProfitAtTp2Irt: number;
  recommendedMaxLeverage: number;
  liquidationPriceUsdt: number | null;
  feeToTp1RatioPct: number;
  isFeeExcessive: boolean; // > 20% of TP1 distance
  portfolioHeatWarning: string | null;
}

export interface StrategyValidationMetrics {
  id: StrategyId;
  name: string;
  persianName: string;
  description: string;
  version: string;
  enabled: boolean; // true = live, false = shadow
  autoDemotedByCircuitBreaker: boolean;
  demotionReason?: string;
  markets: MarketType[];
  timeframes: SignalTimeframe[];
  allowedRegimes: MarketRegime[];
  params: {
    swingLength: number;
    atrBuffer: number;
    minRr: number;
    timeStopCandles: number;
  };
  walkForward: {
    outOfSampleTrades: number;
    expectancyR: number;
    profitFactor: number;
    winRatePct: number;
    positiveWindowsPct: number; // Gate >= 60%
    monteCarlo95MaxDdR: number;
    parameterStabilityScore: number; // 0..100
    passedGate: boolean;
  };
  livePerformance: {
    recent30TradesCount: number;
    recent30ExpectancyR: number;
    consecutiveLosses: number;
    currentDrawdownR: number;
    maxAllowedDrawdownR: number;
    status: 'nominal' | 'warning' | 'circuit_broken';
  };
}

export interface PostmortemTagSummary {
  tag: string;
  persianLabel: string;
  occurrences: number;
  shareOfLossesPct: number;
  avgRealizedR: number;
  suggestedRule: string;
}

export interface ChallengerComparison {
  id: string;
  createdAt: string;
  weeksRunning: number;
  shadowTradesCount: number;
  championWeights: {
    structureClarity: number;
    regimeAlignment: number;
    volumeAndDepth: number;
    netRrEfficiency: number;
  };
  challengerWeights: {
    structureClarity: number;
    regimeAlignment: number;
    volumeAndDepth: number;
    netRrEfficiency: number;
  };
  championExpectancyR: number;
  challengerExpectancyR: number;
  championMaxDdR: number;
  challengerMaxDdR: number;
  confidenceLowerBoundDiffR: number;
  readyToPromote: boolean;
  promoted: boolean;
}

export interface DataSourceHealth {
  id: string;
  name: string;
  category: 'ایران (اسپات)' | 'جهانی (کندل و حجم)' | 'طلا و دلار' | 'کلان و سنتیمنت';
  status: 'online' | 'fallback' | 'degraded';
  latencyMs: number;
  lastSuccessAt: string;
  consecutiveFailures: number;
  fallbackUsed: string;
  note: string;
}

export interface BotSettings {
  referenceEquityUsdt: number;
  referenceEquityIrt: number;
  riskPerTradePct: number;
  maxDirectionalPortfolioHeatPct: number;
  maxOpenSignals: number;
  maxNewSignalsPerDay: number;
  minScoreTelegram: number;
  minScoreDashboard: number;
  cooldownSameDirectionHours: number;
  cooldownAfterSlHours: number;
  maxFeeToTp1Pct: number;
  defaultExchangeIr: 'wallex' | 'bitpin';
  quoteCurrencyPreference: 'BOTH' | 'IRT' | 'USDT';
  enablePerpGlobal: boolean;
  includeDollarGoldInDaily: boolean;
  wallexMakerFeePct: number;
  wallexTakerFeePct: number;
  bitpinMakerFeePct: number;
  bitpinTakerFeePct: number;
  telegramBotToken: string;
  telegramChatId: string;
  telegramSendShadow: boolean;
  autoSchedulerEnabled: boolean;
  scanIntervalMinutes: number; // Default 15 minutes optimal
  lockedMonitorIntervalMinutes: number; // Default 5 minutes optimal for locked signals
  autoSendTelegramOnScan: boolean;
  dashboardUrl: string;
}
