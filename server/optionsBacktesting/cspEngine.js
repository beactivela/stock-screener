import { getBars } from '../db/bars.js'
import { deriveIvProxy } from './volatility.js'
import { selectStrikeForTargetDelta } from './strikeSelection.js'
import { applySlippageToMid, estimateOptionBidAskSpread, markShortPut } from './pricing.js'
import { computeSetupMetrics } from './metrics.js'

const INITIAL_CAPITAL_USD = 100000
const LOOKBACK_BARS_FOR_IV = 60
const ENTRY_FILL_AGGRESSIVENESS = 0.85
const EXIT_FILL_AGGRESSIVENESS = 0.85
const STOP_LOSS_MAX_LOSS_MULTIPLE_OF_CREDIT = 2
const MAX_CONCURRENT_POSITIONS = 10

function dateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function isMonday(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 1
}

function diffCalendarDays(fromDate, toDate) {
  const a = new Date(`${fromDate}T12:00:00Z`)
  const b = new Date(`${toDate}T12:00:00Z`)
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)))
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function dedupeBarsByDay(bars = []) {
  const byDate = new Map()
  for (const bar of bars) {
    const day = dateOnly(bar?.t)
    if (!day) continue
    byDate.set(day, bar)
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t)
}

function recordClosedTrade({
  trades,
  position,
  currentDate,
  remainingDte,
  exitPremium,
  exitMidPremium,
  exitReason,
}) {
  const pnlUsd = round2((position.premiumOpen - exitPremium) * 100)
  const daysHeld = Math.max(1, diffCalendarDays(position.entryDate, currentDate))
  const returnPct = round2((pnlUsd / position.collateralUsd) * 100)
  const annualizedRoyPct = round2((returnPct * 365) / daysHeld)
  trades.push({
    ticker: position.ticker,
    entryDate: position.entryDate,
    exitDate: currentDate,
    strike: round2(position.strike),
    entryDte: position.entryDte,
    exitDte: remainingDte,
    targetDelta: position.targetDelta,
    premiumOpen: round2(position.premiumOpen),
    premiumOpenMid: round2(position.premiumOpenMid),
    premiumClose: round2(exitPremium),
    premiumCloseMid: round2(exitMidPremium),
    collateralUsd: round2(position.collateralUsd),
    exitReason,
    assigned: exitPremium > 0 && remainingDte <= 21,
    pnlUsd,
    returnPct,
    annualizedRoyPct,
    daysHeld,
  })
  return pnlUsd
}

function buildCurrentMark(position, bar, recentBars) {
  const currentDate = dateOnly(bar.t)
  const elapsedDays = diffCalendarDays(position.entryDate, currentDate)
  const remainingDte = Math.max(0, position.entryDte - elapsedDays)
  const yearsToExpiry = Math.max(remainingDte, 0) / 365
  const volatility = deriveIvProxy({
    recentBars,
    targetDelta: position.targetDelta,
    entryDte: remainingDte,
    spot: bar.c,
    strike: position.strike,
  })
  const modeled = markShortPut({
    spot: bar.c,
    strike: position.strike,
    yearsToExpiry,
    volatility,
  })
  return {
    currentDate,
    remainingDte,
    volatility,
    midPremium: Math.max(modeled.price ?? 0, Math.max(position.strike - bar.c, 0)),
    deltaAbs: Math.abs(modeled.delta ?? position.targetDelta),
  }
}

