import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubRepo, normalizeDeployedSha } from './deployRemote.js';

describe('parseGithubRepo', () => {
  it('parses owner/repo', () => {
    assert.deepEqual(parseGithubRepo('octo/Stock-Screener'), { owner: 'octo', repo: 'Stock-Screener' });
  });

  it('strips .git suffix', () => {
    assert.deepEqual(parseGithubRepo('octo/app.git'), { owner: 'octo', repo: 'app' });
  });

  it('returns null for invalid', () => {
    assert.equal(parseGithubRepo(''), null);
    assert.equal(parseGithubRepo('nope'), null);
    assert.equal(parseGithubRepo(null), null);
  });
});

describe('normalizeDeployedSha', () => {
  it('shortens long sha', () => {
    assert.equal(normalizeDeployedSha('abcdef1234567890'), 'abcdef12');
  });

  it('passes through short', () => {
    assert.equal(normalizeDeployedSha('abc'), 'abc');
  });
});
