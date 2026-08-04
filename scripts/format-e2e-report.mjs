#!/usr/bin/env node
// Turns Playwright's JSON reporter output into a short markdown pass/fail summary.
//
// Usage: node scripts/format-e2e-report.mjs <results.json> <report.md>
import * as fs from "node:fs";

const [, , resultsPath, reportPath] = process.argv;
if (!resultsPath || !reportPath) {
  console.error("usage: format-e2e-report.mjs <results.json> <report.md>");
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

/** Playwright's JSON reporter nests results as suites -> suites -> specs -> tests -> results. */
function collectSpecs(suites, titlePath = []) {
  const specs = [];
  for (const suite of suites ?? []) {
    const path = [...titlePath, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      specs.push({ path, spec });
    }
    specs.push(...collectSpecs(suite.suites, path));
  }
  return specs;
}

const specs = collectSpecs(raw.suites);

const rows = specs.map(({ path, spec }) => {
  const test = spec.tests?.[0];
  const result = test?.results?.[test.results.length - 1];
  // spec.ok is true for both a pass and a skip — the per-result status is the only field that
  // tells them apart, so it takes priority over spec.ok rather than the other way round.
  const status = result?.status ?? (spec.ok ? "passed" : "unknown");
  return {
    title: [...path, spec.title].join(" › "),
    status,
    durationMs: result?.duration ?? 0,
    error: result?.errors?.[0]?.message ?? null,
    location: spec.file && spec.line ? `${spec.file}:${spec.line}` : null,
  };
});

const passed = rows.filter((r) => r.status === "passed");
const skipped = rows.filter((r) => r.status === "skipped");
const failed = rows.filter((r) => r.status !== "passed" && r.status !== "skipped");

const lines = [];
lines.push(`# E2E report — ${raw.stats?.startTime ?? new Date().toISOString()}`);
lines.push("");
lines.push(`**${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped** (${rows.length} total)`);
lines.push("");

if (failed.length > 0) {
  lines.push("## Failures");
  lines.push("");
  for (const row of failed) {
    lines.push(`### ${row.title}`);
    lines.push("");
    lines.push(`- Status: \`${row.status}\``);
    if (row.location) lines.push(`- Location: \`${row.location}\``);
    if (row.error) {
      lines.push("- Error:");
      lines.push("```");
      lines.push(row.error);
      lines.push("```");
    }
    lines.push("");
  }
}

lines.push("## All tests");
lines.push("");
lines.push("| Test | Status | Duration |");
lines.push("|---|---|---|");
for (const row of rows) {
  lines.push(`| ${row.title} | ${row.status} | ${row.durationMs}ms |`);
}
lines.push("");

fs.writeFileSync(reportPath, lines.join("\n"));
console.log(`wrote ${reportPath}: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);

// Exit non-zero on any real failure so the wrapping shell script can propagate it, without
// treating a skip (missing OPENAI_API_KEY, expected in CI) as a failure.
process.exit(failed.length > 0 ? 1 : 0);
