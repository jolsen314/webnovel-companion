import { describe, expect, test } from 'vitest';
import {
  step,
  initialHealth,
  FAILURE_WEIGHTS,
  DEGRADED_AT,
  LIKELY_DOWN_AT,
  type HealthState,
  type PollOutcome,
} from '../../src/lib/health';

/** Fold a sequence of poll outcomes through the state machine from a fresh source. */
function run(...outcomes: PollOutcome[]): HealthState {
  return outcomes.reduce(step, initialHealth());
}

describe('source health state machine', () => {
  test('a single soft failure is a blip: stays HEALTHY, but is recorded', () => {
    const s = run('TIMEOUT');

    expect(s.health).toBe('HEALTHY');
    expect(s.consecutiveFailures).toBe(1);
    expect(s.lastFailureType).toBe('TIMEOUT');
  });

  test('sustained soft failures escalate HEALTHY → DEGRADED → LIKELY_DOWN', () => {
    expect(run('TIMEOUT', 'TIMEOUT').health).toBe('DEGRADED');
    expect(run('TIMEOUT', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT').health).toBe('LIKELY_DOWN');
  });

  // --- property guards (state machine is complete after the escalation test) ---

  test('strong failures weigh more: one DNS already DEGRADED, two DNS LIKELY_DOWN', () => {
    expect(run('DNS').health).toBe('DEGRADED'); // score 3 ≥ DEGRADED, < LIKELY_DOWN
    expect(run('DNS', 'DNS').health).toBe('LIKELY_DOWN'); // score 6
  });

  test('a couple of strong failures escalate faster than many soft ones', () => {
    // After exactly two failures: two strong → down, two soft → only degraded.
    expect(run('DNS', 'PARKED').health).toBe('LIKELY_DOWN');
    expect(run('TIMEOUT', 'HTTP_5XX').health).toBe('DEGRADED');
  });

  test('HTTP 4xx is middling: one → DEGRADED, two → LIKELY_DOWN', () => {
    expect(run('HTTP_4XX').health).toBe('DEGRADED'); // weight 2
    expect(run('HTTP_4XX', 'HTTP_4XX').health).toBe('LIKELY_DOWN'); // 4
  });

  test('a success recovers immediately from LIKELY_DOWN (hysteresis: slow up, instant down)', () => {
    const down = run('DNS', 'DNS');
    expect(down.health).toBe('LIKELY_DOWN');

    const recovered = step(down, 'SUCCESS');
    expect(recovered).toEqual(initialHealth());
  });

  test('no downgrade without a success: once LIKELY_DOWN, further failures stay down', () => {
    const s = run('DNS', 'DNS', 'TIMEOUT');
    expect(s.health).toBe('LIKELY_DOWN');
  });

  test('an intervening success resets the streak, so the next single failure is a blip again', () => {
    const s = run('TIMEOUT', 'TIMEOUT', 'SUCCESS', 'TIMEOUT');
    expect(s.health).toBe('HEALTHY');
    expect(s.consecutiveFailures).toBe(1);
    expect(s.score).toBe(FAILURE_WEIGHTS.TIMEOUT);
  });

  test('weights and thresholds are ordered as designed', () => {
    const { DNS, PARKED, TLS, HTTP_4XX, HTTP_5XX, TIMEOUT } = FAILURE_WEIGHTS;
    expect(Math.min(DNS, PARKED, TLS)).toBeGreaterThan(HTTP_4XX); // strong > middling
    expect(HTTP_4XX).toBeGreaterThan(Math.max(HTTP_5XX, TIMEOUT)); // middling > soft
    expect(LIKELY_DOWN_AT).toBeGreaterThan(DEGRADED_AT);
    expect(DEGRADED_AT).toBeGreaterThan(FAILURE_WEIGHTS.TIMEOUT); // one soft blip stays HEALTHY
  });
});
