-- Governed marketing content workflow (localized versions, audit, publication lineage)

CREATE TABLE IF NOT EXISTS "crm_marketing_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL,
  "content_type" text NOT NULL DEFAULT 'page',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_marketing_documents_slug_uniq"
  ON "crm_marketing_documents" ("slug");

CREATE TABLE IF NOT EXISTS "crm_marketing_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "crm_marketing_documents" ("id") ON DELETE CASCADE,
  "locale" text NOT NULL DEFAULT 'en',
  "version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "title" text NOT NULL,
  "summary" text,
  "body" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seo_title" text,
  "seo_description" text,
  "robots" text,
  "scheduled_at" timestamptz,
  "published_at" timestamptz,
  "supersedes_version_id" uuid REFERENCES "crm_marketing_versions" ("id") ON DELETE SET NULL,
  "author_staff_id" uuid REFERENCES "crm_staff" ("id") ON DELETE SET NULL,
  "reviewer_staff_id" uuid REFERENCES "crm_staff" ("id") ON DELETE SET NULL,
  "publisher_staff_id" uuid REFERENCES "crm_staff" ("id") ON DELETE SET NULL,
  "lock_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_marketing_versions_doc_locale_version_uniq"
  ON "crm_marketing_versions" ("document_id", "locale", "version");

CREATE INDEX IF NOT EXISTS "crm_marketing_versions_status_idx"
  ON "crm_marketing_versions" ("status", "scheduled_at");

CREATE INDEX IF NOT EXISTS "crm_marketing_versions_published_idx"
  ON "crm_marketing_versions" ("document_id", "locale", "published_at");

CREATE TABLE IF NOT EXISTS "crm_marketing_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "crm_marketing_documents" ("id") ON DELETE CASCADE,
  "version_id" uuid REFERENCES "crm_marketing_versions" ("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "actor_staff_id" uuid REFERENCES "crm_staff" ("id") ON DELETE SET NULL,
  "before_value" jsonb,
  "after_value" jsonb,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_marketing_audit_doc_idx"
  ON "crm_marketing_audit" ("document_id", "created_at");
