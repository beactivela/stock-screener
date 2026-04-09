#!/usr/bin/env node
/**
 * Copy `ai-hedge-fund/.env` from `.env.example`, then overlay LLM keys from the
 * repo root `.env` when the same variable names exist (no values printed).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const parentEnv = path.join(root, '.env')
const childRoot = path.join(root, 'ai-hedge-fund')
const example = path.join(childRoot, '.env.example')
const target = path.join(childRoot, '.env')

if (!fs.existsSync(example)) {
  console.error('Missing ai-hedge-fund/.env.example — clone https://github.com/virattt/ai-hedge-fund first.')
  process.exit(1)
}

if (!fs.existsSync(target)) {
  fs.copyFileSync(example, target)
}

const keysToSync = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
  'STOCK_SCREENER_API_BASE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
])

function parseEnv(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    map.set(k, t.slice(i + 1).trim())
  }
  return map
}

let parent = new Map()
if (fs.existsSync(parentEnv)) {
  parent = parseEnv(fs.readFileSync(parentEnv, 'utf8'))
}

const lines = fs.readFileSync(target, 'utf8').split('\n')
const out = lines.map((line) => {
  const t = line.trim()
  if (!t || t.startsWith('#')) return line
  const i = t.indexOf('=')
  if (i === -1) return line
  const k = t.slice(0, i).trim()
  if (keysToSync.has(k) && parent.has(k)) {
    return `${k}=${parent.get(k)}`
  }
  return line
})

fs.writeFileSync(target, out.join('\n').replace(/\n*$/, '\n'))
console.log('Updated ai-hedge-fund/.env (merged keys from root .env where applicable).')
