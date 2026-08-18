import { describe, expect, test } from 'vitest';
import { readJson, jsonError } from '../../../src/server/api/http';

describe('readJson', () => {
  test('parses a valid JSON body into { ok: true, value }', async () => {
    const request = new Request('http://x.example/', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://x.example/a' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(await readJson(request)).toEqual({ ok: true, value: { url: 'https://x.example/a' } });
  });

  test('maps a malformed body to the uniform "Expected a JSON body." error', async () => {
    const request = new Request('http://x.example/', { method: 'POST', body: 'not json{' });
    expect(await readJson(request)).toEqual({ ok: false, error: 'Expected a JSON body.' });
  });

  test('maps an empty body to the uniform error', async () => {
    const request = new Request('http://x.example/', { method: 'POST' });
    expect(await readJson(request)).toEqual({ ok: false, error: 'Expected a JSON body.' });
  });
});

describe('jsonError', () => {
  test('defaults to a 400 with an { error } body', async () => {
    const res = jsonError('Bad input.');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad input.' });
  });

  test('honors an explicit status code', async () => {
    const res = jsonError('Nope.', 401);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Nope.' });
  });
});
