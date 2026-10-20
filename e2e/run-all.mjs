// Runs every browser smoke suite in its own process and reports the totals, even if one suite fails.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suites = ['challenge-smoke.mjs', 'design-smoke.mjs', 'lab-smoke.mjs', 'learn-smoke.mjs', 'interview-smoke.mjs'];
let worst = 0; const summary = [];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(result.stdout);
  const line = /\] (\d+)\/(\d+) checks passed/.exec(result.stdout);
  summary.push(`${suite}: ${line ? `${line[1]}/${line[2]} checks passed` : 'did not report results'} (exit ${result.status})`);
  worst = Math.max(worst, result.status ?? 1);
}
console.log(`\nBrowser smoke suites\n${summary.map(line => `  ${line}`).join('\n')}`);
process.exit(worst);
