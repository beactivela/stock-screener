#!/usr/bin/env node
/**
 * Validates Ollama Cloud OpenAI-compatible chat from your machine (same path as server/llm → localhost dev).
 * Does not print API keys. Run: node scripts/verify-ollama-cloud.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const {
  generateLlmReply,
  resolveOllamaOpenAiBaseUrl,
  DEFAULT_EXPERTS_OLLAMA_MODEL,
} = await import('../server/llm/index.js');

async function main() {
  if (!process.env.OLLAMA_API_KEY?.trim()) {
    console.error('FAIL: OLLAMA_API_KEY is not set in .env (required for Ollama Cloud).');
    process.exit(1);
  }

  const baseURL = resolveOllamaOpenAiBaseUrl();
  const model = process.env.EXPERTS_INSIGHTS_MODEL?.trim() || DEFAULT_EXPERTS_OLLAMA_MODEL;

  console.log('Ollama OpenAI base URL:', baseURL);
  console.log('Model:', model);
  console.log('OLLAMA_API_KEY:', '[set]');
  console.log('Calling chat.completions (one short message)…\n');

  try {
    const text = await generateLlmReply({
      provider: 'ollama',
      model,
      system: 'You reply briefly.',
      messages: [{ role: 'user', content: 'Say only: pong' }],
      maxTokens: 32,
      temperature: 0,
      reasoningFallback: false,
    });

    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed === 'No response.') {
      console.error('FAIL: Empty or "No response." from API.');
      process.exit(1);
    }

    console.log('Assistant reply:', trimmed.slice(0, 500));
    console.log('\nOK — Ollama Cloud responded; your app can use this from localhost when the API server loads the same .env.');
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', e instanceof Error ? e.message : String(e));
    console.error(
      '\nHints: confirm key at https://ollama.com/settings/keys · set OLLAMA_BASE_URL if your OpenAI-compat URL differs (e.g. https://ollama.com/v1) · pull/run the cloud model name in Ollama if required.'
    );
    process.exit(1);
  }
}

main();
