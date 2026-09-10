import type { EpochMillis } from "./clock.js";

/**
 * Domain events let the core signal outward (audit log, SIEM, analytics,
 * anomaly detection) without knowing who listens. Security-sensitive by nature,
 * so payloads carry ids and codes — never secrets, passwords, tokens, or codes.
 */

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly type: TType;
  readonly occurredAt: EpochMillis;
  readonly payload: TPayload;
}

export interface EventPublisher {
  publish(event: DomainEvent): void | Promise<void>;
}

export const domainEvent = <TType extends string, TPayload>(
  type: TType,
  occurredAt: EpochMillis,
  payload: TPayload,
): DomainEvent<TType, TPayload> => ({ type, occurredAt, payload });
