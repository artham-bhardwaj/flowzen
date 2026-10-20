// Browser smoke test for the critical Challenge Mode workflow, including attempt history.
// Run with `npm run test:browser` (see e2e/harness.mjs for requirements and environment variables).
import { startSuite, wait } from './harness.mjs';

const { page, check, finish, shot, clickText, press, clickBlank, history, progress } = await startSuite('challenge');
try {
  // ── Helpers ────────────────────────────────────────────────────────────────
  const rightTab = () => page.$eval('.fz-rtabs [aria-selected="true"]', element => element.textContent);
  const setField = async (label, value) => {
    const input = await page.evaluateHandle(label => [...document.querySelectorAll('.fz-field')].find(field => field.querySelector('span')?.textContent.startsWith(label))?.querySelector('input'), label);
    await input.click({ clickCount: 3 }); await page.keyboard.type(value); await wait(1100);
  };
  const selectNode = async id => { await page.click(`.react-flow__node[data-id="${id}"]`); await wait(250); };
  /** Fingerprint of the interactive (practice) run: its recorded event count and run length in the timeline. */
  const practiceFingerprint = () => page.$eval('.fz-bottom', element => [/([\d,]+) recorded/.exec(element.textContent)?.[1], /\/\s*([\d.]+)\s*s/.exec(element.textContent)?.[1]].join('|'));
  /** A component's saved configuration (drafts autosave 400 ms after an edit). */
  const draftConfig = async (challengeId, nodeId) => { await wait(700); return (await progress()).drafts[challengeId]?.nodes.find(node => node.id === nodeId)?.config ?? {}; };
  const criteriaText = () => page.$$eval('.fz-brief .fz-crit li', items => items.map(item => item.textContent).join('|'));
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('.fz-toolbar [aria-busy="true"]') && ![...document.querySelectorAll('.fz-brief button')].some(button => /Grading/.test(button.textContent)), { timeout: 30000 });
  const submit = async () => {
    await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].find(button => /Submit solution/.test(button.textContent))?.click());
    await page.waitForSelector('.fz-results', { timeout: 30000 }); await wait(250);
    return page.$eval('.fz-results', element => element.textContent);
  };
  const closeResults = async () => { await page.evaluate(() => [...document.querySelectorAll('.fz-results button')].find(button => /Try again|Keep practicing/.test(button.textContent))?.click()); await wait(200); };

  // ── Library ─────────────────────────────────────────────────────────────────
  await clickText('.fz-nav button', 'Challenges'); await page.waitForSelector('.fz-catalog');
  const cardTitles = () => page.$$eval('.fz-ccard h3', items => items.map(item => item.textContent));
  const resultCount = () => page.$eval('.fz-results-bar h2', element => element.textContent);
  const facet = (legend, label) => page.evaluate((legend, label) => {
    const set = [...document.querySelectorAll('.fz-facet')].find(entry => entry.querySelector('legend')?.textContent === legend);
    const option = [...(set?.querySelectorAll('label') ?? [])].find(entry => entry.querySelector('.fz-facet__label')?.textContent === label);
    option?.querySelector('input')?.click(); return Boolean(option);
  }, legend, label);
  const all = await cardTitles();
  check('The catalog lists every challenge as a card with type, level, time and criteria', all.length >= 10 && /10 results/.test(await resultCount())
    && /Challenge/.test(await page.$eval('.fz-ccard', element => element.textContent)) && /Beginner friendly/.test(await page.$eval('.fz-card-grid', element => element.textContent)) && /About \d+ minutes/.test(await page.$eval('.fz-card-grid', element => element.textContent)));
  check('The hero suggests what to do next', /Next up/.test(await page.$eval('.fz-hero', element => element.textContent)));
  await facet('Topic', 'Caching'); await wait(150);
  const caching = await cardTitles();
  check('Topic filters narrow the results and update the count', caching.length > 1 && caching.length < all.length && caching.includes('Cache It Right') && new RegExp(`${caching.length} results`).test(await resultCount()), caching.join(', '));
  await facet('Level', 'Beginner friendly'); await wait(150);
  const easyCaching = await cardTitles();
  check('Facets combine (topic AND level)', easyCaching.length >= 1 && easyCaching.every(title => caching.includes(title)) && easyCaching.length <= caching.length, easyCaching.join(', '));
  await page.evaluate(() => [...document.querySelectorAll('.fz-filters button')].find(button => /Clear filters/.test(button.textContent))?.click()); await wait(150);
  check('Clear filters restores every result', (await cardTitles()).length === all.length);
  await page.select('select[aria-label="Sort challenges"]', 'shortest'); await wait(150);
  const minutes = await page.$$eval('.fz-ccard__meta', lists => lists.map(list => Number(/About (\d+) minutes/.exec(list.textContent)?.[1])));
  check('Sorting by shortest orders cards by estimated time', minutes.every((value, i) => i === 0 || value >= minutes[i - 1]), minutes.join(','));
  await page.select('select[aria-label="Sort challenges"]', 'recommended'); await wait(100);
  await shot('00-catalog');
  check('Medium challenges start locked', (await page.$$eval('.fz-ccard.is-locked', items => items.length)) >= 1);
  await shot('01-library');

  // ── Workspace ──────────────────────────────────────────────────────────────
  await page.evaluate(() => [...document.querySelectorAll('.fz-ccard button')].find(button => button.getAttribute('aria-label') === 'Start The Slow API')?.click());
  await page.waitForSelector('.fz-brief'); await wait(400);
  const briefText = await page.$eval('.fz-brief', element => element.textContent);
  const groups = await page.$$eval('.fz-brief h4', items => items.map(item => item.textContent));
  check('Brief states requirements, runtime and architecture criteria, and the pass rule',
    /Serve every profile request/.test(briefText) && /p95 latency ≤ 100 ms/.test(briefText) && /Compute slots ≤ 24/.test(briefText) && groups.some(text => text.startsWith('Runtime')) && groups.some(text => text.startsWith('Architecture')) && /Pass rule: all \d+ mandatory criteria must pass/.test(briefText));
  check('A new challenge starts with an empty edit history', (await history()).every(button => button.disabled));

  // Practice run of the starter (fails), recorded only as interactive state.
  await clickText('.fz-toolbar button', 'Practice run'); await waitIdle(); await wait(500);
  const practiceCriteria = await criteriaText();
  check('A practice run measures the criteria in the brief', /ms/.test(practiceCriteria));
  const practice = await practiceFingerprint();

  for (const view of ['LLD', 'HLD', 'Unified']) { await clickText('[aria-label="Design view"] button', view); await wait(200); }
  check('Switching HLD / LLD / Unified keeps the challenge brief open', await rightTab() === 'Challenge');

  await selectNode('api');
  check('Selecting a component opens the inspector, with the brief one click away', await rightTab() === 'Inspector' && await page.$('.fz-cstrip') !== null);
  await clickText('.fz-node-tabs button', 'Component'); await wait(150);
  await setField('Instances', '14'); await clickBlank();
  const h = await history();
  check('Configuration edits in a challenge are undoable', /Undo Edit Profile API · instances/.test(h[0].label), h[0].label);
  await page.evaluate(() => [...document.querySelectorAll('.fz-cstrip button')].find(button => /Brief/.test(button.textContent))?.click()); await wait(150);
  check('The strip returns to the brief', await rightTab() === 'Challenge');

  // ── Submit (PASS) ──────────────────────────────────────────────────────────
  const passText = await submit();
  check('Submission is graded on the benchmark: PASS', /PASS/.test(passText) && /Runtime/.test(passText) && /Architecture/.test(passText));
  await shot('02-pass');
  await closeResults();
  check('Grading leaves the practice run and its results in place', await practiceFingerprint() === practice && /last run · outdated/.test(await page.$eval('.fz-brief', element => element.textContent)), `${practice} → ${await practiceFingerprint()}`);
  check('Retry keeps the submitted architecture', (await draftConfig('slow-api', 'api')).instances === '14');
  let stored = await progress(); const passedAttempt = JSON.stringify(stored.challenges['slow-api'].history[0]);
  check('The attempt is saved as solved with points', stored.challenges['slow-api'].solved === true && stored.challenges['slow-api'].attempts === 1);

  // Undo after submitting changes the architecture, never the submission.
  await clickBlank(); await press('Control+z');
  check('Undo after submitting reverts the edit', (await draftConfig('slow-api', 'api')).instances === '2');
  stored = await progress();
  check('…and the recorded attempt is unchanged', JSON.stringify(stored.challenges['slow-api'].history[0]) === passedAttempt && stored.challenges['slow-api'].solved === true);
  check('The brief stays open through undo', await rightTab() === 'Challenge');

  // ── Submit (FAIL) ──────────────────────────────────────────────────────────
  const failText = await submit();
  check('A failing design is graded FAIL with amounts missed', /FAIL/.test(failText) && /missed by/.test(failText));
  check('Results explain the main bottleneck with evidence', /Main bottleneck/.test(await page.$eval('.fz-finding.is-main', element => getComputedStyle(element.querySelector('b'), '::before').content + element.textContent)) && /busy over the run/.test(failText));
  check('Results compare with the previous and best attempts', /vs previous/.test(failText) && /vs best/.test(failText));
  await shot('03-fail');
  await closeResults();
  stored = await progress();
  check('A failed attempt never revokes a solve', stored.challenges['slow-api'].solved === true && stored.challenges['slow-api'].attempts === 2);
  const listed = await page.$$eval('.fz-attempts li', items => items.map(item => item.textContent));
  check('The brief lists both attempts, newest first', listed.length === 2 && /#2 FAIL/.test(listed[0]) && /#1 PASS/.test(listed[1]), listed.join(' | '));

  // ── Attempt history: snapshots, review, reproduce, load, compare ───────────
  const recordOf = async number => (await progress()).challenges['slow-api'].history.find(entry => entry.number === number)?.record;
  const record1 = await recordOf(1); const record1Json = JSON.stringify(record1);
  const apiIn = record => record?.architecture.nodes.find(node => node.id === 'api');
  check('Each attempt stores a versioned architecture snapshot with its benchmark, seed and criteria',
    record1?.schema === 'flowzen.attempt' && record1.architecture.version === 1 && apiIn(record1)?.config.instances === '14' && record1.architecture.edges.length === 1
    && record1.benchmark.seed === 101 && record1.benchmark.rps === 300 && record1.criteriaDefinitions.length > 0 && record1.result.passed === true);
  check('Later edits (the undo to 2 instances) did not reach attempt #1’s snapshot', apiIn(record1)?.config.instances === '14' && (await draftConfig('slow-api', 'api')).instances === '2' && apiIn(await recordOf(2))?.config.instances === '2');

  await page.click('button[aria-label="Review attempt 1"]'); await page.waitForSelector('.fz-attempts-dialog'); await wait(200);
  const review = await page.$eval('.fz-attempts-dialog', element => element.textContent);
  check('Reviewing an attempt shows it as a historical result with its original architecture', /Historical result/.test(review) && /Instances: 14 slots/.test(review) && /Seed101/.test(review.replace(/\s/g, '')));
  check('…with measurements and heuristic explanations labelled separately', /simulator output for this run/.test(review) && /heuristic · derived from the measurements above/.test(review));
  await shot('03-review');
  await clickText('.fz-attempts-dialog button', 'Reproduce run'); await page.waitForSelector('.fz-repro', { timeout: 30000 });
  check('Reproducing re-runs the original benchmark and matches the record', /Every measurement and criterion result matches the recorded attempt/.test(await page.$eval('.fz-repro', element => element.textContent)));
  check('Reproducing does not touch the practice run', await practiceFingerprint() === practice);

  await clickText('.fz-attempts-dialog button', 'Load as new draft'); await wait(150);
  check('Loading over a different draft asks for confirmation first', await page.$('.fz-confirm') !== null && (await draftConfig('slow-api', 'api')).instances === '2');
  await clickText('.fz-confirm button', 'Keep current draft'); await wait(150);
  check('Declining keeps the current draft', await page.$('.fz-confirm') === null && (await draftConfig('slow-api', 'api')).instances === '2');
  await clickText('.fz-attempts-dialog button', 'Load as new draft'); await wait(150);
  await clickText('.fz-confirm button', 'Replace draft'); await wait(300);
  const afterLoad = await history();
  check('Confirming loads the snapshot as a new editable draft', await page.$('.fz-attempts-dialog') === null && (await draftConfig('slow-api', 'api')).instances === '14' && /Undo Load attempt #1 as draft/.test(afterLoad[0].label), afterLoad[0].label);
  check('…and leaves attempt #1 itself unchanged', JSON.stringify(await recordOf(1)) === record1Json);
  await clickBlank(); await press('Control+z');
  check('Undo restores the draft that was replaced', (await draftConfig('slow-api', 'api')).instances === '2');

  await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].find(button => /Compare attempts/.test(button.textContent))?.click());
  await page.waitForSelector('.fz-attempts-dialog'); await wait(200);
  const compare = await page.$eval('.fz-attempts-dialog', element => element.textContent);
  check('Comparison attributes the measured change to the single input that changed', /One simulation input changed/.test(compare) && /Profile API · Instances: 14 → 2/.test(compare));
  check('Comparison separates measured differences from structural ones', /Measured\s*simulator output of each attempt’s own run/.test(compare) && /Structural\s*what changed in the design, not what caused a result/.test(compare) && /Latency p95/.test(compare));
  await shot('04-compare');
  await page.keyboard.press('Escape'); await wait(150);
  check('Reviewing and comparing never changed a stored attempt', JSON.stringify(await recordOf(1)) === record1Json);

  // ── Related designs (LLD) ──────────────────────────────────────────────────
  await page.evaluate(() => [...document.querySelectorAll('.fz-brief .fz-chip.is-design')].find(button => /Application Server/.test(button.textContent))?.click()); await wait(800);
  check('Related designs open the component’s low-level design', await page.$eval('[aria-label="Design view"] [aria-checked="true"]', element => element.textContent) === 'LLD' && await page.$('.fz-lld') !== null);
  await clickText('[aria-label="Design view"] button', 'Unified'); await wait(200);

  // ── Drafts and histories are per challenge ─────────────────────────────────
  await selectNode('api'); await clickText('.fz-node-tabs button', 'Component'); await wait(100);
  const name = await page.$('.fz-field input'); await name.click({ clickCount: 3 }); await page.keyboard.type('Profile Service');
  await page.evaluate(() => [...document.querySelectorAll('.fz-rtabs button')].find(button => button.textContent === 'Challenge')?.click());
  // Leave immediately, inside the autosave delay.
  await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].find(button => /All challenges/.test(button.textContent))?.click());
  await page.waitForSelector('.fz-catalog');
  stored = await progress();
  check('Leaving a challenge saves its draft immediately', stored.drafts['slow-api']?.nodes.find(node => node.id === 'api')?.label === 'Profile Service');
  await page.evaluate(() => [...document.querySelectorAll('.fz-ccard button')].find(button => button.getAttribute('aria-label') === 'Start Cache It Right')?.click());
  await page.waitForSelector('.fz-brief'); await wait(300);
  check('Another challenge opens with its own architecture and empty history', await page.$('.react-flow__node[data-id="orders-db"]') !== null && (await history()).every(button => button.disabled));
  await selectNode('api'); await clickText('.fz-node-tabs button', 'Component'); await wait(100);
  await setField('Instances', '9'); await clickBlank();
  await page.evaluate(() => [...document.querySelectorAll('.fz-rtabs button')].find(button => button.textContent === 'Challenge')?.click());
  await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].find(button => /All challenges/.test(button.textContent))?.click());
  await page.waitForSelector('.fz-catalog');
  await page.evaluate(() => [...document.querySelectorAll('.fz-ccard button')].find(button => /The Slow API/.test(button.getAttribute('aria-label')))?.click());
  await page.waitForSelector('.fz-brief'); await wait(300);
  check('Returning restores this challenge’s draft, untouched by the other', (await page.$eval('.react-flow__node[data-id="api"]', element => element.textContent)).includes('Profile Service') && await page.$('.react-flow__node[data-id="orders-db"]') === null);
  const back = await history();
  check('…and its own undo history', /Undo Rename Profile API/.test(back[0].label), back[0].label);
  stored = await progress();
  check('The other challenge’s draft is intact', stored.drafts['cache-it-right']?.nodes.find(node => node.id === 'api')?.config.instances === '9');

  await page.reload({ waitUntil: 'networkidle0' });
  stored = await progress();
  check('Progress, attempts and drafts persist across reload', stored.challenges['slow-api'].attempts === 2 && stored.drafts['slow-api'] && stored.drafts['cache-it-right']);
  check('Attempt records survive a reload unchanged', JSON.stringify(stored.challenges['slow-api'].history.find(entry => entry.number === 1).record) === record1Json);

  // An attempt saved before snapshots existed is shown as summary-only, never with the current architecture.
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('flowzen-challenges-v1'));
    const legacy = { at: Date.now() - 60_000, passed: false, criteriaPassed: 3, criteriaTotal: 7, criteria: [], p50: 12, p95: 900, p99: 1200, successThroughput: 210, errorRate: 40 };
    data.challenges['cache-it-right'] = { attempts: 1, solved: false, last: legacy, best: legacy, history: [legacy] };
    localStorage.setItem('flowzen-challenges-v1', JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await clickText('.fz-nav button', 'Challenges'); await page.waitForSelector('.fz-catalog');
  await page.evaluate(() => [...document.querySelectorAll('.fz-ccard button')].find(button => /Cache It Right/.test(button.getAttribute('aria-label')))?.click());
  await page.waitForSelector('.fz-brief'); await wait(300);
  await page.click('button[aria-label="Review attempt 1"]'); await page.waitForSelector('.fz-attempts-dialog'); await wait(150);
  const legacyText = await page.$eval('.fz-attempts-dialog', element => element.textContent);
  check('A legacy attempt without a snapshot is summary-only and cannot be loaded', /No architecture snapshot/.test(legacyText) && /p95 900 ms/.test(legacyText) && !/Load as new draft/.test(legacyText) && !/Submitted architecture/.test(legacyText));
  await page.keyboard.press('Escape');

  // ── Responsive catalog ──────────────────────────────────────────────────────
  await clickText('.fz-nav button', 'Challenges'); await page.waitForSelector('.fz-catalog');
  for (const width of [820, 390]) {
    await page.setViewport({ width, height: 900 }); await wait(300);
    check(`The catalog fits a ${width} px window without horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  check('On narrow screens the filters sit behind a Filters button', await page.$eval('.fz-filters', element => getComputedStyle(element).display) === 'none');
  await page.evaluate(() => [...document.querySelectorAll('.fz-results-bar button')].find(button => /Filters/.test(button.textContent))?.click()); await wait(150);
  check('…which opens them', await page.$eval('.fz-filters', element => getComputedStyle(element).display) !== 'none');
  await page.setViewport({ width: 1440, height: 900 });
} catch (error) {
  await finish(error);
}
await finish();
