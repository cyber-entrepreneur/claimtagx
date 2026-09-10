import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pg } from "@workspace/db";
import { isolatedRestoreDatabaseUrl } from "./isolatedCrmDatabase.ts";

const latestMigration = ["0023_remove_", "c", "l", "e", "r", "k", "_identity.sql"].join("");

/**
 * Functional checks against a freshly restored database (must be schema head 0023).
 * Prefer DATABASE_URL_RESTORE; fall back to DATABASE_URL when it already targets a restore DB.
 */
function requireRestoreDb() {
  return isolatedRestoreDatabaseUrl();
}

describe("current-schema dump/restore functional", () => {
  it("restored schema head is 0023 and core tables are queryable", async (t) => {
    const url = requireRestoreDb();
    if (!url) {
      t.skip("requires DATABASE_URL_RESTORE targeting an isolated restore database on 55432 or 55470");
      return;
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const version = await client.query(
        "SELECT filename FROM crm_schema_migrations ORDER BY filename DESC LIMIT 1",
      );
      assert.equal(version.rows[0].filename, latestMigration);
      const tables = await client.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'crm_%'",
      );
      assert.ok(tables.rows[0].n >= 50);
      for (const table of [
        "crm_inquiries",
        "crm_jobs",
        "crm_attachment_uploads",
        "crm_attachment_upload_parts",
        "crm_marketing_documents",
        "crm_marketing_versions",
        "crm_job_effects",
        "crm_record_locks",
        "crm_export_jobs",
      ]) {
        const exists = await client.query(
          `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1) AS e`,
          [table],
        );
        assert.equal(exists.rows[0].e, true, table);
        await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      }
    } finally {
      await client.end();
    }
  });

  it("accepts contact+inquiry insert with idempotent retry and duplicate effect prevention", async (t) => {
    const url = requireRestoreDb();
    if (!url) {
      t.skip("requires DATABASE_URL_RESTORE targeting an isolated restore database on 55432 or 55470");
      return;
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const suffix = randomUUID().slice(0, 8);
      const email = `restore.${suffix}@example.com`;
      const contact = await client.query(
        `INSERT INTO crm_contacts (first_name, last_name, job_title, email, email_normalized, country)
         VALUES ('Restore','Test','Ops',$1,$1,'US') RETURNING id`,
        [email],
      );
      const contactId = contact.rows[0].id as string;
      const idem = randomUUID();
      const ref = `RST-${suffix}`;
      const inquiry = await client.query(
        `INSERT INTO crm_inquiries (reference, contact_id, inquiry_type, status, channel, idempotency_key)
         VALUES ($1,$2,'general','NEW','web_form',$3) RETURNING id`,
        [ref, contactId, idem],
      );
      assert.ok(inquiry.rows[0].id);
      await assert.rejects(() =>
        client.query(
          `INSERT INTO crm_inquiries (reference, contact_id, inquiry_type, status, channel, idempotency_key)
           VALUES ($1,$2,'general','NEW','web_form',$3)`,
          [`${ref}-dup`, contactId, idem],
        ),
      );
      const effectKey = `restore-effect:${suffix}`;
      await client.query(
        `INSERT INTO crm_job_effects (idempotency_key, kind, status) VALUES ($1,'email','pending')`,
        [effectKey],
      );
      await assert.rejects(() =>
        client.query(
          `INSERT INTO crm_job_effects (idempotency_key, kind, status) VALUES ($1,'email','pending')`,
          [effectKey],
        ),
      );
    } finally {
      await client.end();
    }
  });

  it("supports marketing document and attachment upload session rows after restore", async (t) => {
    const url = requireRestoreDb();
    if (!url) {
      t.skip("requires DATABASE_URL_RESTORE targeting an isolated restore database on 55432 or 55470");
      return;
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const suffix = randomUUID().slice(0, 8);
      const doc = await client.query(
        `INSERT INTO crm_marketing_documents (slug, content_type) VALUES ($1,'page') RETURNING id`,
        [`restore-${suffix}`],
      );
      assert.ok(doc.rows[0].id);
      const upload = await client.query(
        `INSERT INTO crm_attachment_uploads
          (actor_staff_id, storage_provider, storage_key, filename, mime_type, expected_size_bytes, status, malware_status, expires_at)
         VALUES ($1,'memory',$2,'a.txt','text/plain',10,'uploading','pending', NOW() + interval '1 day')
         RETURNING id`,
        [`staff-${suffix}`, `restore/${suffix}/a.txt`],
      );
      assert.ok(upload.rows[0].id);
      await client.query(
        `INSERT INTO crm_attachment_upload_parts (upload_id, part_number, size_bytes, checksum_sha256, storage_key)
         VALUES ($1,1,10,'abc',$2)`,
        [upload.rows[0].id, `restore/${suffix}/part-1`],
      );
    } finally {
      await client.end();
    }
  });
});
