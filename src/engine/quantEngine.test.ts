import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePositionSizing,
  computeGoldIntrinsicAndBubble,
  computeOrthogonalScore,
  detectConfirmedSwings,
  evaluateCircuitBreaker,
  evaluateSignalLifecycle,
  evaluateUserExecutedTrade,
  formatForTelegramApiHtml,
  formatLockedSignalsTelegramReport,
  formatScanRadarTelegramSummary,
  formatTelegramSignalMessage,
  recalibrateSignalWithLiveMarket,
  resolveDailyDashboardLink,
  sanitizeTelegramChatId,
  sanitizeTelegramToken,
} from './quantEngine';
import { Candle, StrategyValidationMetrics } from './types';
import {
  DEFAULT_BOT_SETTINGS,
  buildInitialDollarGoldSnapshot,
  buildInitialExecutedTrades,
  buildInitialSignals,
} from './seedData';

function buildSyntheticCandles(prices: Array<[number, number, number, number]>): Candle[] {
  return prices.map(([open, high, low, close], idx) => ({
    timestamp: 1700000000000 + idx * 3600000,
    open,
    high,
    low,
    close,
    volume: 1000 + idx * 50,
  }));
}

test('Prefix Invariance (Zero Look-Ahead Bias): swing points confirmed by t match full dataset filtered by confirmedAtIndex < t', () => {
  const rawSeries: Array<[number, number, number, number]> = [
    [100, 102, 99, 101],
    [101, 104, 100, 103],
    [103, 108, 102, 107],
    [107, 115, 106, 114],
    [114, 112, 108, 109],
    [109, 110, 104, 105],
    [105, 106, 98, 99],
    [99, 101, 94, 95],
    [95, 99, 96, 98],
    [98, 103, 97, 102],
    [102, 107, 101, 106],
    [106, 111, 105, 110],
    [110, 118, 109, 116],
  ];

  const allCandles = buildSyntheticCandles(rawSeries);
  const fullSwings = detectConfirmedSwings(allCandles, 3, 3);

  for (let t = 5; t <= allCandles.length; t++) {
    const prefixSwings = detectConfirmedSwings(allCandles.slice(0, t), 3, 3);
    const expectedFromFull = fullSwings.filter((s) => s.confirmedAtIndex < t);
    assert.deepEqual(
      prefixSwings,
      expectedFromFull,
      `Mismatch at cutoff t=${t}: look-ahead bias detected`
    );
  }
});

test('Target-Before-Entry Invalidation: cancels pending signal if TP1 is hit prior to entering limit zone', () => {
  const pendingSignal = {
    side: 'long' as const,
    entryLow: 140,
    entryHigh: 142,
    entryMid: 141.5,
    stop: 137,
    tp1: 150,
    tp2: 156,
    expiryCandles: 6,
    status: 'pending' as const,
  };

  const candles = buildSyntheticCandles([
    [145, 151.5, 144.2, 150.8],
    [150.8, 151.0, 135.0, 136.0],
  ]);

  const outcome = evaluateSignalLifecycle(pendingSignal, candles);
  assert.equal(outcome.status, 'invalidated_tp_before_entry');
  assert.equal(outcome.realizedR, 0);
  assert.equal(outcome.candlesElapsed, 1);
});

test('Wallex & Bitpin Position Sizing: accurately computes Toman/USDT size, fees, and fee-to-TP1 guard', () => {
  const sizing = calculatePositionSizing({
    signal: {
      side: 'long',
      entryLow: 85.6,
      entryHigh: 86.2,
      stop: 83.2,
      tp1: 92.4,
      tp2: 98.5,
      market: 'spot_ir',
      usdtIrtRate: 265000,
    },
    equityUsdt: 1000,
    riskPct: 1.0,
    selectedExchange: 'wallex',
    makerFeePct: 0.2,
    takerFeePct: 0.25,
    slippagePct: 0.05,
    currentOpenDirectionalRiskPct: 2.5,
    maxDirectionalPortfolioHeatPct: 3.0,
  });

  assert.equal(sizing.riskAmountUsdt, 10);
  assert.equal(sizing.riskAmountIrt, 2650000);
  assert.ok(sizing.netLossAtSlUsdt <= 10.05 && sizing.netLossAtSlUsdt >= 9.95);
  assert.equal(sizing.isFeeExcessive, false);
  assert.ok(sizing.portfolioHeatWarning !== null);
});

