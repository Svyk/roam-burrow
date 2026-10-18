#!/usr/bin/env node
// Every live gate on both graphs, one command, about 9 minutes:
// byte-for-byte + acceptance + alias rows (live-gate) and the cost budget
// (perf-gate, 3 interleaved runs per arm, median paired delta). Needs Roam Desktop with CDP on
// :9223 and both windows open (svy unlocked). Never reloads a window.
//   node tools/gate-all.mjs        (or: npm run gate:live)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const steps = [
  ["live-gate.mjs", "Svy", "svy"],
  ["live-gate.mjs", "Readwisenotes", "notes"],
  ["perf-gate.mjs", "Svy", "--runs", "3"],
  ["perf-gate.mjs", "Readwisenotes", "--runs", "3"],
];
let failed = 0;
const t0 = Date.now();
for (const [script, ...args] of steps) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [`${dir}${script}`, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(run.stdout);
  if (run.status !== 0) {
    failed += 1;
    if (!run.stdout.trim()) process.stdout.write(`${script} ${args.join(" ")}: exit ${run.status}\n${run.stderr.slice(-1500)}\n`);
  }
  process.stdout.write(`  (${Math.round((Date.now() - started) / 1000)} s)\n`);
}
console.log(`\nall live gates: ${failed ? `FAIL (${failed} of ${steps.length})` : "PASS"} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exitCode = failed ? 1 : 0;
