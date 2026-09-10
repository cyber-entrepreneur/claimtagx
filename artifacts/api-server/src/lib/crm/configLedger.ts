import {
  type ConfigChangeEvent,
  type ConfigChangeStatus,
  auditPayloadForTransition,
  buildRollbackSuccessor,
  nextConfigChangeStatus,
} from "./configLifecycle";

export type LedgerChange = {
  id: string;
  entityType: string;
  entityId: string;
  status: ConfigChangeStatus;
  authorStaffId: string;
  reviewerStaffId?: string | null;
  publisherStaffId?: string | null;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
  version: number;
  updatedAt: string;
  rollbackOfId?: string | null;
};

/** In-memory governed config store for atomic publication / bypass tests (no I/O). */
export class ConfigLedger {
  live = new Map<string, { version: number; value: Record<string, unknown> }>();
  changes: LedgerChange[] = [];
  audits: Record<string, unknown>[] = [];
  failNextApply = false;

  draft(input: {
    id: string;
    entityType: string;
    entityId: string;
    authorStaffId: string;
    afterValue: Record<string, unknown>;
  }): LedgerChange {
    const live = this.live.get(`${input.entityType}:${input.entityId}`);
    const row: LedgerChange = {
      ...input,
      status: "draft",
      beforeValue: live?.value ?? null,
      version: (live?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.changes.push(row);
    return row;
  }

  transition(
    id: string,
    event: ConfigChangeEvent,
    ctx: { actorStaffId: string; actorRole: string; permissions?: string[]; expectedUpdatedAt?: string },
  ): LedgerChange {
    const row = this.changes.find((c) => c.id === id);
    if (!row) throw Object.assign(new Error("not found"), { status: 404 });
    const next = nextConfigChangeStatus(row, event, {
      actorStaffId: ctx.actorStaffId,
      actorRole: ctx.actorRole,
      permissions: ctx.permissions,
      expectedUpdatedAt: ctx.expectedUpdatedAt,
      currentUpdatedAt: row.updatedAt,
    });
    if (event === "publish") {
      this.publishAtomic(row, ctx.actorStaffId);
    }
    if (event === "rollback") {
      this.rollbackAsNewVersion(row, ctx.actorStaffId);
      row.status = "rolled_back";
      row.updatedAt = new Date().toISOString();
      return row;
    }
    row.status = next;
    if (event === "approve") row.reviewerStaffId = ctx.actorStaffId;
    if (event === "publish") row.publisherStaffId = ctx.actorStaffId;
    row.updatedAt = new Date().toISOString();
    this.audits.push(
      auditPayloadForTransition({
        action: event,
        actorStaffId: ctx.actorStaffId,
        changeId: row.id,
        fromStatus: row.status,
        toStatus: next,
        beforeVersion: row.version - 1,
        afterVersion: row.version,
      }),
    );
    return row;
  }

  private publishAtomic(row: LedgerChange, actorStaffId: string): void {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error("apply failed");
    }
    const key = `${row.entityType}:${row.entityId}`;
    const prev = this.live.get(key);
    this.live.set(key, { version: row.version, value: { ...row.afterValue } });
    row.publisherStaffId = actorStaffId;
    void prev;
  }

  private rollbackAsNewVersion(row: LedgerChange, actorStaffId: string): LedgerChange {
    if (!row.beforeValue) throw Object.assign(new Error("nothing to restore"), { status: 409 });
    const successorSpec = buildRollbackSuccessor({
      publishedChangeId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      restoredValue: row.beforeValue,
      previousPublishedValue: row.afterValue,
      actorStaffId,
      correlationId: `rollback:${row.id}`,
      nextVersion: row.version + 1,
    });
    const successor: LedgerChange = {
      id: `${row.id}-rollback`,
      entityType: row.entityType,
      entityId: row.entityId,
      status: successorSpec.status,
      authorStaffId: actorStaffId,
      publisherStaffId: actorStaffId,
      beforeValue: successorSpec.beforeValue,
      afterValue: successorSpec.afterValue,
      version: successorSpec.version,
      updatedAt: new Date().toISOString(),
      rollbackOfId: successorSpec.rollbackOfId,
    };
    this.changes.push(successor);
    this.live.set(`${row.entityType}:${row.entityId}`, {
      version: successor.version,
      value: { ...successor.afterValue },
    });
    return successor;
  }
}
