import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";

function requireIsolatedDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!(url.includes("127.0.0.1:55432") || url.includes("127.0.0.1:55470")) || !/\/claimtagx_crm_[a-z0-9_]+/.test(url)) {
    throw new Error("DSAR execution tests require isolated DATABASE_URL");
  }
}

describe("DSAR correction and deletion execution", () => {
  it("applies correction and blocks deletion under legal hold", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmStaffTable } = await import("@workspace/db");
    const dsar = await import("./dsar.ts");
    const gov = await import("./governance.ts");
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.actor.${suffix}@example.com`,
        emailNormalized: `dsar.actor.${suffix}@example.com`,
        name: "DSAR Actor",
        role: "admin",
        permissions: [],
      })
      .returning();
    assert.ok(actor);
    const actorId = actor.id;
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `dsar.exec.${suffix}@example.com`,
        emailNormalized: `dsar.exec.${suffix}@example.com`,
        firstName: "Before",
        lastName: "Name",
        jobTitle: "Old",
        country: "US",
      })
      .returning();
    assert.ok(contact);
    const correction = await dsar.createDsarRequest({
      contactId: contact.id,
      requestType: "correction",
      actorStaffId: actorId,
    });
    await dsar.transitionDsarRequest({
      id: correction.id,
      status: "identity_pending",
      actorStaffId: actorId,
    });
    await dsar.transitionDsarRequest({
      id: correction.id,
      status: "identity_verified",
      actorStaffId: actorId,
      identityVerified: true,
    });
    await dsar.transitionDsarRequest({
      id: correction.id,
      status: "in_progress",
      actorStaffId: actorId,
    });
    await dsar.applyDsarCorrection({
      id: correction.id,
      actorStaffId: actorId,
      patch: { firstName: "After", jobTitle: "New" },
    });
    const [updated] = await db
      .select()
      .from(crmContactsTable)
      .where(eq(crmContactsTable.id, contact.id))
      .limit(1);
    assert.equal(updated?.firstName, "After");
    assert.equal(updated?.jobTitle, "New");

    const deletion = await dsar.createDsarRequest({
      contactId: contact.id,
      requestType: "deletion",
      actorStaffId: actorId,
    });
    await dsar.transitionDsarRequest({
      id: deletion.id,
      status: "identity_pending",
      actorStaffId: actorId,
    });
    await dsar.transitionDsarRequest({
      id: deletion.id,
      status: "identity_verified",
      actorStaffId: actorId,
      identityVerified: true,
    });
    await dsar.transitionDsarRequest({
      id: deletion.id,
      status: "in_progress",
      actorStaffId: actorId,
    });
    const { crmAttachmentsTable } = await import("@workspace/db");
    const [att] = await db
      .insert(crmAttachmentsTable)
      .values({
        filename: "hold-me.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        storageKey: `hold/${suffix}`,
        sha256: "a".repeat(64),
        contactId: contact.id,
        malwareStatus: "clean",
      })
      .returning();
    assert.ok(att);
    await gov.placeLegalHold({
      contactId: contact.id,
      reason: "litigation hold for DSAR test",
      actorStaffId: actorId,
    });
    await assert.rejects(
      () => dsar.completeDsarDeletion({ id: deletion.id, actorStaffId: actorId }),
      (err: Error & { status?: number }) => err.status === 409 && /Legal hold/.test(err.message),
    );
    await assert.rejects(
      () => gov.anonymizeContact(contact.id, actorId, "should block under hold"),
      (err: Error & { status?: number }) => err.status === 409,
    );
    const [heldAtt] = await db
      .select()
      .from(crmAttachmentsTable)
      .where(eq(crmAttachmentsTable.id, att.id))
      .limit(1);
    assert.equal(heldAtt?.legalHold, true);
  });

  it("completes deletion wipe and objection after hold release", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmStaffTable, crmConsentRecordsTable, crmLegalHoldsTable } =
      await import("@workspace/db");
    const dsar = await import("./dsar.ts");
    const gov = await import("./governance.ts");
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.del.${suffix}@example.com`,
        emailNormalized: `dsar.del.${suffix}@example.com`,
        name: "DSAR Delete Actor",
        role: "admin",
        permissions: [],
      })
      .returning();
    assert.ok(actor);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `dsar.wipe.${suffix}@example.com`,
        emailNormalized: `dsar.wipe.${suffix}@example.com`,
        firstName: "Wipe",
        lastName: "Me",
        jobTitle: "Buyer",
        country: "US",
        phoneRaw: "+12025550100",
        phoneE164: "+12025550100",
      })
      .returning();
    assert.ok(contact);

    const hold = await gov.placeLegalHold({
      contactId: contact.id,
      reason: "temporary hold before wipe",
      actorStaffId: actor.id,
    });
    await gov.releaseLegalHold(hold.id, actor.id);
    const [released] = await db
      .select()
      .from(crmLegalHoldsTable)
      .where(eq(crmLegalHoldsTable.id, hold.id))
      .limit(1);
    assert.ok(released?.releasedAt);

    const deletion = await dsar.createDsarRequest({
      contactId: contact.id,
      requestType: "deletion",
      actorStaffId: actor.id,
    });
    await dsar.transitionDsarRequest({ id: deletion.id, status: "identity_pending", actorStaffId: actor.id });
    await dsar.transitionDsarRequest({
      id: deletion.id,
      status: "identity_verified",
      actorStaffId: actor.id,
      identityVerified: true,
    });
    await dsar.transitionDsarRequest({ id: deletion.id, status: "in_progress", actorStaffId: actor.id });
    await dsar.completeDsarDeletion({ id: deletion.id, actorStaffId: actor.id });
    const [wiped] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, contact.id)).limit(1);
    assert.ok(wiped);
    assert.match(wiped.emailNormalized, /anonymized\.invalid$/);
    assert.equal(wiped.phoneE164, null);
    assert.equal(wiped.firstName, "Anonymized");

    const objectionContact = await db
      .insert(crmContactsTable)
      .values({
        email: `dsar.obj.${suffix}@example.com`,
        emailNormalized: `dsar.obj.${suffix}@example.com`,
        firstName: "Object",
        lastName: "Or",
        jobTitle: "Buyer",
        country: "US",
      })
      .returning();
    const subject = objectionContact[0]!;
    const objection = await dsar.createDsarRequest({
      contactId: subject.id,
      requestType: "objection",
      actorStaffId: actor.id,
    });
    await dsar.transitionDsarRequest({ id: objection.id, status: "identity_pending", actorStaffId: actor.id });
    await dsar.transitionDsarRequest({
      id: objection.id,
      status: "identity_verified",
      actorStaffId: actor.id,
      identityVerified: true,
    });
    await dsar.transitionDsarRequest({ id: objection.id, status: "in_progress", actorStaffId: actor.id });
    await dsar.completeDsarObjection({ id: objection.id, actorStaffId: actor.id, notes: "no marketing" });
    const consents = await db
      .select()
      .from(crmConsentRecordsTable)
      .where(eq(crmConsentRecordsTable.contactId, subject.id));
    assert.ok(consents.some((c) => c.kind === "processing_objection" && c.granted === false));
    const [stillNamed] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, subject.id)).limit(1);
    assert.equal(stillNamed?.firstName, "Object");
  });

  it("completes access/export packages and anonymizes after identity verification", async () => {
    requireIsolatedDb();
    const { ensureCrmSeeded } = await import("./seed.ts");
    await ensureCrmSeeded();
    const { db, crmContactsTable, crmStaffTable } = await import("@workspace/db");
    const dsar = await import("./dsar.ts");
    const gov = await import("./governance.ts");
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.exp.${suffix}@example.com`,
        emailNormalized: `dsar.exp.${suffix}@example.com`,
        name: "DSAR Export Actor",
        role: "admin",
        permissions: [],
      })
      .returning();
    assert.ok(actor);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `dsar.subject.${suffix}@example.com`,
        emailNormalized: `dsar.subject.${suffix}@example.com`,
        firstName: "Subject",
        lastName: "Person",
        jobTitle: "Buyer",
        country: "US",
      })
      .returning();
    assert.ok(contact);

    for (const requestType of ["access", "export"] as const) {
      const req = await dsar.createDsarRequest({
        contactId: contact.id,
        requestType,
        actorStaffId: actor.id,
      });
      await dsar.transitionDsarRequest({ id: req.id, status: "identity_pending", actorStaffId: actor.id });
      await dsar.transitionDsarRequest({
        id: req.id,
        status: "identity_verified",
        actorStaffId: actor.id,
        identityVerified: true,
      });
      await dsar.transitionDsarRequest({ id: req.id, status: "in_progress", actorStaffId: actor.id });
      const pack = await dsar.completeDsarExport({ id: req.id, actorStaffId: actor.id });
      assert.ok(pack);
    }

    await gov.anonymizeContact(contact.id, actor.id, "dsar anonymize local test");
    const [anon] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, contact.id)).limit(1);
    assert.ok(anon);
    assert.notEqual(anon.emailNormalized, `dsar.subject.${suffix}@example.com`);
  });

  it("packages clean attachment bytes and keeps quarantined bytes in the manifest only", async () => {
    requireIsolatedDb();
    const { db, crmContactsTable, crmStaffTable, crmAttachmentsTable } = await import("@workspace/db");
    const gov = await import("./governance.ts");
    const { memoryObjectStore } = await import("./attachmentStore.ts");
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await db
      .insert(crmStaffTable)
      .values({
        email: `dsar.att.${suffix}@example.com`,
        emailNormalized: `dsar.att.${suffix}@example.com`,
        name: "DSAR Attach Actor",
        role: "admin",
        permissions: ["governance.dsar"],
      })
      .returning();
    assert.ok(actor);
    const [contact] = await db
      .insert(crmContactsTable)
      .values({
        email: `dsar.att.subject.${suffix}@example.com`,
        emailNormalized: `dsar.att.subject.${suffix}@example.com`,
        firstName: "Attach",
        lastName: "Subject",
        jobTitle: "Buyer",
        country: "US",
      })
      .returning();
    assert.ok(contact);
    const cleanKey = `dsar-clean-${suffix}.txt`;
    const dirtyKey = `dsar-q-${suffix}.bin`;
    const cleanBytes = new TextEncoder().encode("hello-dsar");
    const cleanHash = createHash("sha256").update(cleanBytes).digest("hex");
    await memoryObjectStore.put(cleanKey, cleanBytes);
    await memoryObjectStore.put(dirtyKey, new TextEncoder().encode("malware-bytes"));
    await db.insert(crmAttachmentsTable).values([
      {
        contactId: contact.id,
        filename: "hello.txt",
        mimeType: "text/plain",
        sizeBytes: cleanBytes.length,
        storageProvider: "memory",
        storageKey: cleanKey,
        sha256: cleanHash,
        malwareStatus: "clean",
      },
      {
        contactId: contact.id,
        filename: "bad.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 13,
        storageProvider: "memory",
        storageKey: dirtyKey,
        sha256: "y",
        malwareStatus: "quarantined",
        malwareReason: "synthetic",
      },
    ]);
    process.env.CRM_ATTACHMENT_STORE = "memory";
    const pack = (await gov.exportDsarPackage(contact.id, actor.id)) as {
      attachments: { manifest: Array<{ filename: string; inclusion: string; bytesIncluded: boolean }>; files: Array<{ filename: string }> };
    };
    const clean = pack.attachments.manifest.find((m) => m.filename === "hello.txt");
    const dirty = pack.attachments.manifest.find((m) => m.filename === "bad.bin");
    assert.equal(clean?.inclusion, "inline_clean");
    assert.equal(clean?.bytesIncluded, true);
    assert.equal(dirty?.inclusion, "quarantine_manifest_only");
    assert.equal(dirty?.bytesIncluded, false);
    assert.equal(pack.attachments.files.some((f) => f.filename === "hello.txt"), true);
    assert.equal(pack.attachments.files.some((f) => f.filename === "bad.bin"), false);
  });
});
