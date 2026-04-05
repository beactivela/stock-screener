import test from 'node:test'
import assert from 'node:assert/strict'
import { abbreviateExpertFirmDisplayName } from './abbreviateExpertFirmDisplayName.ts'

test('abbreviateExpertFirmDisplayName: Management → Mgt', () => {
  assert.equal(abbreviateExpertFirmDisplayName('Point72 Asset Management'), 'Point72 Asset Mgt')
  assert.equal(abbreviateExpertFirmDisplayName('Oaktree Capital Management'), 'Oaktree Capital Mgt')
})

test('abbreviateExpertFirmDisplayName: Family Office → Family', () => {
  assert.equal(
    abbreviateExpertFirmDisplayName('Duquesne Family Office LLC'),
    'Duquesne Family LLC'
  )
})

test('abbreviateExpertFirmDisplayName: leaves other names unchanged', () => {
  assert.equal(abbreviateExpertFirmDisplayName('Tweedy Browne Company LLC'), 'Tweedy Browne Company LLC')
  assert.equal(abbreviateExpertFirmDisplayName(''), '')
})
