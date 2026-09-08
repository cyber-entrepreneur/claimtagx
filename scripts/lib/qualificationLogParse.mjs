/**
 * Parse Playwright list-reporter logs that run one project per process.
 * Do not use the last "N passed" line as the whole-file total.
 */

function lastInt(text, re) {
  const matches = [...text.matchAll(re)];
  if (!matches.length) return 0;
  return Number(matches[matches.length - 1][1]);
}

export function parseProjectChunk(chunk) {
  const name = chunk.match(/^(\S+)/)?.[1] ?? "unknown";
  const announced = lastInt(chunk, /Running (\d+) tests/g);
  const passedSummary = lastInt(chunk, /^\s+(\d+) passed(?: \([^)]+\))?\s*$/gm);
  const failedSummary = lastInt(chunk, /^\s+(\d+) failed(?: \([^)]+\))?\s*$/gm);
  const skippedSummary = lastInt(chunk, /^\s+(\d+) skipped(?: \([^)]+\))?\s*$/gm);
  const okLines = [...chunk.matchAll(/^\s+ok \d+ \[([^\]]+)\]/gm)].length;
  const failLines = [...chunk.matchAll(/^\s+(?:x|X|not ok) \d+ \[([^\]]+)\]/gm)].length;
  const skipLines = [...chunk.matchAll(/^\s+- \d+ \[([^\]]+)\]/gm)].length;
  const passed = Math.max(passedSummary, okLines);
  const failed = Math.max(failedSummary, failLines);
  const skipped = Math.max(skippedSummary, skipLines);
  const accounted = passed + failed + skipped;
  const didNotRun = Math.max(0, announced - accounted);
  return {
    project: name,
    announced,
    passed,
    failed,
    skipped,
    didNotRun,
    okLines,
    failLines,
    skipLines,
  };
}

export function parsePlaywrightQualificationLog(text) {
  const isolatedDb = /ISOLATED_DB name=(\S+)/.exec(text)?.[1] ?? null;
  const runId = /(?:CRM_E2E_RUN_ID|runId)=([A-Za-z0-9]+)/.exec(text)?.[1] ?? null;
  const retries = /retries=(\d+)/.exec(text);
  const dist = /SITE_MODE \w+ port=\d+ dist=(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const chunks = text.split(/=== PROJECT /);
  const projects = chunks.slice(1).map(parseProjectChunk);
  const totals = projects.reduce(
    (acc, p) => {
      acc.announced += p.announced;
      acc.passed += p.passed;
      acc.failed += p.failed;
      acc.skipped += p.skipped;
      acc.didNotRun += p.didNotRun;
      return acc;
    },
    { announced: 0, passed: 0, failed: 0, skipped: 0, didNotRun: 0 },
  );
  const lastPassedLine = lastInt(text, /^\s+(\d+) passed(?: \([^)]+\))?\s*$/gm);
  return {
    isolatedDb,
    runId,
    retries: retries ? Number(retries[1]) : null,
    dist,
    projects,
    totals,
    lastPassedLineOnly: lastPassedLine,
    lastLineUndercounts: projects.length > 1 && lastPassedLine < totals.passed,
    allOk: /ALL_OK /.test(text),
    hasFailures: /HAS_FAILURES /.test(text),
  };
}

export function parseOrchestrationSummary(text) {
  const shards = {};
  const re = /END shard=(\w+) rep=(\d+) exit=(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const shard = m[1];
    const rep = Number(m[2]);
    const exit = Number(m[3]);
    shards[shard] ??= { repetitions: [], sequence: [] };
    shards[shard].repetitions.push({
      rep,
      exit,
      result: exit === 0 ? "PASS" : "FAIL",
    });
    shards[shard].sequence.push(exit === 0 ? "PASS" : "FAIL");
  }
  for (const shard of Object.keys(shards)) {
    const seq = shards[shard].sequence;
    let consecutive = 0;
    for (let i = seq.length - 1; i >= 0; i--) {
      if (seq[i] === "PASS") consecutive += 1;
      else break;
    }
    shards[shard].consecutivePassFromEnd = consecutive;
    shards[shard].shardResult = seq.every((s) => s === "PASS") ? "PASS" : "FAIL";
  }
  return {
    kind: /kind=(\w+)/.exec(text)?.[1] ?? "unknown",
    browser: /browser=(\w+)/.exec(text)?.[1] ?? "unknown",
    siteMode: /siteMode=(\w+)/.exec(text)?.[1] ?? "unknown",
    retries: /retries=0/.test(text) ? 0 : null,
    startedAt: /started=(\S+)/.exec(text)?.[1] ?? null,
    allShardsOk: /ALL_SHARDS_OK/.test(text),
    hasShardFailures: /HAS_SHARD_FAILURES/.test(text),
    shards,
  };
}

export function aggregateLogs(logTextsByName) {
  const perLog = {};
  const totals = { announced: 0, passed: 0, failed: 0, skipped: 0, didNotRun: 0 };
  for (const [name, text] of Object.entries(logTextsByName)) {
    if (name.includes("orchestration-summary")) continue;
    const parsed = parsePlaywrightQualificationLog(text);
    perLog[name] = parsed;
    totals.announced += parsed.totals.announced;
    totals.passed += parsed.totals.passed;
    totals.failed += parsed.totals.failed;
    totals.skipped += parsed.totals.skipped;
    totals.didNotRun += parsed.totals.didNotRun;
  }
  return { perLog, totals };
}
