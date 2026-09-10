/// <reference types="node" />
import { randomUUID } from "node:crypto";
import type { DomainEvent, EventPublisher } from "../../shared/events.js";
import type { AuthDatabase } from "./database.js";
import { authAuditEvents } from "./schema.js";

export interface AuditEventTables {
  readonly auditEvents: typeof authAuditEvents;
}

export interface PostgresAuditEventWriterOptions {
  readonly tables?: AuditEventTables;
  /** Override id generation (defaults to `crypto.randomUUID`). */
  readonly idFactory?: () => string;
}

const extractAccountId = (payload: unknown): string | null => {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "accountId" in payload &&
    typeof (payload as { accountId: unknown }).accountId === "string"
  ) {
    return (payload as { accountId: string }).accountId;
  }
  return null;
};

/**
 * Durable audit sink: persists every emitted {@link DomainEvent} to
 * `auth_audit_events` as an append-only record. Wire it in as the platform's
 * `EventPublisher` (or fan out to it alongside another publisher) so security
 * events — logins, MFA changes, revocations — land in an immutable trail.
 *
 * Domain events never carry secrets (only ids/codes-by-reference), so the
 * `payload` jsonb is safe to store verbatim.
 */
export class PostgresAuditEventWriter implements EventPublisher {
  private readonly auditEvents: typeof authAuditEvents;
  private readonly idFactory: () => string;

  constructor(
    private readonly db: AuthDatabase,
    options: PostgresAuditEventWriterOptions = {},
  ) {
    this.auditEvents = options.tables?.auditEvents ?? authAuditEvents;
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.db.insert(this.auditEvents).values({
      id: this.idFactory(),
      type: event.type,
      occurredAt: event.occurredAt,
      accountId: extractAccountId(event.payload),
      payload: (event.payload ?? {}) as Record<string, unknown>,
    });
  }
}
