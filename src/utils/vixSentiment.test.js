import test from 'node:test'
import assert from 'node:assert/strict'

import { getVixSentimentBand, VIX_SENTIMENT_GUIDE } from './vixSentiment.ts'

test('getVixSentimentBand returns null for null/undefined/NaN', () => {
  assert.equal(getVixSentimentBand(null), null)
  assert.equal(getVixSentimentBand(undefined), null)
  assert.equal(getVixSentimentBand(Number.NaN), null)
})

test('getVixSentimentBand: Low is strictly below 20', () => {
  assert.equal(getVixSentimentBand(19.99)?.band, 'low')
  assert.equal(getVixSentimentBand(19.99)?.label, 'Low')
})

test('getVixSentimentBand: Moderate is 20 through 30 inclusive', () => {
  assert.equal(getVixSentimentBand(20)?.band, 'moderate')
  assert.equal(getVixSentimentBand(26.78)?.band, 'moderate')
  assert.equal(getVixSentimentBand(30)?.band, 'moderate')
})

test('getVixSentimentBand: High is above 30', () => {
  assert.equal(getVixSentimentBand(30.01)?.band, 'high')
  assert.equal(getVixSentimentBand(45)?.label, 'High')
})

test('VIX_SENTIMENT_GUIDE.moderateWithLevel embeds formatted level', () => {
  const s = VIX_SENTIMENT_GUIDE.moderateWithLevel(26.78)
  assert.ok(s.includes('26.78'))
  assert.ok(s.includes('significant market anxiety'))
})