test('4-Pillar Orthogonal Scorer & Circuit Breaker: bounds score [0, 100] and auto-demotes after 8 losses', () => {
  const score = computeOrthogonalScore({
    patternCleanliness0to1: 0.9,
    sweptLiquidityBeforeEntry: true,
    htfAligned: true,
    regimeCompatible: true,
    volumeConfirmation0to1: 0.85,
    orderbookDepthRatio0to1: 0.9,
    netRrTp1: 2.4,
    roundTripCostToTp1Ratio: 0.06,
  });

  assert.ok(score.total >= 80 && score.total <= 100);
  assert.equal(
    score.total,
    score.structureClarity + score.regimeAlignment + score.volumeAndDepth + score.netRrEfficiency
  );

  const mockStrategy: StrategyValidationMetrics = {
    id: 'liquidity_sweep',
    name: 'Liquidity Sweep & Reclaim',
    persianName: 'شکار نقدینگی و بازگشت ساختاری',
    description: '',
    version: 'v2.1',
    enabled: true,
    autoDemotedByCircuitBreaker: false,
    markets: ['spot_ir', 'perp_global'],
    timeframes: ['1h', '4h'],
    allowedRegimes: ['bull_low_vol', 'range_low_vol'],
    params: { swingLength: 8, atrBuffer: 0.25, minRr: 1.6, timeStopCandles: 18 },
    walkForward: {
      outOfSampleTrades: 214,
      expectancyR: 0.38,
      profitFactor: 1.64,
      winRatePct: 58.4,
      positiveWindowsPct: 83.3,
      monteCarlo95MaxDdR: 6.2,
      parameterStabilityScore: 88,
      passedGate: true,
    },
    livePerformance: {
      recent30TradesCount: 30,
      recent30ExpectancyR: -0.18,
      consecutiveLosses: 8,
      currentDrawdownR: 5.4,
      maxAllowedDrawdownR: 6.5,
      status: 'circuit_broken',
    },
  };

  const cb = evaluateCircuitBreaker(mockStrategy);
  assert.equal(cb.shouldDemote, true);
  assert.ok(cb.reason?.includes('۸'));
});

test('Dollar & Gold Intrinsic 18K Calculator & 3-Horizon Entry Plans: accurately computes live Toman value and actionable entry/SL/TP plans', () => {
  const res = computeGoldIntrinsicAndBubble({
    xauUsdOunce: 4080.56,
    usdtIrtRate: 265000,
    gold18kMarketIrt: 26243000,
  });

  assert.ok(res.intrinsic18kIrt > 26000000 && res.intrinsic18kIrt < 26200000);
  assert.equal(res.bubbleStatus, 'تعادلی');

  const dg = buildInitialDollarGoldSnapshot(265000, 264820, 4080.56);
  assert.equal(dg.multiHorizonAnalysis.length, 3);
  for (const h of dg.multiHorizonAnalysis) {
    assert.ok(h.dollarPlan.entryVerdict.length > 0);
    assert.ok(h.dollarPlan.entryZone.length > 0);
    assert.ok(h.dollarPlan.stopLoss.length > 0);
    assert.ok(h.dollarPlan.takeProfit1.length > 0);
    assert.ok(h.goldPlan.entryVerdict.length > 0);
    assert.ok(h.goldPlan.entryZone.length > 0);
    assert.ok(h.goldPlan.stopLoss.length > 0);
    assert.ok(h.goldPlan.takeProfit1.length > 0);
  }
});

