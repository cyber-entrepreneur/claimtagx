import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { assertIsolatedCrmDatabase, closeIsolatedHttpServer } from "./isolatedCrmDatabase.ts";

function requireIsolatedDb() {
  assertIsolatedCrmDatabase("omnichannel fixture tests");
}

function metaSig(secret: string, raw: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function xSig(secret: string, raw: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("base64")}`;
}

async function listenApp(): Promise<{ server: Server; base: string }> {
  process.env.CRM_HTTP_TEST_AUTH = "true";
  process.env.NODE_ENV = "development";
  const { default: app } = await import("../../app.ts");
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

async function waitForMessage(providerMessageId: string, timeoutMs = 8_000) {
  const { db, crmMessagesTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db.select().from(crmMessagesTable).where(eq(crmMessagesTable.providerMessageId, providerMessageId));
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

describe("signed connector fixtures to inbox", () => {
  it("accepts WhatsApp, Messenger, Instagram, and X fixtures, dedupes, rejects bad signatures, quarantines malformed, and never mints LIVE", async () => {
    requireIsolatedDb();
    const origFetch = globalThis.fetch;
    const outbound: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      outbound.push(String(input));
      throw new Error(`unexpected outbound network ${String(input)}`);
    }) as typeof fetch;
    process.env.WHATSAPP_APP_SECRET = "wa-fixture-secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "wa-verify";
    process.env.META_APP_SECRET = "meta-fixture-secret";
    process.env.META_VERIFY_TOKEN = "meta-verify";
    process.env.X_CONSUMER_SECRET = "x-fixture-secret";
    process.env.CRM_CHANNEL_SIMULATOR = "true";
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const suffix = randomUUID().slice(0, 8);
    const { server, base } = await listenApp();
    try {
      const postLocal = async (path: string, body: unknown, headers: Record<string, string>) => {
        const raw = JSON.stringify(body);
        return origFetch(`${base}/api${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: raw,
        });
      };

      const waBody = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "cloud-api" },
                  messages: [{ id: `wamid.fix.${suffix}`, from: "15550001111", type: "text", text: { body: "wa fixture" } }],
                },
              },
            ],
          },
        ],
      };
      const waRaw = JSON.stringify(waBody);
      const wa1 = await postLocal("/contact/webhooks/whatsapp", waBody, {
        "x-hub-signature-256": metaSig("wa-fixture-secret", waRaw),
      });
      assert.equal(wa1.status, 202);
      const waDup = await postLocal("/contact/webhooks/whatsapp", waBody, {
        "x-hub-signature-256": metaSig("wa-fixture-secret", waRaw),
      });
      assert.equal(waDup.status, 202);
      const waRows = await waitForMessage(`wamid.fix.${suffix}`);
      assert.equal(waRows.length, 1);

      const bad = await postLocal("/contact/webhooks/whatsapp", waBody, {
        "x-hub-signature-256": metaSig("wrong", waRaw),
      });
      assert.equal(bad.status, 401);

      const msBody = {
        object: "page",
        entry: [
          {
            id: "page-1",
            messaging: [
              {
                sender: { id: `psid-${suffix}` },
                recipient: { id: "page-1" },
                timestamp: Date.now(),
                message: { mid: `mid.fix.${suffix}`, text: "messenger fixture" },
              },
            ],
          },
        ],
      };
      const msRaw = JSON.stringify(msBody);
      const ms = await postLocal("/contact/webhooks/meta", msBody, {
        "x-hub-signature-256": metaSig("meta-fixture-secret", msRaw),
      });
      assert.equal(ms.status, 202);
      assert.equal((await waitForMessage(`mid.fix.${suffix}`)).length, 1);

      const igBody = {
        object: "instagram",
        entry: [
          {
            id: "ig-1",
            messaging: [
              {
                sender: { id: `igid-${suffix}` },
                recipient: { id: "ig-1" },
                timestamp: Date.now(),
                message: { mid: `igmid.fix.${suffix}`, text: "instagram fixture" },
              },
            ],
          },
        ],
      };
      const igRaw = JSON.stringify(igBody);
      const ig = await postLocal("/contact/webhooks/meta", igBody, {
        "x-hub-signature-256": metaSig("meta-fixture-secret", igRaw),
      });
      assert.equal(ig.status, 202);
      assert.equal((await waitForMessage(`igmid.fix.${suffix}`)).length, 1);

      const xBody = {
        for_user_id: "acct",
        direct_message_events: [
          {
            id: `dm-fix-${suffix}`,
            type: "message_create",
            message_create: {
              sender_id: `user-${suffix}`,
              target: { recipient_id: "acct" },
              message_data: { text: "x fixture" },
            },
          },
        ],
      };
      const xRaw = JSON.stringify(xBody);
      const xRes = await postLocal("/contact/webhooks/x", xBody, {
        "x-twitter-webhooks-signature": xSig("x-fixture-secret", xRaw),
      });
      assert.equal(xRes.status, 202);
      assert.equal((await waitForMessage(`dm-fix-${suffix}`)).length, 1);

      const malformed = { object: "whatsapp_business_account", entry: [] };
      const malRaw = JSON.stringify(malformed);
      const mal = await postLocal("/contact/webhooks/whatsapp", malformed, {
        "x-hub-signature-256": metaSig("wa-fixture-secret", malRaw),
      });
      assert.equal(mal.status, 202);
      const { db, crmEmailQuarantineTable, crmWebhookReceiptsTable, crmChannelAccountsTable } = await import("@workspace/db");
      const start = Date.now();
      let quarantined = 0;
      while (Date.now() - start < 8_000) {
        const q = await db.select().from(crmEmailQuarantineTable);
        quarantined = q.filter((row) => JSON.stringify(row.payload ?? {}).includes("whatsapp")).length;
        if (quarantined >= 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(quarantined >= 1);
      const receipts = await db.select().from(crmWebhookReceiptsTable);
      assert.ok(receipts.some((row) => row.status === "quarantined"));

      const { listChannelHealth } = await import("./connectors/health.ts");
      const health = await listChannelHealth();
      assert.equal(health.every((row) => row.status !== "LIVE_VERIFIED" && row.live === false), true);
      const accounts = await db.select().from(crmChannelAccountsTable);
      assert.equal(
        accounts.filter((row) => !String(row.providerAccountId).startsWith("integrity-")).every((row) => row.liveVerifiedAt == null),
        true,
      );
      assert.equal(outbound.length, 0);
    } finally {
      globalThis.fetch = origFetch;
      await closeIsolatedHttpServer(server);
    }
  });

  it("credentials, fixtures, and simulators cannot set live_verified_at; only classified real-provider evidence can; ERROR and credential revoke preserve history", async () => {
    requireIsolatedDb();
    const suffix = randomUUID().slice(0, 8);
    const { db, crmChannelAccountsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { recordChannelActivity, setChannelError, maybeMarkLiveVerified } = await import("./connectors/statusEvidence.ts");
    const { listChannelHealth } = await import("./connectors/health.ts");
    const [account] = await db
      .insert(crmChannelAccountsTable)
      .values({
        channel: "whatsapp",
        providerAccountId: `integrity-${suffix}`,
        displayName: "Integrity WA",
        connectionStatus: "IMPLEMENTED_AWAITING_CREDENTIALS",
        capabilities: {},
        enabled: true,
        missingRequirements: [],
      })
      .returning();
    assert.ok(account);
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    process.env.CRM_CHANNEL_SIMULATOR = "true";
    await recordChannelActivity(db, account.id, "inbound", null, "fixture");
    await recordChannelActivity(db, account.id, "outbound", null, "simulator");
    let [row] = await db.select().from(crmChannelAccountsTable).where(eq(crmChannelAccountsTable.id, account.id));
    assert.equal(row?.liveVerifiedAt, null);
    assert.notEqual(row?.connectionStatus, "LIVE_VERIFIED");

    delete process.env.CRM_ALLOW_TEST_JOBS;
    delete process.env.CRM_CHANNEL_SIMULATOR;
    delete process.env.CRM_EMAIL_SIMULATOR;
    delete process.env.CRM_GRAPH_SIMULATOR;
    await recordChannelActivity(db, account.id, "inbound", null, "fixture");
    await recordChannelActivity(db, account.id, "outbound", null, "fixture");
    [row] = await db.select().from(crmChannelAccountsTable).where(eq(crmChannelAccountsTable.id, account.id));
    assert.equal(row?.liveVerifiedAt, null);

    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_APP_SECRET = "sec";
    process.env.WHATSAPP_VERIFY_TOKEN = "ver";
    await maybeMarkLiveVerified(db, account.id);
    [row] = await db.select().from(crmChannelAccountsTable).where(eq(crmChannelAccountsTable.id, account.id));
    assert.equal(row?.liveVerifiedAt, null, "credentials alone must not mint live");

    await recordChannelActivity(db, account.id, "inbound", null, "real_provider");
    await recordChannelActivity(db, account.id, "outbound", null, "real_provider");
    [row] = await db.select().from(crmChannelAccountsTable).where(eq(crmChannelAccountsTable.id, account.id));
    assert.ok(row?.liveVerifiedAt);
    const stamped = row!.liveVerifiedAt;
    const evidence = row!.verificationEvidence;

    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const healthAfterClear = await listChannelHealth();
    const wa = healthAfterClear.find((h) => h.channel === "whatsapp");
    assert.ok(wa);
    assert.notEqual(wa.status, "LIVE_VERIFIED");
    [row] = await db.select().from(crmChannelAccountsTable).where(eq(crmChannelAccountsTable.id, account.id));
    assert.equal(row?.liveVerifiedAt?.toISOString(), stamped?.toISOString());
    assert.deepEqual(row?.verificationEvidence, evidence);

    await setChannelError(account.id, "simulated provider outage");
    [row] = await db.select().from(crmChannelAccountsTable).where(eq(crmChannelAccountsTable.id, account.id));
    assert.equal(row?.connectionStatus, "ERROR");
    assert.equal(row?.lastError, "simulated provider outage");
    assert.equal(row?.liveVerifiedAt?.toISOString(), stamped?.toISOString());
  });

  it("drains a unique test job and recovers after simulated failure", async () => {
    requireIsolatedDb();
    process.env.CRM_ALLOW_TEST_JOBS = "true";
    const jobs = await import("./jobs.ts");
    const { db, crmJobsTable } = await import("@workspace/db");
    const { eq, sql } = await import("drizzle-orm");
    const key = `drain-${randomUUID()}`;
    const [inserted] = await db
      .insert(crmJobsTable)
      .values({
        type: "__test_fail_until",
        payload: { succeedOnAttempt: 2 },
        status: "pending",
        runAt: new Date(),
        idempotencyKey: key,
        maxAttempts: 8,
      })
      .returning();
    assert.ok(inserted);
    async function claimAndRun(workerId: string) {
      const [updated] = await db
        .update(crmJobsTable)
        .set({
          status: "running",
          lockedBy: workerId,
          lockedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          claimGeneration: sql`${crmJobsTable.claimGeneration} + 1`,
          attempts: sql`${crmJobsTable.attempts} + 1`,
        })
        .where(eq(crmJobsTable.id, inserted.id))
        .returning();
      assert.ok(updated);
      await jobs.executeClaimedCrmJob(
        {
          id: updated.id,
          type: updated.type,
          payload: updated.payload as Record<string, unknown>,
          correlationId: updated.correlationId,
          claimGeneration: updated.claimGeneration,
          attempts: updated.attempts,
          maxAttempts: updated.maxAttempts,
        },
        workerId,
      );
    }
    await claimAndRun("drain-1");
    await claimAndRun("drain-2");
    const [done] = await db.select().from(crmJobsTable).where(eq(crmJobsTable.idempotencyKey, key)).limit(1);
    assert.equal(done?.status, "completed");
  });
});
