import test from 'node:test'
import assert from 'node:assert/strict'

import { getBreadthTrendRatingFromAngle, getBreadthTrendRatingFromRecentMa50 } from './breadthTrendRating.js'

test('getBreadthTrendRatingFromAngle maps strong bullish at >= 20', () => {
  assert.equal(getBreadthTrendRatingFromAngle(20).score, 7)
  assert.equal(getBreadthTrendRatingFromAngle(27).label, 'Strong Bullish')
})

test('getBreadthTrendRatingFromAngle maps bullish at >= 10 and < 20', () => {
  assert.equal(getBreadthTrendRatingFromAngle(10).score, 6)
  assert.equal(getBreadthTrendRatingFromAngle(19.99).label, 'Bullish')
})

test('getBreadthTrendRatingFromAngle maps neutral positive at >= 5 and < 10', () => {
  assert.equal(getBreadthTrendRatingFromAngle(5).score, 5)
  assert.equal(getBreadthTrendRatingFromAngle(9.9).label, 'Neutral Positive')
})

test('getBreadthTrendRatingFromAngle maps neutral between -2 and < 5', () => {
  assert.equal(getBreadthTrendRatingFromAngle(0).score, 4)
  assert.equal(getBreadthTrendRatingFromAngle(4.9).label, 'Neutral')
  assert.equal(getBreadthTrendRatingFromAngle(-1.99).label, 'Neutral')
})

test('getBreadthTrendRatingFromAngle maps neutral negative at >= -10 and <= -2', () => {
  assert.equal(getBreadthTrendRatingFromAngle(-2).score, 3)
  assert.equal(getBreadthTrendRatingFromAngle(-9.9).label, 'Neutral Negative')
})

test('getBreadthTrendRatingFromAngle maps negative at >= -20 and < -10', () => {
  assert.equal(getBreadthTrendRatingFromAngle(-10.01).score, 2)
  assert.equal(getBreadthTrendRatingFromAngle(-19.5).label, 'Negative')
})

test('getBreadthTrendRatingFromAngle maps strong negative below -20', () => {
  assert.equal(getBreadthTrendRatingFromAngle(-20.01).score, 1)
  assert.equal(getBreadthTrendRatingFromAngle(-30).label, 'Strong Negative')
})

test('getBreadthTrendRatingFromRecentMa50 returns neutral fallback for insufficient data', () => {
  const result = getBreadthTrendRatingFromRecentMa50([100])
  assert.equal(result.score, 4)
  assert.equal(result.label, 'Neutral')
})

test('getBreadthTrendRatingFromRecentMa50 computes score from trend angle', () => {
  const strongUp = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118]
  const strongDown = [118, 116, 114, 112, 110, 108, 106, 104, 102, 100]

  assert.equal(getBreadthTrendRatingFromRecentMa50(strongUp).score, 7)
  assert.equal(getBreadthTrendRatingFromRecentMa50(strongDown).score, 1)
})
