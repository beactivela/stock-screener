import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateCronSecret } from './cronSecretAuth.js';

describe('validateCronSecret', () => {
  const keys = ['CRON_SECRET', 'NODE_ENV'];
  const snapshot = {};

  beforeEach(() => {
    for (const k of keys) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  function mockRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        this.body = obj;
        return this;
      },
    };
    return res;
  }

  it('non-production: no CRON_SECRET and no client header allows', () => {
    process.env.NODE_ENV = 'development';
    const req = { headers: {} };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), true);
  });

  it('non-production: CRON_SECRET set but no client header allows (local UI sync without prompt)', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRON_SECRET = 'server-secret';
    const req = { headers: {} };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), true);
  });

  it('non-production: CRON_SECRET set and wrong Bearer rejects', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRON_SECRET = 'server-secret';
    const req = { headers: { authorization: 'Bearer wrong' } };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it('non-production: CRON_SECRET set and correct Bearer allows', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRON_SECRET = 'server-secret';
    const req = { headers: { authorization: 'Bearer server-secret' } };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), true);
  });

  it('non-production: x-cron-secret matches', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRON_SECRET = 'server-secret';
    const req = { headers: { 'x-cron-secret': 'server-secret' } };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), true);
  });

  it('production: missing CRON_SECRET returns 503', () => {
    process.env.NODE_ENV = 'production';
    const req = { headers: { authorization: 'Bearer x' } };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), false);
    assert.equal(res.statusCode, 503);
  });

  it('production: CRON_SECRET set, no client header returns 401', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 's';
    const req = { headers: {} };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it('production: CRON_SECRET set and matching Bearer allows', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'prod-secret';
    const req = { headers: { authorization: 'Bearer prod-secret' } };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res), true);
  });

  it('production: allowMissingSecret + no client header allows (experts UI / Docker)', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'prod-secret';
    const req = { headers: {} };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res, { allowMissingSecret: true }), true);
  });

  it('production: allowMissingSecret + wrong Bearer still rejects', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'prod-secret';
    const req = { headers: { authorization: 'Bearer wrong' } };
    const res = mockRes();
    assert.equal(validateCronSecret(req, res, { allowMissingSecret: true }), false);
    assert.equal(res.statusCode, 401);
  });
});
