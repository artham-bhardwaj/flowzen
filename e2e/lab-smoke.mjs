// Browser smoke test for the Scaling Laboratory: baseline, experiment, comparison, sweep, cancellation,
// variants, lessons, isolation from the design canvas and challenges, and persistence.
// Run with `npm run test:browser` (see e2e/harness.mjs for requirements and environment variables).
import { startSuite, wait } from './harness.mjs';

const { page, check, finish, shot, clickText, press, clickBlank, history, navigate } = await startSuite('lab');
try {
  const labStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-lab-v1') ?? 'null'));
  const panelText = () => page.$eval('.fz-lab', element => element.textContent);
  const tab = async name => { await clickText('.fz-lab .fz-lld__tabs button', name); await wait(150); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.fz-labstatus'), { timeout: 60_000 });
  const field = async (label, value) => {
    const input = await page.evaluateHandle(label => [...document.querySelectorAll('.fz-lab .fz-labfield')].find(entry => entry.querySelector('span')?.textContent.startsWith(label))?.querySelector('input'), label);
    await input.click({ clickCount: 3 }); await page.keyboard.type(String(value)); await wait(250);
  };
  const control = async (ariaLabel, value) => { const input = await page.$(`.fz-lab input[aria-label="${ariaLabel}"]`); await input.click({ clickCount: 3 }); await page.keyboard.type(String(value)); await wait(1200); };
  const clickButton = pattern => page.evaluate(source => { const button = [...document.querySelectorAll('.fz-lab button')].find(entry => new RegExp(source).test(entry.textContent)); button?.click(); return Boolean(button); }, pattern.source);
  const challengesBefore = await page.evaluate(() => localStorage.getItem('flowzen-challenges-v1'));

  // ── Open the lab ────────────────────────────────────────────────────────────
  await navigate('Lab'); await page.waitForSelector('.fz-lab'); await wait(300);
  check('The Lab opens with the existing canvas and its own empty edit history', (await page.$$('.react-flow__node')).length === 9 && (await history()).every(button => button.disabled));
  check('Toolbar workload is locked to the lab benchmark', await page.$eval('.fz-workload', element => element.disabled) === true);

  // ── Baseline ────────────────────────────────────────────────────────────────
  await clickButton(/Set current design as baseline/); await idle(); await wait(200);
  const baseline = (await labStore()).baseline;
  check('Setting a baseline records an immutable run with snapshot, benchmark, seed and revision',
    baseline?.schema === 'flowzen.lab-run' && baseline.architecture.nodes.length === 9 && baseline.benchmark.rps === 400 && baseline.benchmark.seed === 42 && baseline.simulatorRevision === 1 && baseline.measurements.complete === true);
  check('The baseline summary shows offered vs succeeded traffic and target results', /Offered → succeeded/.test(await panelText()) && (await page.$$('.fz-lab .fz-crit li')).length === 3);
  const baselineJson = JSON.stringify(baseline);

  // ── Experiment: one change ──────────────────────────────────────────────────
  await tab('Experiment');
  check('Only simulator-modeled controls are offered', /Instances/.test(await panelText()) && /Hit ratio/.test(await panelText()) && !/Runtime/.test(await panelText()));
  await control('Checkout API · A Instances', '9'); await clickBlank();
  const edit = await history();
  check('Lab edits are undoable', /Undo Edit Checkout API · A · instances/.test(edit[0].label), edit[0].label);
  await clickButton(/^Run experiment$/); await idle(); await wait(300);
  const results = await panelText();
  check('Same benchmark: the comparison is like-for-like and attributes the single change', /Same benchmark: like-for-like comparison/.test(results) && /Checkout API · A · Instances: 3 → 9/.test(results));
  check('Comparison lists metric changes, targets, components and explanations with their basis', /Latency p95/.test(results) && /Busy \(traffic window\)/.test(results) && (await page.$$('.fz-lab .fz-basis')).length > 0);
  check('The baseline is unchanged by the experiment', JSON.stringify((await labStore()).baseline) === baselineJson);
  await shot('01-comparison');
  await page.$eval('.fz-lab .fz-findings', element => element.scrollIntoView()); await wait(150); await shot('01b-explanations');

  // ── Variants ────────────────────────────────────────────────────────────────
  await tab('Variants');
  const nameInput = await page.$('.fz-lab input[aria-label="Variant name"]'); await nameInput.type('Bigger A');
  await clickButton(/Save variant/); await wait(300);
  let stored = await labStore();
  const variantJson = JSON.stringify(stored.variants[0]);
  check('Saving a variant stores the architecture, benchmark and its matching run', stored.variants[0]?.name === 'Bigger A' && stored.variants[0].run?.measurements && stored.variants[0].architecture.nodes.find(node => node.id === 'app-a').config.instances === '9');
  await nameInput.type('Bigger A'); await clickButton(/Save variant/); await wait(200);
  check('A variant is never overwritten by a duplicate name', /already exists/.test(await panelText()) && (await labStore()).variants.length === 1);

  // Undo the edit, then load the variant back as a draft (with confirmation).
  await clickBlank(); await press('Control+z'); await wait(500);
  check('Undo reverts the experiment canvas, not the saved variant', (await labStore()).draft?.nodes.find(node => node.id === 'app-a').config.instances === '3' && JSON.stringify((await labStore()).variants[0]) === variantJson);
  await clickButton(/Load as draft/); await wait(150);
  check('Loading a variant over a different canvas asks first', await page.$('.fz-lab .fz-confirm') !== null);
  await clickText('.fz-lab .fz-confirm button', 'Replace'); await wait(700);
  stored = await labStore();
  check('Confirming loads the variant as an editable draft; the variant and baseline stay unchanged', stored.draft.nodes.find(node => node.id === 'app-a').config.instances === '9' && JSON.stringify(stored.variants[0]) === variantJson && JSON.stringify(stored.baseline) === baselineJson);

  // ── Traffic sweep ───────────────────────────────────────────────────────────
  await tab('Experiment');
  await clickButton(/Run traffic sweep/); await idle(); await wait(600);
  stored = await labStore();
  const points = stored.sweep?.points ?? [];
  check('A sweep simulates exactly the selected levels with the benchmark seed', points.length === 5 && points.every(point => point.status === 'measured' && point.measurements.offeredRps === point.rps) && stored.sweep.benchmark.seed === 42);
  const sweepText = await panelText();
  check('The scaling curve plots latency and throughput against offered traffic', (await page.$$('.fz-lab .fz-scaling__chart svg.recharts-surface')).length === 2);
  // The expected statement follows from the stored measurements: a violation if any simulated level missed a target.
  const firstMiss = points.find(point => point.targetResults.some(result => result.met !== true));
  check('The measured breaking point matches the simulated levels', firstMiss
    ? new RegExp(`first violated at ${firstMiss.rps.toLocaleString()} req/s \\(simulated\\)`).test(sweepText) && /first target miss \(simulated\)/.test(sweepText)
    : /met the targets/.test(sweepText) && /Heuristic estimate, not simulated/.test(sweepText), firstMiss ? `first miss ${firstMiss.rps}` : 'no miss');
  check('The table lists every level with throughput, percentiles, errors and the busiest component', (await page.$$('.fz-lab .fz-sweep__table tbody tr')).length === 5 && /Checkout API|Orders DB|Load Balancer|Session Cache/.test(await page.$eval('.fz-lab .fz-sweep__table', element => element.textContent)));
  await page.$eval('.fz-lab .fz-scaling', element => element.scrollIntoView()); await wait(200);
  await shot('02-sweep');

  // Cancellation: a longer sweep, cancelled right away.
  await tab('Setup'); await field('Traffic window', 30); await tab('Experiment');
  await clickButton(/Run traffic sweep/); await wait(250); await clickButton(/^Cancel$/);
  await idle(); await wait(300);
  stored = await labStore();
  const statuses = stored.sweep.points.map(point => point.status);
  check('Cancelling stops the sweep; levels not run are recorded as not run, never estimated',
    statuses.includes('cancelled') && stored.sweep.points.filter(point => point.status === 'cancelled').every(point => point.measurements === null) && /Sweep cancelled after/.test(await panelText()), statuses.join(','));
  check('Cancelled levels are marked in the table', /Not run \(sweep cancelled\)/.test(await page.$eval('.fz-lab .fz-sweep__table', element => element.textContent)));
  await tab('Setup'); await field('Traffic window', 10);
  check('Restoring the baseline’s traffic window clears the benchmark warning', !/differs from the baseline’s/.test(await panelText()));
  await field('Traffic', 800);
  check('…and changing traffic flags it again', /differs from the baseline’s \(offered traffic 400 vs 800 req\/s\)/.test(await panelText()));
  await clickButton(/Use the baseline’s benchmark/); await wait(200);

  // ── Lessons ─────────────────────────────────────────────────────────────────
  await tab('Hypotheses');
  const lessons = await page.$$eval('.fz-lab .fz-lesson summary', items => items.map(item => item.textContent));
  check('Five hypotheses, each with a status from the user’s results', lessons.length === 5 && lessons.every(text => /needs data|support|inconclusive/.test(text)), lessons.join(' | '));
  await page.click('.fz-lab .fz-lesson summary'); await wait(100);
  check('A lesson shows hypothesis, experiment, what to look for and a conclusion', /Hypothesis/.test(await panelText()) && /Conclusion from your results/.test(await panelText()));
  await shot('03-learn');

  // ── Isolation and persistence ───────────────────────────────────────────────
  await navigate('Design'); await wait(500);
  const designApi = await page.evaluate(() => document.querySelector('.react-flow__node[data-id="app-a"]')?.textContent ?? '');
  check('Lab edits never reach the design canvas', /3 instances/.test(designApi), designApi.slice(0, 60));
  check('Challenge progress is untouched by the lab', await page.evaluate(() => localStorage.getItem('flowzen-challenges-v1')) === challengesBefore);
  await page.reload({ waitUntil: 'networkidle0' });
  await navigate('Lab'); await page.waitForSelector('.fz-lab'); await wait(400);
  stored = await labStore();
  check('Baseline, variants, sweep and the experiment draft persist across reload', JSON.stringify(stored.baseline) === baselineJson && stored.variants.length === 1 && stored.sweep !== null && stored.draft.nodes.find(node => node.id === 'app-a').config.instances === '9');
  await tab('Results');
  check('Results are restored after reload', /Same benchmark|Different benchmarks/.test(await panelText()));
  await page.click('.fz-toolbar button[aria-label^="Switch to"]'); await wait(300);
  await shot('04-results-other-theme');
} catch (error) {
  await finish(error);
}
await finish();
