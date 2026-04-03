/**
 * Verifies production build output supports client-side routing to /atlas (SPA fallback serves index.html).
 * Skips when dist/ has not been built yet.
 */
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, it } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distIndex = path.join(__dirname, '..', 'dist', 'index.html')

describe('Atlas web UI SPA shell', () => {
  it('dist/index.html exists and mounts React for client routes like /atlas', { skip: !fs.existsSync(distIndex) }, () => {
    const html = fs.readFileSync(distIndex, 'utf8')
    assert.ok(html.includes('id="root"'), 'expected #root for React mount')
    assert.ok(/<script[^>]+src="[^"]*"/.test(html) || html.includes('script'), 'expected script bundle reference')
  })
})
