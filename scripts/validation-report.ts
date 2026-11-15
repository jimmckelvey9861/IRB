/**
 * Builds the operational qualification (OQ) report from a test run: every requirement in
 * docs/requirements.md, the tests that prove it, and whether they passed (21 CFR 11.10(a)).
 *
 * Usage: npm run validate   (needs TEST_DATABASE_URL so the database tests run)
 * Output: validation/oq-report.md. Exits non-zero if any test failed or was skipped.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

interface Assertion {
  fullName: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  failureMessages: string[];
}
interface Results {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: { name: string; assertionResults: Assertion[] }[];
}

const results: Results = JSON.parse(readFileSync("validation/results.json", "utf8"));
const tests = results.testResults.flatMap((f) => f.assertionResults.map((a) => ({ ...a, file: f.name })));

/** "[REQ-56.107, AAHRPP II.1.A]" -> ["REQ-56.107"] */
function tagsOf(name: string): string[] {
  return [...name.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(",").map((t) => t.trim()).filter((t) => t.startsWith("REQ-")));
}
/** "REQ-56.109(e),(f)" -> ["REQ-56.109(e)", "REQ-56.109(f)", "REQ-56.109(e),(f)"] */
function idsOf(id: string): string[] {
  const m = id.match(/^(REQ-[^(]+)(\(.+)$/);
  if (!m) return [id];
  const parts = m[2].split(",").map((p) => p.trim());
  return [id, ...parts.map((p) => m[1] + p)];
}

const rows = readFileSync("docs/requirements.md", "utf8")
  .split("\n")
  .filter((l) => l.startsWith("| REQ-"))
  .map((l) => {
    const cells = l.split(" | ").map((c) => c.replace(/^\|\s*|\s*\|$/g, "").trim());
    const files = [...cells[3].matchAll(/`([^`]+\.test\.ts)`/g)].map((m) => basename(m[1]));
    return { id: cells[0], requirement: cells[1], files, status: cells[4] };
  });

const commit = (() => {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();

const out: string[] = [];
let uncovered = 0;
out.push("# Operational qualification report", "");
out.push(`- Generated: ${new Date().toISOString()}`);
out.push(`- Software version (git commit): \`${commit}\``);
out.push(`- Node.js ${process.version}; database tests ${results.numPendingTests ? "SKIPPED" : "run"}`);
out.push(`- Tests: ${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numPendingTests} skipped, of ${results.numTotalTests}`, "");
out.push("| Requirement | Evidence | Result |", "| --- | --- | --- |");
for (const r of rows) {
  const ids = idsOf(r.id);
  let evidence = tests.filter((t) => tagsOf(t.fullName).some((tag) => ids.includes(tag)));
  if (!evidence.length) evidence = tests.filter((t) => r.files.includes(basename(t.file)));
  const failed = evidence.filter((t) => t.status !== "passed");
  if (!evidence.length) uncovered++;
  const result = !evidence.length ? "NO TEST" : failed.length ? `FAIL (${failed.length})` : `pass (${evidence.length} tests)`;
  out.push(`| **${r.id}** ${r.requirement} | ${evidence.map((t) => t.fullName.replace(/\|/g, "/")).join("<br>") || "none"} | ${result} |`);
}
const failures = tests.filter((t) => t.status === "failed");
if (failures.length) {
  out.push("", "## Failures", "");
  for (const f of failures) out.push(`- ${f.fullName}: ${f.failureMessages[0]?.split("\n")[0] ?? ""}`);
}
out.push("", "Reviewed and approved for release by: ____________________  Date: __________", "");

mkdirSync("validation", { recursive: true });
writeFileSync("validation/oq-report.md", out.join("\n"));
console.log(`validation/oq-report.md: ${rows.length} requirements, ${uncovered} without a test, ${results.numFailedTests} failed, ${results.numPendingTests} skipped`);
if (results.numFailedTests || results.numPendingTests || uncovered) process.exit(1);
