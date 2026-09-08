import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "routes");

describe("direct config mutation cannot bypass governance", () => {
  it("converts platformContact config writes into governed drafts", () => {
    const src = readFileSync(join(dir, "platformContact.ts"), "utf8");
    const changes = readFileSync(join(dir, "platformConfigChanges.ts"), "utf8");
    const domain = readFileSync(join(dir, "..", "lib", "crm", "configTransition.ts"), "utf8");
    assert.match(src, /createGovernedDraft/);
    assert.match(changes, /applyConfigChangeAction/);
    assert.match(domain, /applyPublishedChange/);
    assert.match(domain, /crmConfigPublicationsTable/);
    assert.equal(/\.update\(crmTaxonomyTable\)/.test(src), false);
    assert.equal(/\.update\(crmSlaPoliciesTable\)/.test(src), false);
    assert.equal(/\.update\(crmRoutingRulesTable\)/.test(src), false);
    assert.equal(/\.update\(crmWorkflowsTable\)/.test(src), false);
    assert.equal(/\.update\(crmMeetingTypesTable\)/.test(src), false);
    assert.equal(/\.update\(crmQualificationModelsTable\)/.test(src), false);
    assert.equal(/\.update\(crmMacrosTable\)/.test(src), false);
    assert.equal(/\.update\(crmTagsTable\)/.test(src), false);
    assert.match(src, /entityType: "macro"/);
    assert.match(src, /entityType: "tag"/);
    assert.match(src, /entityType: "notification_policy"/);
    assert.match(src, /entityType: "template_create"/);
    assert.match(src, /entityType: "business_calendar"/);
    assert.match(src, /entityType: "retention_policy"/);
    assert.match(src, /entityType: "spam_bot_policy"/);
    assert.equal(/\.insert\(crmTemplatesTable\)/.test(src), false);
    assert.match(src, /pauseInquirySla/);
    assert.equal(/status: "published"[\s\S]{0,80}crmQualificationModelsTable/.test(src), false);
    assert.match(domain, /emergencyBypass/);
  });
});
