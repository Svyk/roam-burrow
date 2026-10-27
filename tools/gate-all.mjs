#!/usr/bin/env node
// Every live gate on both graphs, one command, about 30 minutes:
// byte-for-byte + acceptance + alias rows + drill + pick memory (live-gate)
// and the cost budget for (( typing (also with Roam's preview open in svy) and for drill typing with the preview
// open (perf-gate, 3 interleaved runs per arm, median paired delta), and the first draw of a large
// page's preview (perf-gate --cold). Needs Roam Desktop with CDP on :9223 and both windows open (svy
// unlocked). Never reloads a window. --notes picks the notes window by its title's start when there
// are two (the default "Readwisenotes" takes the first).
//   node tools/gate-all.mjs [--theme light|dark] [--notes "Readwisenotes - Daily"]        (or: npm run gate:live)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const themeAt = process.argv.indexOf("--theme");
const theme = themeAt >= 0 ? process.argv[themeAt + 1] : null;
if (themeAt >= 0 && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const notesAt = process.argv.indexOf("--notes");
const notes = notesAt >= 0 ? process.argv[notesAt + 1] : "Readwisenotes";
const steps = [
  ["live-gate.mjs", "Svy", "svy"],
  ["live-gate.mjs", notes, "notes"],
  ["perf-gate.mjs", "Svy", "--runs", "3"],
  ["perf-gate.mjs", notes, "--runs", "3"],
  ["perf-gate.mjs", "Svy", "--runs", "3", "--preview"],
  ["perf-gate.mjs", "Svy", "--runs", "2", "--cold", "[[plexus"],
  ["perf-gate.mjs", "Svy", "--runs", "3", "--drill"],
  ["perf-gate.mjs", notes, "--runs", "3", "--drill"],
  ["perf-gate.mjs", "Svy", "--runs", "3", "--related", "--query", "marvel movies in order"],
  ["perf-gate.mjs", notes, "--runs", "3", "--related"],
];
let failed = 0;
const t0 = Date.now();
for (const [script, ...args] of steps) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [`${dir}${script}`, ...args, ...(theme ? ["--theme", theme] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(run.stdout);
  if (run.status !== 0) {
    failed += 1;
    if (!run.stdout.trim()) process.stdout.write(`${script} ${args.join(" ")}: exit ${run.status}\n${run.stderr.slice(-1500)}\n`);
  }
  process.stdout.write(`  (${Math.round((Date.now() - started) / 1000)} s)\n`);
}
console.log(`\nall live gates${theme ? ` (${theme})` : ""}: ${failed ? `FAIL (${failed} of ${steps.length})` : "PASS"} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exitCode = failed ? 1 : 0;