test('Live Market Recalibration, Signal Locking, High-Pump Radar, Forex Tokenized Assets & Working Dashboard Link', () => {
  const signals = buildInitialSignals(264910);
  const trades = buildInitialExecutedTrades(264910);

  // Verify all 4 categories exist and all 16 initial signals are economically justified
  const pumpSignals = signals.filter((s) => s.category === 'high_pump');
  const forexSignals = signals.filter((s) => s.category === 'forex_tokenized');
  const coreSignals = signals.filter((s) => s.category === 'core_crypto');
  const goldSignals = signals.filter((s) => s.category === 'gold_dollar');
  const justifiedSignals = signals.filter((s) => s.isEconomicallyJustified);

  assert.equal(pumpSignals.length, 5, 'Should have 5 high-pump signals');
  assert.equal(forexSignals.length, 6, 'Should have 6 forex & tokenized RWA signals');
  assert.ok(coreSignals.length >= 4, 'Should have core crypto signals');
  assert.equal(goldSignals.length, 1, 'Should have PAXG/USDT gold signal');
  assert.ok(
    justifiedSignals.length >= 16,
    `Expected at least 16 economically justified signals, got ${justifiedSignals.length}`
  );

  // Verify Telegram Token & Chat ID Sanitization (handles Persian digits, bot prefix, quotes)
  assert.equal(
    sanitizeTelegramToken(' "bot۱۲۳۴۵۶۷۸۹:ABCdef_123" '),
    '123456789:ABCdef_123'
  );
  assert.equal(sanitizeTelegramChatId(' "۹۸۷۶۵۴۳۲۱" '), '987654321');

  // Verify Scan Radar Telegram Summary includes market rates and top signals
  const radarMsg = formatScanRadarTelegramSummary({
    signals,
    btcPrice: 74500,
    ethPrice: 2350,
    usdtIrt: 265000,
    xauUsd: 4080,
    dashboardUrl: DEFAULT_BOT_SETTINGS.dashboardUrl,
  });
  assert.ok(radarMsg.includes('رادار اسکن QuantPulse'));
  assert.ok(radarMsg.includes('74,500'));

  // Verify Signal Locking freezes entry/SL/TP while updating live progress
  const lockedPaxg = signals.find((s) => s.symbol === 'PAXG/USDT')!;
  assert.equal(lockedPaxg.isLocked, true);
  const origEntryMid = lockedPaxg.entryMid;
  const origStop = lockedPaxg.stop;
  const updatedLocked = recalibrateSignalWithLiveMarket(lockedPaxg, 4215.0, 265000);
  assert.equal(updatedLocked.entryMid, origEntryMid, 'Locked signal must keep frozen entryMid');
  assert.equal(updatedLocked.stop, origStop, 'Locked signal must keep frozen stop');
  assert.equal(updatedLocked.status, 'tp1', 'Locked signal hitting TP1 should update status to tp1');

  // Verify unlocked signal dynamically scales entry/SL/TP to live price
  const unlockedEth = signals.find((s) => s.symbol === 'ETH/USDT')!;
  assert.equal(unlockedEth.isLocked, false);
  const recalibratedEth = recalibrateSignalWithLiveMarket(unlockedEth, 2200, 265000);
  assert.equal(recalibratedEth.currentPrice, 2200);
  assert.ok(recalibratedEth.entryHigh < 2200 && recalibratedEth.entryLow > 2100);

  // Verify working dashboard link replaces YOUR-USERNAME and .run.app placeholders with GitHub link
  const workingLink = resolveDailyDashboardLink('https://github.com/YOUR-USERNAME/quantpulse');
  assert.ok(!workingLink.includes('YOUR-USERNAME'), 'Should replace broken placeholder link');
  assert.ok(workingLink.includes('github.io'), 'Should resolve to GitHub Pages domain');
  assert.ok(!workingLink.includes('.run.app'), 'Must never output .run.app link');

  // Verify Locked Signals Telegram Report
  const lockedList = signals.filter((s) => s.isLocked);
  const lockedReport = formatLockedSignalsTelegramReport(lockedList);
  assert.ok(lockedReport.includes('پایش سیگنال‌های قفل‌شده'));
  assert.ok(lockedReport.includes('PAXG/USDT'));

  // Verify SOL executed trade hitting TP1
  const solTrade = trades.find((t) => t.symbol === 'SOL/USDT')!;
  const evalResult = evaluateUserExecutedTrade(solTrade, 93.0, 265000);
  assert.equal(evalResult.updatedTrade.status, 'tp1_hit');

  // Verify concise Telegram signal bulletin includes live price, entry, SL, TP, net R:R, zero Toman equivalents, and unique GitHub link
  const tgMsg = formatTelegramSignalMessage(signals[0], DEFAULT_BOT_SETTINGS);
  const tgMsg2 = formatTelegramSignalMessage(signals[1], DEFAULT_BOT_SETTINGS);
  assert.ok(tgMsg.startsWith('\u200F'));
  assert.ok(tgMsg.includes('قیمت فعلی:'));
  assert.ok(tgMsg.includes('ورود:'));
  assert.ok(tgMsg.includes('حد ضرر:'));
  assert.ok(tgMsg.includes('تارگت ۱:'));
  assert.ok(tgMsg.split('\n').length <= 10, 'Signal Telegram message must be concise (<= 10 lines)');
  assert.ok(!tgMsg.includes('تومان'), 'Signal Telegram message must not contain Toman equivalents');
  assert.ok(tgMsg.includes('لینک یکتای گیت‌هاب:'));

  // Verify every Telegram message gets a strictly unique GitHub deep-link URL
  const url1 = tgMsg.match(/https?:\/\/[^\s]+/)?.[0];
  const url2 = tgMsg2.match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(url1 && url2, 'Both Telegram messages must contain valid URLs');
  assert.notEqual(url1, url2, 'Each Telegram message must have a strictly unique link');
  assert.ok(url1.includes('github.io'), 'Unique link must be a GitHub link');
  assert.ok(!url1.includes('.run.app'), 'Unique link must never be a .run.app preview link');
  assert.ok(url1.includes('msg=QP-SIGNAL-'), 'Unique link must include msg=QP-SIGNAL- identifier');
  assert.ok(url1.includes(`signal=${signals[0].id}`), 'Unique link must deep-link to the signal ID');

  // Verify formatForTelegramApiHtml adds HTML bolding and clickable anchor tag for Telegram API
  const htmlMsg = formatForTelegramApiHtml(tgMsg);
  assert.ok(htmlMsg.includes('<b>'));
  assert.ok(htmlMsg.includes('<a href="'));

  // Verify automatic GitHub Pages URL resolution when running in GitHub Actions (GITHUB_REPOSITORY)
  const prevRepo = process.env.GITHUB_REPOSITORY;
  const prevAppUrl = process.env.APP_URL;
  process.env.GITHUB_REPOSITORY = 'NimaEskandari/quantpulse-bot';
  delete process.env.APP_URL;
  const ghPagesLink = resolveDailyDashboardLink();
  assert.ok(
    ghPagesLink.startsWith('https://nimaeskandari.github.io/quantpulse-bot/?report='),
    `Expected GitHub Pages URL, got ${ghPagesLink}`
  );
  if (prevRepo !== undefined) process.env.GITHUB_REPOSITORY = prevRepo;
  else delete process.env.GITHUB_REPOSITORY;
  if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
});

