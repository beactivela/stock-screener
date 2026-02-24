/**
 * Conversation store tests (file fallback only)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import {
  saveConversation,
  loadConversation,
  labelConversation,
} from './conversationStore.js';

describe('conversationStore (file fallback)', () => {
  const tmpDir = path.join(process.cwd(), 'data', 'test-conversations');
  const cleanup = () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  it('saves, loads, and labels a conversation', async () => {
    cleanup();
    const conversation = {
      ticker: 'NVDA',
      regime: 'BULL',
      decision: { action: 'TAKE' },
      transcript: { rounds: [] },
    };
    const saved = await saveConversation(conversation, { forceFile: true, storageDir: tmpDir });
    assert.ok(saved.id);

    const loaded = await loadConversation(saved.id, { forceFile: true, storageDir: tmpDir });
    assert.equal(loaded.ticker, 'NVDA');

    const labeled = await labelConversation(saved.id, { outcome: { rMultiple: 2.1 } }, { forceFile: true, storageDir: tmpDir });
    assert.equal(labeled.outcome.rMultiple, 2.1);
  });
});
