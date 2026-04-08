#!/usr/bin/env node
/**
 * Pings each AI Portfolio manager model via OpenRouter (same stack as server/llm → ollamaManagers).
 * Loads repo `.env`; does not print API keys. Run: node scripts/verify-ai-portfolio-openrouter-models.js
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const { generateLlmReply } = await import('../server/llm/index.js')
const { getManagerModelMap, resolveAiPortfolioLlmProvider } = await import('../server/aiPortfolio/ollamaManagers.js')

async function main() {
  const key = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (!key) {
    console.error('FAIL: OPENROUTER_API_KEY is not set in .env.')
    process.exit(1)
  }

  const provider = resolveAiPortfolioLlmProvider()
  if (provider !== 'openrouter') {
    console.log(`Note: AI_PORTFOLIO_LLM_PROVIDER=${provider} (this script only exercises OpenRouter).`)
  }

  const modelMap = getManagerModelMap()
  const managers = Object.entries(modelMap)

  console.log('OPENROUTER_API_KEY: [set]')
  console.log(`Default AI portfolio provider: ${resolveAiPortfolioLlmProvider()}`)
  console.log('Pinging one token per manager model…\n')

  let failed = false
  for (const [id, model] of managers) {
    process.stdout.write(`  ${id} (${model}) … `)
    try {
      const text = await generateLlmReply({
        provider: 'openrouter',
        model,
        system: 'Reply with a single word only: OK',
        messages: [{ role: 'user', content: 'Word?' }],
        maxTokens: 16,
        temperature: 0,
        reasoningFallback: false,
      })
      const t = String(text || '').trim()
      if (!t || t === 'No response.') {
        console.log('FAIL (empty)')
        failed = true
        continue
      }
      console.log(`OK (${t.slice(0, 40)}${t.length > 40 ? '…' : ''})`)
    } catch (e) {
      console.log('FAIL')
      console.error(`    → ${e instanceof Error ? e.message : String(e)}`)
      failed = true
    }
  }

  if (failed) {
    console.error('\nOne or more models failed. Check slugs at https://openrouter.ai/models and AI_PORTFOLIO_MODEL_* in .env.')
    process.exit(1)
  }

  console.log('\nOK — all four manager models responded via OpenRouter with your key.')
  process.exit(0)
}

main()
