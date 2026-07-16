/**
 * Source-health state machine: HEALTHY → DEGRADED → LIKELY_DOWN, with hysteresis.
 *
 * Pure. Each poll produces an outcome (success or a typed failure); `step` folds
 * that into the running state. Failures accumulate a weighted score — strong
 * "the site itself looks gone" signals (DNS/PARKED/TLS) weigh far more than soft
 * transient ones (TIMEOUT/5xx) — so single blips are ignored but sustained or
 * strong failure escalates. A success recovers immediately (that's the hysteresis:
 * slow to escalate, instant to recover). Per-source only; host-level aggregation
 * is WP-16.
 */

export type SourceHealth = 'HEALTHY' | 'DEGRADED' | 'LIKELY_DOWN';
export type FailureType = 'DNS' | 'TLS' | 'PARKED' | 'HTTP_4XX' | 'HTTP_5XX' | 'TIMEOUT';
export type PollOutcome = 'SUCCESS' | FailureType;

export interface HealthState {
  health: SourceHealth;
  consecutiveFailures: number;
  /** Accumulated weighted failure score for the current failure streak (hysteresis accumulator). */
  score: number;
  lastFailureType: FailureType | null;
}

/**
 * How much each failure type counts toward escalation. Strong signals that the
 * site itself is gone/broken weigh most; soft transient errors weigh least.
 */
export const FAILURE_WEIGHTS: Record<FailureType, number> = {
  DNS: 3, // NXDOMAIN — domain no longer resolves
  PARKED: 3, // domain-parking page — site is gone
  TLS: 3, // cert failure — server misconfigured/gone
  HTTP_4XX: 2, // could be removal (404/410) or a transient block
  HTTP_5XX: 1, // server hiccup — usually transient
  TIMEOUT: 1, // network blip — usually transient
};

/** Weighted-score thresholds for each health level (tunable). */
export const DEGRADED_AT = 2;
export const LIKELY_DOWN_AT = 4;

function levelFor(score: number): SourceHealth {
  if (score >= LIKELY_DOWN_AT) return 'LIKELY_DOWN';
  if (score >= DEGRADED_AT) return 'DEGRADED';
  return 'HEALTHY';
}

export function initialHealth(): HealthState {
  return { health: 'HEALTHY', consecutiveFailures: 0, score: 0, lastFailureType: null };
}

export function step(state: HealthState, outcome: PollOutcome): HealthState {
  if (outcome === 'SUCCESS') return initialHealth();
  const score = state.score + FAILURE_WEIGHTS[outcome];
  return {
    health: levelFor(score),
    consecutiveFailures: state.consecutiveFailures + 1,
    score,
    lastFailureType: outcome,
  };
}
