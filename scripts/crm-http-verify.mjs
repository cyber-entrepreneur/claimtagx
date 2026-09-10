#!/usr/bin/env node
const api = process.env.CRM_API ?? "http://127.0.0.1:18080";
const key = "local-verify-access-key";
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

function body(inquiryType, extra = {}) {
  return {
    firstName: "Verify",
    lastName: "User",
    jobTitle: "Operations Manager",
    companyName: extra.companyName ?? "Verify Hotels LLC",
    email: extra.email ?? `verify-${crypto.randomUUID()}@example.test`,
    country: "US",
    phoneRaw: "+12025550123",
    inquiryType,
    useCaseKeys: inquiryType === "sales" ? ["valet"] : [],
    message: extra.message ?? "This is a local verification inquiry for ClaimTagX.",
    termsAccepted: true,
    idempotencyKey: extra.idempotencyKey ?? crypto.randomUUID(),
    answers: extra.answers ?? {},
  };
}

await check("submit inquiry creates reference and jobs", async () => {
  const res = await fetch(`${api}/api/contact/inquiries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body("general")),
  });
  const json = await res.json();
  if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  if (!json.reference) throw new Error("missing reference");
});

await check("idempotent retry returns same reference", async () => {
  const idempotencyKey = crypto.randomUUID();
  const payload = body("general", { idempotencyKey, email: "verify-idem@example.test" });
  const a = await fetch(`${api}/api/contact/inquiries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const b = await fetch(`${api}/api/contact/inquiries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const ja = await a.json();
  const jb = await b.json();
  if (a.status !== 201 || b.status !== 201) throw new Error(`${a.status}/${b.status}`);
  if (ja.reference !== jb.reference) throw new Error("references diverged");
});

await check("direct config PUT creates draft not live publish", async () => {
  const login = await fetch(`${api}/api/platform/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "crm-author@example.test", accessKey: key, name: "Author" }),
  });
  const cookie = login.headers.getSetCookie?.()?.[0] ?? login.headers.get("set-cookie");
  if (login.status !== 200) throw new Error(`login ${login.status} ${await login.text()}`);
  const cfg = await fetch(`${api}/api/platform/contact/config`, { headers: { cookie } });
  const bundle = await cfg.json();
  const sla = bundle.sla?.[0];
  if (!sla) throw new Error("no sla policy");
  const put = await fetch(`${api}/api/platform/contact/sla/${sla.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ firstResponseMinutes: 45, rationale: "verify draft" }),
  });
  const drafted = await put.json();
  if (put.status !== 200 && put.status !== 201) throw new Error(`put ${put.status} ${JSON.stringify(drafted)}`);
  if (drafted.status && drafted.status !== "draft" && !drafted.changeId) {
    throw new Error(`unexpected ${JSON.stringify(drafted)}`);
  }
});

await check("author cannot self-approve", async () => {
  const login = await fetch(`${api}/api/platform/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "crm-author@example.test", accessKey: key, name: "Author" }),
  });
  const cookie = login.headers.getSetCookie?.()?.join("; ") ?? login.headers.get("set-cookie");
  const list = await fetch(`${api}/api/platform/contact/config/changes`, { headers: { cookie } });
  const data = await list.json();
  const draft = (data.items ?? []).find((i) => i.status === "draft") ?? (data.items ?? [])[0];
  if (!draft) throw new Error("no change");
  await fetch(`${api}/api/platform/contact/config/changes/${draft.id}/submit_review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });
  const approve = await fetch(`${api}/api/platform/contact/config/changes/${draft.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });
  if (approve.status !== 403) throw new Error(`expected 403 got ${approve.status} ${await approve.text()}`);
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length, failedNames: failed.map((f) => f.name) }));
process.exit(failed.length ? 1 : 0);