export async function runCashSecuredPutBacktest(request, deps = {}) {
  const barsReader = deps.getBars || getBars
  const {
    ticker,
    deltaTargets,
    dteTargets,
    profitTargetPct,
    closeDte,
    startDate,
    endDate,
  } = request

  const bufferStart = new Date(`${startDate}T12:00:00Z`)
  bufferStart.setUTCDate(bufferStart.getUTCDate() - 120)
  const rawBars = await barsReader(ticker, bufferStart.toISOString().slice(0, 10), endDate, '1d')
  const bars = dedupeBarsByDay(rawBars)
  if (!Array.isArray(bars) || bars.length < 90) {
    throw new Error(`Insufficient history for ${ticker}. Need at least 90 daily bars.`)
  }

  const inRangeBars = bars.filter((bar) => dateOnly(bar.t) >= startDate && dateOnly(bar.t) <= endDate)
  if (inRangeBars.length < 30) {
    throw new Error(`Insufficient in-range history for ${ticker}.`)
  }

  const warnings = []
  const setups = []
  const sourceIndexByTime = new Map(bars.map((candidate, index) => [candidate.t, index]))
  for (const deltaTarget of deltaTargets) {
    for (const entryDte of dteTargets) {
      const setupId = `${ticker}-${deltaTarget}-${entryDte}-${profitTargetPct}`
      const trades = []
      const equityCurve = []
      let realizedPnl = 0
      let positions = []
      let positionSequence = 0
      let insufficientCapitalWarningIssued = false
      let lastBar = null
      let lastRecentBars = []

      for (const bar of inRangeBars) {
        const currentDate = dateOnly(bar.t)
        const sourceIndex = sourceIndexByTime.get(bar.t) ?? -1
        const recentBars = bars.slice(Math.max(0, sourceIndex - LOOKBACK_BARS_FOR_IV), sourceIndex + 1)
        lastBar = bar
        lastRecentBars = recentBars

        let unrealizedPnl = 0
        const activePositions = []
        for (const position of positions) {
          const currentMark = buildCurrentMark(position, bar, recentBars)
          const intrinsic = Math.max(position.strike - bar.c, 0)
          const currentSpread = estimateOptionBidAskSpread({
            midPrice: currentMark.midPremium,
            yearsToExpiry: Math.max(currentMark.remainingDte, 1) / 365,
            volatility: currentMark.volatility,
            deltaAbs: currentMark.deltaAbs,
          })
          const exitFillPremium = applySlippageToMid({
            midPrice: currentMark.midPremium,
            spread: currentSpread,
            side: 'buy_to_close',
            aggressiveness: EXIT_FILL_AGGRESSIVENESS,
            floorPrice: intrinsic,
          })
          const stopTriggerPremium = round2(
            position.premiumOpen * (1 + STOP_LOSS_MAX_LOSS_MULTIPLE_OF_CREDIT)
          )
          const hitStopLoss = exitFillPremium >= stopTriggerPremium
          const effectiveExitPremium = hitStopLoss ? stopTriggerPremium : exitFillPremium
          const currentUnrealizedPnl = (position.premiumOpen - effectiveExitPremium) * 100
          const targetPremium = position.premiumOpen * (1 - profitTargetPct / 100)
          const hitProfitTarget = effectiveExitPremium <= targetPremium
          const mustClose = currentMark.remainingDte <= closeDte
          if (hitProfitTarget || hitStopLoss || mustClose) {
            const pnlUsd = recordClosedTrade({
              trades,
              position: { ...position, ticker },
              currentDate,
              remainingDte: currentMark.remainingDte,
              exitPremium: effectiveExitPremium,
              exitMidPremium: currentMark.midPremium,
              exitReason: hitProfitTarget
                ? `profit_target_${profitTargetPct}`
                : hitStopLoss
                  ? `stop_loss_${STOP_LOSS_MAX_LOSS_MULTIPLE_OF_CREDIT}x_credit_loss`
                  : 'close_at_21_dte',
            })
            realizedPnl += pnlUsd
          } else {
            activePositions.push(position)
            unrealizedPnl += currentUnrealizedPnl
          }
        }
        positions = activePositions

        if (isMonday(currentDate) && positions.length < MAX_CONCURRENT_POSITIONS) {
          try {
            const volatility = deriveIvProxy({
              recentBars,
              targetDelta: deltaTarget,
              entryDte,
              spot: bar.c,
            })
            const selected = selectStrikeForTargetDelta({
              spot: bar.c,
              targetDelta: deltaTarget,
              entryDte,
              volatility,
            })
            const collateralUsd = selected.strike * 100
            const reservedCollateralUsd = positions.reduce((sum, position) => sum + round2(position.collateralUsd), 0)
            const availableCollateralUsd = INITIAL_CAPITAL_USD - reservedCollateralUsd
            if (collateralUsd <= availableCollateralUsd) {
              const entryMidPremium = selected.premium
              const yearsToExpiry = Math.max(entryDte, 1) / 365
              const entrySpread = estimateOptionBidAskSpread({
                midPrice: entryMidPremium,
                yearsToExpiry,
                volatility,
                deltaAbs: Math.abs(selected.delta ?? deltaTarget),
              })
              const intrinsic = Math.max(selected.strike - bar.c, 0)
              const premiumOpen = applySlippageToMid({
                midPrice: entryMidPremium,
                spread: entrySpread,
                side: 'sell_to_open',
                aggressiveness: ENTRY_FILL_AGGRESSIVENESS,
                floorPrice: intrinsic,
              })
              positionSequence += 1
              positions.push({
                id: `${setupId}-${positionSequence}`,
                entryDate: currentDate,
                entrySpot: bar.c,
                entryDte,
                strike: selected.strike,
                targetDelta: deltaTarget,
                premiumOpen: round2(premiumOpen),
                premiumOpenMid: round2(entryMidPremium),
                entrySpread: round2(entrySpread),
                volatilityOpen: volatility,
                collateralUsd,
              })
            } else if (!insufficientCapitalWarningIssued) {
              warnings.push(
                `${ticker} ${(deltaTarget * 100).toFixed(0)} delta / ${entryDte} DTE could not fully build the ${MAX_CONCURRENT_POSITIONS}-slot Monday ladder under full cash-secured collateral with $${INITIAL_CAPITAL_USD.toLocaleString()}.`
              )
              insufficientCapitalWarningIssued = true
            }
          } catch (error) {
            warnings.push(error?.message || `Could not open modeled position for ${ticker}`)
          }
        }

        equityCurve.push({
          time: currentDate,
          equity: round2(INITIAL_CAPITAL_USD + realizedPnl + unrealizedPnl),
        })
      }

      if (positions.length > 0 && lastBar) {
        for (const position of positions) {
          const currentMark = buildCurrentMark(position, lastBar, lastRecentBars)
          const intrinsic = Math.max(position.strike - lastBar.c, 0)
          const currentSpread = estimateOptionBidAskSpread({
            midPrice: currentMark.midPremium,
            yearsToExpiry: Math.max(currentMark.remainingDte, 1) / 365,
            volatility: currentMark.volatility,
            deltaAbs: currentMark.deltaAbs,
          })
          const exitFillPremium = applySlippageToMid({
            midPrice: currentMark.midPremium,
            spread: currentSpread,
            side: 'buy_to_close',
            aggressiveness: EXIT_FILL_AGGRESSIVENESS,
            floorPrice: intrinsic,
          })
          realizedPnl += recordClosedTrade({
            trades,
            position: { ...position, ticker },
            currentDate: dateOnly(lastBar.t),
            remainingDte: currentMark.remainingDte,
            exitPremium: exitFillPremium,
            exitMidPremium: currentMark.midPremium,
            exitReason: 'end_of_backtest',
          })
        }
        positions = []
        if (equityCurve.length > 0) {
          equityCurve[equityCurve.length - 1] = {
            time: dateOnly(lastBar.t),
            equity: round2(INITIAL_CAPITAL_USD + realizedPnl),
          }
        }
      }

      const metrics = computeSetupMetrics({
        trades,
        equityCurve,
        initialCapital: INITIAL_CAPITAL_USD,
      })
      setups.push({
        id: setupId,
        ticker,
        strategy: 'cash_secured_put',
        deltaTarget,
        entryDte,
        profitTargetPct,
        closeDte,
        initialCapitalUsd: INITIAL_CAPITAL_USD,
        metrics,
        equityCurve,
        trades,
      })
    }
  }

  setups.sort((a, b) => {
    const sharpeDiff = (b.metrics?.sharpe ?? 0) - (a.metrics?.sharpe ?? 0)
    if (sharpeDiff !== 0) return sharpeDiff
    return (b.metrics?.totalProfitUsd ?? 0) - (a.metrics?.totalProfitUsd ?? 0)
  })
  setups.forEach((setup, index) => {
    setup.rankOrder = index + 1
  })

  return {
    ticker,
    setups,
    assumptions: {
      pricingModel: 'Black-Scholes put marked on daily closes (synthetic option pricing, not historical chains)',
      ivProxyModel: 'Surface proxy from blended realized vol, downside-vol regime premium, spot-level scaling, DTE term uplift, put-skew adjustments, and scheduled stress windows including the August 2024 spike',
      fillModel: 'Estimated end-of-day mid price with modeled bid/ask spread; short entries filled below mid and exits above mid',
      sharpeDefinition: 'Sharpe uses daily equity-curve returns with risk-free rate fixed at 0%',
      returnDefinition: 'CAGR is account-level growth across the priced window; avgTradeAnnualizedRoyPct is the average of simple trade-level annualized ROY values',
      stopLossRule: `Max loss per trade capped at ${STOP_LOSS_MAX_LOSS_MULTIPLE_OF_CREDIT.toFixed(0)}x the opening credit; modeled stop executes at opening credit x ${(1 + STOP_LOSS_MAX_LOSS_MULTIPLE_OF_CREDIT).toFixed(0)} debit`,
      entryCadence: `Sell up to one new put each Monday until the ladder is built, then refill on later Mondays when slots open`,
      maxConcurrentPositions: MAX_CONCURRENT_POSITIONS,
      collateralModel: 'Full cash collateral reserved per CSP at strike x 100',
      marginReferenceExample: 'Reference only: selling 1 QQQ put around 350 DTE may collect about $1,250 premium using about $5,250 in buying-power margin, depending on broker and margin regime',
      marginReferenceWarning: 'This backtest still computes return on fully cash-secured collateral, not broker buying-power reduction or portfolio-margin usage',
      initialCapitalUsd: INITIAL_CAPITAL_USD,
      closeRule: `Always close at ${closeDte} DTE`,
      profitTargetPct,
    },
    warnings,
  }
}
