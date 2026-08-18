/**
 * Thin HTTP helpers shared by the route handlers, so each one reads as intent rather
 * than plumbing. Pairs with `./validation`: parse the body with `readJson`, run it
 * through a validator, and map either failure to a uniform 400 with `jsonError`.
 */

import { NextResponse } from 'next/server';
import type { ParseResult } from './validation';

/**
 * Read + JSON-parse a request body, mapping a malformed or absent body to the uniform
 * `{ ok: false, error: 'Expected a JSON body.' }` — the same shape a validator returns,
 * so handlers can funnel both into `jsonError`.
 */
export async function readJson(request: Request): Promise<ParseResult<unknown>> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, error: 'Expected a JSON body.' };
  }
}

/** Uniform JSON error response. Defaults to 400 — the common parse/validation case. */
export function jsonError(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}
