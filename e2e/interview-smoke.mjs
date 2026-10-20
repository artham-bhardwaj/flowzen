// Browser smoke test for the Interview section: the complete workflow from opening an interview to reviewing results,
// reopening history and starting a new session; plus mock-mode timing, reload persistence and isolation.
// Run with `npm run test:browser` (see e2e/harness.mjs).
import { startSuite, wait } from './harness.mjs';

const { page, check, finish, shot, clickText } = await startSuite('interview');
try {
  page.on('dialog', dialog => dialog.accept());
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-interviews-v1') ?? 'null'));
  const clickIn = (selector, pattern) => page.evaluate((selector, source) => { const target = [...document.querySelectorAll(selector)].find(element => new RegExp(source).test(element.textContent)); target?.click(); return Boolean(target); }, selector, pattern.source);
  const typeInto = async (selector, value) => { const element = await page.$(selector); await element.click({ clickCount: 3 }); await page.keyboard.type(value); };
  const typeLabelled = async (label, value) => {
    const handle = await page.evaluateHandle(label => [...document.querySelectorAll('.fz-iv-answer')].find(entry => entry.querySelector('span')?.textContent === label)?.querySelector('textarea'), label);
    await handle.click(); await page.keyboard.type(value);
  };
  const stage = async name => { await clickIn('.fz-iv-stages button', new RegExp(name)); await wait(250); };
  const text = selector => page.$eval(selector, element => element.textContent);
  const challengesBefore = await page.evaluate(() => localStorage.getItem('flowzen-challenges-v1'));
  const fits = async () => { let ok = true; for (const width of [1440, 390]) { await page.setViewport({ width, height: 900 }); await wait(300); ok = ok && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth); } await page.setViewport({ width: 1440, height: 900 }); await wait(200); return ok; };

  // ── Dashboard and library ───────────────────────────────────────────────────
  await clickText('.fz-nav button', 'Interview'); await page.waitForSelector('.fz-iv'); await wait(300);
  const navLabels = await page.$$eval('.fz-nav button', buttons => buttons.map(button => button.textContent));
  check('Interview is in the primary navigation', JSON.stringify(navLabels) === JSON.stringify(['Learn', 'Playground', 'Interview', 'Challenges']), navLabels.join(','));
  const dashboard = await text('.fz-iv');
  check('A new user sees an honest empty state, with no fabricated scores', /No completed interviews yet/.test(dashboard) && !/Average score/.test(dashboard));
  await shot('01-dashboard-empty');
  const count = (await page.$$('.fz-card-grid .fz-ccard')).length;
  check('The dashboard is a catalog of at least 12 problems with the shared hero, filters and results bar', count >= 12 && /Tell me more/.test(await text('.fz-hero')) && (await page.$$('.fz-filters .fz-facet')).length === 4 && /12 results/.test(await text('.fz-results-bar h2')), String(count));
  await typeInto('.fz-filters input[type="search"]', 'shortener'); await wait(200);
  check('Search filters the library', (await page.$$('.fz-card-grid .fz-ccard')).length === 1);
  await page.evaluate(() => [...document.querySelectorAll('.fz-facet label')].find(label => label.querySelector('.fz-facet__label')?.textContent === 'Expert')?.querySelector('input')?.click()); await wait(150);
  check('Filters combine (no match shows a clear state)', (await page.$$('.fz-card-grid .fz-ccard')).length === 0 && /No problems match/.test(await text('.fz-iv')));
  await clickIn('.fz-catalog__empty button', /Clear filters/); await wait(150);
  await shot('02-library');
  await page.click('.fz-ccard button[aria-label="Open URL Shortener"]'); await page.waitForSelector('.fz-iv-detail');
  check('A problem shows its statement and both modes', /bit\.ly/.test(await text('.fz-iv-detail')) && /Mock interview/.test(await text('.fz-iv-detail')));

  // ── Practice session: requirements ──────────────────────────────────────────
  await clickIn('.fz-iv-detail button', /Start practice/); await page.waitForSelector('.fz-iv-session'); await wait(300);
  check('The session shows the problem statement and nine stages, including changing requirements', /bit\.ly/.test(await text('.fz-iv-statement')) && (await page.$$('.fz-iv-stages button')).length === 9 && /Changing requirements/.test(await text('.fz-iv-stages')));
  await typeLabelled('Functional requirements', 'Users can shorten a long URL into a short code\nOpening the short link will redirect to the original URL\nShow click analytics per link');
  await typeLabelled('Non-functional requirements', 'Redirect latency p95 under 50 ms\nHigh availability for redirects\nCodes must be unique and not guessable\nRead-heavy: about 100 reads per write');
  await typeLabelled('Explicitly excluded', 'Editing destinations, billing');
  check('Answers in a stage do not reveal clarification answers', !/100 million new links per month/.test(await text('.fz-iv-main')));
  for (const question of [/How many new links/, /read- or write-heavy/, /How long must links/, /What analytics/]) await clickIn('.fz-iv-clarify li', question).then(() => page.evaluate(source => [...document.querySelectorAll('.fz-iv-clarify li')].find(item => new RegExp(source).test(item.textContent))?.querySelector('button')?.click(), question.source));
  await wait(200);
  check('Asking a clarifying question reveals only that answer', /100 million new links per month/.test(await text('.fz-iv-main')) && (await page.$$('.fz-iv-clarify li.is-asked')).length === 4);
  await clickIn('.fz-iv-hints button', /Show hint 1/); await wait(150);
  check('Practice hints are revealed on request', (await page.$$('.fz-iv-hints li')).length === 1);
  await shot('03-requirements');

  // ── Estimation ──────────────────────────────────────────────────────────────
  await stage('Capacity estimation');
  for (const [label, value] of [['New links per day', '3.3 million'], ['Redirects per new link (read:write)', '100'], ['Bytes per stored link', '500'], ['Average creations per second', '38'], ['Average redirects per second', '3800'], ['Storage after five years', '3000']]) await typeInto(`.fz-iv-estimates input[aria-label="${label}"]`, value);
  await clickIn('.fz-iv-main button', /Submit estimates and compare/); await wait(200);
  check('After submitting estimates, reference assumptions and tolerances are shown', /Reference considerations/.test(await text('.fz-iv-main')) && /÷\/× 3/.test(await text('.fz-iv-main')));

  // ── API and data model ──────────────────────────────────────────────────────
  await stage('API design');
  await clickIn('.fz-iv-main button', /Add endpoint/); await clickIn('.fz-iv-main button', /Add endpoint/); await wait(150);
  const cards = await page.$$('.fz-iv-card');
  await (await cards[0].$('select')).select('POST'); await (await cards[0].$('input[aria-label="Path"]')).type('/v1/urls');
  await (await cards[0].$$('textarea'))[0].type('long url, optional alias'); await (await cards[0].$$('textarea'))[1].type('201 with short code'); await (await cards[0].$$('textarea'))[2].type('400 invalid url, 409 alias taken');
  await (await cards[0].$('input[type="checkbox"]')).click();
  await (await cards[1].$('input[aria-label="Path"]')).type('/{code}');
  await (await cards[1].$$('textarea'))[1].type('302 redirect with Location header'); await (await cards[1].$$('textarea'))[2].type('404 not found, 410 expired');
  await stage('Data model');
  await clickIn('.fz-iv-main button', /Add entity/); await wait(150);
  await typeInto('.fz-iv-card input[aria-label="Entity name"]', 'Link'); await typeInto('.fz-iv-card input[aria-label="Primary identifier"]', 'short code');
  const entityAreas = await page.$$('.fz-iv-card textarea');
  await entityAreas[0].type('code, long url, owner, created at, expires at'); await entityAreas[2].type('primary key on code, unique'); await entityAreas[3].type('lookup by short code'); await entityAreas[4].type('mappings are immutable; click counts are eventually consistent');

  // ── High-level design on the canvas ─────────────────────────────────────────
  await stage('High-level design');
  await clickIn('.fz-iv-main button', /Start designing on the canvas/); await page.waitForSelector('.react-flow__node'); await wait(500);
  check('The canvas opens with only a client: no reference architecture is pre-built', (await page.$$('.react-flow__node')).length === 1);
  check('The interview brief stays beside the canvas', /bit\.ly/.test(await text('.fz-iv-brief')));
  const addAt = async (label, x, y) => {
    await page.click(`button[aria-label="Add ${label}"]`); await wait(250);
    const box = await page.$eval('.react-flow__node.selected', element => { const r = element.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 14, id: element.dataset.id }; });
    await page.mouse.move(box.x, box.y); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + (x - box.x) * i / 10, box.y + (y - box.y) * i / 10); await wait(12); } await page.mouse.up(); await wait(200);
    return box.id;
  };
  const pane = await page.$eval('.react-flow__pane', element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  // Make room: zoom out a little so five components fit in a row.
  await page.click('.react-flow__pane'); await wait(100);
  const lb = await addAt('Load Balancer', pane.x + pane.w * 0.30, pane.y + pane.h * 0.25);
  const app = await addAt('Application Server', pane.x + pane.w * 0.30, pane.y + pane.h * 0.55);
  const cache = await addAt('Distributed Cache', pane.x + pane.w * 0.62, pane.y + pane.h * 0.25);
  const db = await addAt('NoSQL Database', pane.x + pane.w * 0.62, pane.y + pane.h * 0.55);
  const handle = (id, kind) => page.$eval(`.react-flow__node[data-id="${id}"] .react-flow__handle.${kind}`, element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const connect = async (from, to) => { const a = await handle(from, 'source'); const b = await handle(to, 'target'); await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12); await wait(14); } await page.mouse.up(); await wait(200); };
  await connect('users', lb); await connect(lb, app); await connect(app, cache); await connect(cache, db);
  check('Components and connections are added on the real canvas', (await page.$$('.react-flow__node')).length === 5 && (await page.$$('.react-flow__edge')).length === 4);
  // Configure the server's instances in the inspector.
  await page.click(`.react-flow__node[data-id="${app}"]`); await wait(200);
  await clickText('.fz-rtabs button', 'Inspector'); await wait(150);
  check('The inspector shows alternatives for a selected component', /Why use this\?/.test(await text('.fz-inspector')) && !/Try Container Service/.test(await text('.fz-inspector')));
  const instances = await page.evaluateHandle(() => [...document.querySelectorAll('.fz-field')].find(field => field.querySelector('span')?.textContent.startsWith('Instances'))?.querySelector('input'));
  await instances.click({ clickCount: 3 }); await page.keyboard.type('16'); await wait(700);
  await clickText('.fz-rtabs button', 'Interview'); await wait(200);
  const notes = { [lb]: 'Load balancer for redundancy: two or more servers with health checks, so one failure is not a single point of failure.', [app]: 'Stateless app servers that scale horizontally behind the load balancer.', [cache]: 'Read-heavy redirects are hot and repeated; the cache keeps a high hit ratio and offloads the store.', [db]: 'Key-value store: every access is a lookup by key, durable source of truth with replication.' };
  const briefAreas = await page.$$('.fz-iv-brief .fz-iv-decisions li');
  for (const item of briefAreas) { const name = await item.$eval('button', element => element.textContent); const id = Object.keys(notes).find(key => name.toLowerCase().includes((key.split('-')[0] === 'loadBalancer' ? 'load' : key.split('-')[0] === 'server' ? 'application' : key.split('-')[0] === 'distributedCache' ? 'distributed' : 'nosql'))); if (id) await (await item.$('textarea')).type(notes[id]); }
  await wait(600);
  await shot('04-canvas');
  let stored = await store();
  check('The canvas autosaves into the interview draft, with decision notes', stored.drafts[0].architecture.nodes.length === 5 && Object.values(stored.drafts[0].decisions).filter(Boolean).length === 4);
  check('Challenge progress is untouched', await page.evaluate(() => localStorage.getItem('flowzen-challenges-v1')) === challengesBefore);
  await clickIn('.fz-iv-brief button', /Back to the interview/); await page.waitForSelector('.fz-iv-session'); await wait(300);
  check('Returning keeps the interview at its design stage', /High-level design/.test(await text('.fz-iv-stagehead')) && (await page.$$('.fz-iv-decisions li')).length === 4);
  await clickIn('.fz-iv-main button', /Run the benchmark on my design/);
  await page.waitForFunction(() => /Measured/.test(document.querySelector('.fz-iv-evidence')?.textContent ?? ''), { timeout: 60_000 }); await wait(700);
  stored = await store();
  check('The isolated benchmark measures the design and records evidence', stored.drafts[0].benchmark?.complete === true && stored.drafts[0].benchmark.successPct >= 99 && stored.drafts[0].benchmark.p95 <= 50, JSON.stringify(stored.drafts[0].benchmark));
  const whiteboard = await text('.fz-iv-wb');
  check('The whiteboard review labels findings as structural facts, measurements or unverified risks', /Structural fact/.test(whiteboard) && /Measured/.test(whiteboard) && /Reasoned risk \(unverified\)/.test(whiteboard) && /Requirement coverage/.test(whiteboard) && /What the simulator does not model/.test(whiteboard));
  check('The review points at the measured bottleneck of this design', /busiest component/.test(whiteboard), whiteboard.slice(0, 200));
  // Explain one major decision in full.
  await page.evaluate(() => { const item = [...document.querySelectorAll('.fz-iv-decisions li')].find(li => /Distributed Cache/.test(li.textContent)); item.querySelector('details summary').click(); });
  await wait(150);
  const explainField = async (label, value) => { const area = await page.evaluateHandle(label => { const item = [...document.querySelectorAll('.fz-iv-decisions li')].find(li => /Distributed Cache/.test(li.textContent)); return [...item.querySelectorAll('.fz-iv-explain .fz-iv-answer')].find(entry => entry.querySelector('span')?.textContent === label)?.querySelector('textarea'); }, label); await area.type(value); };
  await explainField('Problem it solves', 'Redirect latency and read-heavy load on the link store.');
  await explainField('Alternatives considered', 'Read Replica would also offload reads but each read costs more.');
  await explainField('Trade-offs accepted', 'More operational complexity and stale entries until the TTL expires.');
  await explainField('Failure modes', 'If the cache fails every read falls back to the store and can overload it.');
  await explainField('Evidence or assumptions', 'At 3800 redirects per second most traffic never reaches the store.');
  await wait(500);
  check('The reasoning rubric checks each part of the explanation and grounds numbers in the user’s estimates', /6 of 6 parts/.test(await text('.fz-iv-decisions')) && /matches your estimate/.test(await text('.fz-iv-rubric')), await text('.fz-iv-rubric'));
  await clickIn('.fz-iv-checkpoints button', /Save checkpoint/); await wait(300);
  stored = await store();
  check('A manual checkpoint saves a copy of the design', stored.drafts[0].checkpoints.length === 1 && stored.drafts[0].checkpoints[0].architecture.nodes.length === 5);

  // ── Deep dives and follow-ups ───────────────────────────────────────────────
  await stage('Deep dives');
  const prompts = await page.$$('.fz-iv-prompt textarea');
  await prompts[0].type('Use base62 encoding of counter ranges handed to each server; insert with a unique constraint and retry on collision. Seven characters give enough combinations.');
  await prompts[1].type('Read-heavy redirects are hot; the cache holds code to URL with long TTL because mappings are immutable, giving a high hit ratio that offloads the database; LRU eviction sizes the working set.');
  await clickIn('.fz-iv-prompt button', /Show reference considerations/); await wait(150);
  check('Practice references appear after an answer is recorded', /One reasonable answer/.test(await text('.fz-iv-main')));
  await stage('Trade-offs and failures');
  const asked = await page.$$eval('.fz-iv-followup .fz-iv-prompt header b', items => items.map(item => item.textContent));
  check('Follow-ups adapt to the design: caching questions appear, "why no cache" does not', asked.includes('What is cached') && !asked.includes('Why no cache?') && asked.includes('Ten times the traffic'), asked.join(' | '));
  check('Each follow-up says why it is asked, and testable ones are marked', /Asked because/.test(await text('.fz-iv-main')) && (await page.$$('.fz-iv-scenario')).length > 0);
  const answerFollowUp = async (title, answer) => { const area = await page.evaluateHandle(title => [...document.querySelectorAll('.fz-iv-followup')].find(item => item.querySelector('header b')?.textContent === title)?.querySelector('textarea'), title); await area.type(answer); await wait(200); };
  const submitFollowUp = async title => { await page.evaluate(title => [...document.querySelectorAll('.fz-iv-followup')].find(item => item.querySelector('header b')?.textContent === title)?.querySelector('.fz-btn--primary')?.click(), title); await wait(300); };
  check('Each follow-up shows the rule that fired', /Rule: your design includes/.test(await text('.fz-iv-main')));
  await answerFollowUp('What is cached', 'The cache key is the short code; links are hot and popular so most reads repeat, and the working set fits in memory with a TTL.');
  await wait(300);
  check('Typing an answer does not branch yet', !(await page.$$eval('.fz-iv-followup .fz-iv-prompt header b', items => items.map(item => item.textContent))).includes('Cache misses'));
  await submitFollowUp('What is cached');
  const branched = await page.$$eval('.fz-iv-followup .fz-iv-prompt header b', items => items.map(item => item.textContent));
  check('Submitting a follow-up branches to the next question, and shows where it can lead', branched.includes('Cache misses') && /Where this can lead/.test(await text('.fz-iv-main')), branched.join(' | '));
  await answerFollowUp('Cache misses', 'Cache-aside: on a miss the server will load from the database and populate the cache entry with a TTL for later reads.');
  await submitFollowUp('Cache misses');
  const probed = await page.$$eval('.fz-iv-followup .fz-iv-prompt header b', items => items.map(item => item.textContent));
  check('An answer that leaves out a consideration triggers a probing question', probed.includes('A hot key expires') && /without covering protection against stampedes/.test(await text('.fz-iv-main')), probed.join(' | '));
  check('Held-back questions are listed with the reason', /Questions held back/.test(await text('.fz-iv-main')));
  await answerFollowUp('Ten times the traffic', 'The bottleneck becomes the store and the cache; scale out horizontally, add cache nodes and partition the store; verify with a load test and measure utilization.');
  await submitFollowUp('Ten times the traffic');
  await page.evaluate(() => [...document.querySelectorAll('.fz-iv-followup')].find(item => item.querySelector('header b')?.textContent === 'Ten times the traffic')?.querySelector('.fz-iv-scenario button')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('.fz-iv-followup')].some(item => item.querySelector('header b')?.textContent === 'Ten times the traffic' && /Measured/.test(item.textContent)), { timeout: 60_000 }); await wait(700);
  stored = await store();
  check('A testable scenario runs on the user’s design and is stored as measured evidence', Boolean(stored.drafts[0].scenarioRuns['traffic-10x']));
  await shot('05-followups');

  // ── Reload keeps everything ─────────────────────────────────────────────────
  const beforeReload = JSON.stringify((await store()).drafts[0].followUps);
  await page.reload({ waitUntil: 'networkidle0' });
  await clickText('.fz-nav button', 'Interview'); await page.waitForSelector('.fz-iv'); await wait(300);
  check('An unfinished session survives a reload and can be continued', /Continue/.test(await text('.fz-iv')) && JSON.stringify((await store()).drafts[0].followUps) === beforeReload);
  await clickIn('.fz-practice button', /Continue/); await page.waitForSelector('.fz-iv-session'); await wait(300);

  // ── Changing requirements: original kept, revision compared by measurement ──
  await stage('Changing requirements');
  await page.evaluate(() => [...document.querySelectorAll('.fz-iv-change')].find(card => /Five times the redirect traffic/.test(card.textContent))?.querySelector('.fz-btn--primary')?.click()); await wait(300);
  stored = await store();
  const baselineId = stored.drafts[0].changes['campaign-5x']?.baselineId;
  check('Taking on a change keeps the original design as a checkpoint', Boolean(baselineId) && stored.drafts[0].checkpoints.find(cp => cp.id === baselineId)?.kind === 'change-before' && /national campaign/.test(await text('.fz-iv-main')));
  const changeCard = async pattern => page.evaluate(source => [...document.querySelectorAll('.fz-iv-change')].find(card => new RegExp(source).test(card.textContent))?.textContent ?? '', pattern.source);
  const clickInChange = (pattern, button) => page.evaluate((source, button) => { const card = [...document.querySelectorAll('.fz-iv-change')].find(card => new RegExp(source).test(card.textContent)); const target = [...card.querySelectorAll('button')].find(b => new RegExp(button).test(b.textContent)); target?.click(); return Boolean(target); }, pattern.source, button.source);
  await clickInChange(/Five times/, /Save revised design/); await wait(300);
  await clickInChange(/Five times/, /Run on original/);
  await page.waitForFunction(() => [...document.querySelectorAll('.fz-iv-change')].some(card => /Five times/.test(card.textContent) && /Original/.test(card.textContent) && /p95 [\d.]+ ms/.test(card.querySelector('.fz-iv-compare')?.textContent ?? '')), { timeout: 60_000 }); await wait(500);
  await clickInChange(/Five times/, /Run on revised/);
  await page.waitForFunction(() => { const card = [...document.querySelectorAll('.fz-iv-change')].find(card => /Five times/.test(card.textContent)); return (card?.querySelector('.fz-iv-compare')?.textContent.match(/p95 [\d.]+ ms/g) ?? []).length >= 2; }, { timeout: 60_000 }); await wait(700);
  stored = await store();
  const runs = stored.drafts[0].changes['campaign-5x'].runs;
  check('The change runs on the original and the revised design in isolation, and both are measured', runs.original?.complete && runs.revised?.complete && /10,000 req\/s/.test(runs.original.label), JSON.stringify(runs).slice(0, 200));
  check('The comparison separates structural differences from measured results', /What changed in the design/.test(await changeCard(/Five times/)) && /identical to the original/.test(await changeCard(/Five times/)) && /Measured under the change/.test(await changeCard(/Five times/)));
  await page.evaluate(() => { const card = [...document.querySelectorAll('.fz-iv-change')].find(card => /Five times/.test(card.textContent)); card.querySelector('textarea').focus(); });
  await page.keyboard.type('The bottleneck at 5x is the busiest component by utilization; scale out with more instances and cache nodes to raise the hit ratio offload, then verify with a load test of p95.');
  await clickInChange(/Five times/, /Submit response/); await wait(300);
  check('Hypothetical changes are labelled as such', /Hypothetical/.test(await changeCard(/Links become editable/)));

  // ── Final review and evaluation ────────────────────────────────────────────
  await stage('Final review');
  await typeLabelled('Final architecture', 'Users reach stateless servers through a load balancer; a distributed cache sits in front of a key-value store holding immutable code to URL mappings.');
  await typeLabelled('Most important design decisions', 'Caching because reads dominate, key-value storage because access is by code, base62 codes from counter ranges, and 302 redirects to keep analytics.');
  await typeLabelled('Trade-offs and alternatives', 'A 301 redirect would reduce load but lose analytics; random codes avoid guessing but need collision checks; SQL would also work at this size.');
  await clickIn('.fz-iv-side__actions button', /Finish and evaluate/);
  await page.waitForSelector('.fz-iv-report', { timeout: 20_000 }); await wait(300);
  const report = await text('.fz-iv-report');
  check('The report shows an overall score, competencies, evidence bases and the reference design', /automatic score/.test(report) && /Competencies/.test(report) && /Measured/.test(report) && /Keyword-based/.test(report) && /One reasonable design, not the only correct answer/.test(report));
  check('The report states it is rule-based, not an AI interviewer', /rule-based evaluation, not an AI interviewer/.test(report));
  check('It compares decisions with the reference, accepting alternatives', /Your decisions compared with the reference/.test(report) && /Same choice as the reference|documented alternative/.test(report));
  check('It records hints and references used', /Hints used: 1/.test(report) && /Reference considerations viewed before submitting: [1-9]/.test(report));
  check('The report includes the whiteboard review, the reasoning rubric and the requirement change', /Whiteboard review/.test(report) && /Reasoning behind major decisions/.test(report) && /Requirement changes/.test(report) && /Five times the redirect traffic/.test(report));
  check('Judgement calls are marked for manual review, and the reference is versioned with alternatives', /Needs your review/.test(report) && /Reference design\s*version 2/.test(report) && /When an alternative is the better choice/.test(report) && /Low-level design considerations/.test(report));
  await shot('06-report');
  check('The report fits 1440 px and 390 px without horizontal scrolling, including the reasoning rubric', await fits());
  stored = await store();
  const record = stored.records[0];
  check('The completed session is stored as a record with snapshot, rubric version and evidence; the draft is gone', stored.drafts.length === 0 && record.session.architecture.nodes.length === 5 && record.version === 2 && record.evaluatorVersion === 2 && record.definitionVersion === 2 && record.referenceVersion === 2 && record.session.checkpoints.length >= 3 && record.session.events.length > 10 && record.evaluation.criteria.every(criterion => criterion.evidence.length > 0));
  const recordJson = JSON.stringify(record);
  // Correct an automatic assessment: stored separately, the record never changes.
  await page.evaluate(() => [...document.querySelectorAll('.fz-iv-criterion')].find(item => /Final summary/.test(item.textContent))?.querySelector('.fz-link')?.click()); await wait(150);
  await page.evaluate(() => { const form = document.querySelector('.fz-iv-correct'); const select = form.querySelector('select'); select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.type('.fz-iv-correct input[aria-label="Reason for the correction"]', 'All sections were answered in detail.');
  await clickIn('.fz-iv-correct button', /Save correction/); await wait(300);
  stored = await store();
  check('A correction is recorded separately and the record is unchanged', JSON.stringify(stored.records[0]) === recordJson && stored.corrections[record.id]?.length === 1 && /with your corrections/.test(await text('.fz-iv-report')));

  // ── Playback: timeline, checkpoints, load a checkpoint as a new draft ───────
  await clickIn('.fz-iv-report button', /Play back this interview/); await page.waitForSelector('.fz-iv-playback'); await wait(300);
  const playback = await text('.fz-iv-playback');
  check('Playback shows time per stage, the timeline, answers, follow-ups with reasons, the change and measurements', /Time per stage/.test(playback) && /Timeline/.test(playback) && /Asked: What is cached/.test(playback) && /Why it was asked/.test(playback) && /Requirement changes/.test(playback) && /Measured results/.test(playback) && /Final score and competencies/.test(playback));
  await clickIn('.fz-iv-playback .fz-chips button', /Changes|Requirement changes/); await wait(150);
  check('The timeline can be filtered', (await page.$$('.fz-iv-timeline li')).length >= 1 && (await page.$$eval('.fz-iv-timeline li', items => items.every(item => /change/.test(item.className)))));
  await clickIn('.fz-iv-playback button', /View the original/); await wait(200);
  check('A historical checkpoint can be inspected as a diagram', Boolean(await page.$('.fz-iv-playback .fz-diagram svg')) && /Original design, before/.test(await text('.fz-iv-playback .fz-diagram')));
  await shot('07-playback');
  check('Playback fits 1440 px and 390 px without horizontal scrolling', await fits());
  await clickIn('.fz-iv-playback button', /Load this checkpoint as a new draft/); await page.waitForSelector('.fz-iv-session'); await wait(300);
  stored = await store();
  check('Loading a checkpoint creates a new editable draft; the record is untouched', stored.drafts.length === 1 && stored.drafts[0].origin?.checkpointId === baselineId && stored.drafts[0].architecture.nodes.length === 5 && JSON.stringify(stored.records[0]) === recordJson);
  await clickIn('.fz-iv-side__actions button', /Discard/); await page.waitForSelector('.fz-catalog.fz-iv'); await wait(200);

  // ── History, reopening and a new session ───────────────────────────────────
  await clickIn('.fz-iv-report .fz-crumbs button', /^Interview$/); await page.waitForSelector('.fz-catalog.fz-iv'); await wait(200);
  const withHistory = await text('.fz-iv');
  check('The dashboard now shows real statistics from the completed interview', /Interviews completed/.test(withHistory) && /Average score/.test(withHistory) && /Scores by competency/.test(withHistory));
  await clickIn('.fz-related__card', /Review past interviews/); await page.waitForSelector('.fz-iv-table');
  check('History links to playback', /Playback/.test(await text('.fz-iv-table')));
  await clickIn('.fz-iv-table button', /URL Shortener/); await page.waitForSelector('.fz-iv-report'); await wait(200);
  check('Reopening history shows the same read-only report', /URL Shortener/.test(await text('.fz-iv-report')) && JSON.stringify((await store()).records[0]) === recordJson);
  await clickIn('.fz-iv-report button', /New session from this one/); await page.waitForSelector('.fz-iv-session'); await wait(300);
  stored = await store();
  check('A new editable session is created from the previous architecture; the record is untouched', stored.drafts.length === 1 && stored.drafts[0].origin?.recordId === record.id && stored.drafts[0].architecture.nodes.length === 5 && stored.drafts[0].benchmark === null && JSON.stringify(stored.records[0]) === recordJson);
  await clickIn('.fz-iv-side__actions button', /Discard/); await page.waitForSelector('.fz-catalog.fz-iv'); await wait(200);

  // ── Mock mode: timer, no hints, references hidden ───────────────────────────
  await page.click('.fz-ccard button[aria-label="Open Rate Limiter"]'); await page.waitForSelector('.fz-iv-detail');
  check('Mock interviews offer 30, 45 and 60 minutes with a plan per stage', (await page.$$('.fz-iv-duration input[type="radio"]')).length === 3 && /Plan for 45 minutes/.test(await text('.fz-iv-plan')));
  await page.evaluate(() => [...document.querySelectorAll('.fz-iv-duration label')].find(label => /30 minutes/.test(label.textContent))?.querySelector('input')?.click()); await wait(150);
  check('Choosing a duration updates the plan', /Plan for 30 minutes/.test(await text('.fz-iv-plan')));
  await clickIn('.fz-iv-detail button', /Start mock interview/); await page.waitForSelector('.fz-iv-session'); await wait(1500);
  check('A mock interview shows a countdown timer, stage budgets, time per stage and pacing', /left/.test(await text('.fz-iv-clock')) && /suggested/.test(await text('.fz-iv-clock')) && /On schedule/.test(await text('.fz-iv-pace')) && (await page.$$('.fz-iv-stagebar')).length >= 8);
  check('Mock mode offers no hints and hides references', /Hints are not available in a mock interview/.test(await text('.fz-iv-main')) && /shown in the report after you finish/.test(await text('.fz-iv-main')));
  await typeLabelled('Functional requirements', 'Limit requests per client');
  await wait(11_500);
  stored = await store();
  check('Elapsed time is tracked per stage and saved', stored.drafts[0].timing.totalMs >= 10_000 && (stored.drafts[0].timing.stageMs.requirements ?? 0) >= 10_000, JSON.stringify(stored.drafts[0].timing));
  await clickIn('.fz-iv-side__actions button', /Finish early/); await page.waitForSelector('.fz-iv-report', { timeout: 20_000 }); await wait(200);
  check('Finishing a mock interview early produces a report marked as such', /finished early/.test(await text('.fz-iv-report')));

  check('Challenge history is untouched by interviews', await page.evaluate(() => localStorage.getItem('flowzen-challenges-v1')) === challengesBefore);

  // ── Learning links, theme and narrow screens ───────────────────────────────
  const learnLink = await clickIn('.fz-iv-report .fz-iv-recs .fz-chip', /Lesson:/);
  await wait(400);
  check('Weak competencies link into the learning track', learnLink && Boolean(await page.$('.fz-learn')));

  // ── Expiry and recovery: time runs out across a reload; nothing is locked or lost ──
  // The Interview tab reopens the last view (the report); its breadcrumb leads back to the catalog.
  await clickText('.fz-nav button', 'Interview'); await page.waitForSelector('.fz-iv-report'); await wait(200);
  await clickIn('.fz-iv-report .fz-crumbs button', /^Interview$/); await page.waitForSelector('.fz-catalog.fz-iv'); await wait(200);
  await page.click('.fz-ccard button[aria-label="Open Rate Limiter"]'); await page.waitForSelector('.fz-iv-detail');
  await page.evaluate(() => [...document.querySelectorAll('.fz-iv-duration label')].find(label => /30 minutes/.test(label.textContent))?.querySelector('input')?.click()); await wait(100);
  await clickIn('.fz-iv-detail button', /Start mock interview/); await page.waitForSelector('.fz-iv-session'); await wait(300);
  await typeLabelled('Functional requirements', 'Limit requests per client and return 429');
  await wait(600);
  // The page saves its in-memory state when it unloads, so the elapsed time is planted after the reload, before the app reads it.
  await page.evaluateOnNewDocument(() => { if (sessionStorage.getItem('fz-test-clock')) return; sessionStorage.setItem('fz-test-clock', '1'); const data = JSON.parse(localStorage.getItem('flowzen-interviews-v1')); const draft = data.drafts.find(entry => entry.mode === 'mock'); draft.timing = { totalMs: 30 * 60_000 - 3000, stageMs: { requirements: 30 * 60_000 - 3000 } }; localStorage.setItem('flowzen-interviews-v1', JSON.stringify(data)); });
  await page.reload({ waitUntil: 'networkidle0' });
  await clickText('.fz-nav button', 'Interview'); await page.waitForSelector('.fz-iv'); await wait(300);
  await clickIn('.fz-practice button', /Continue/); await page.waitForSelector('.fz-iv-session');
  check('After a reload the mock interview resumes with its time and answers', /Resumed at 29:57/.test(await text('.fz-iv-side')) && /return 429/.test(await page.evaluate(() => document.querySelector('.fz-iv-answer textarea').value)));
  await page.waitForSelector('.fz-iv-expired', { timeout: 15_000 }); await wait(300);
  stored = await store();
  check('When time runs out the expiry is recorded and nothing is locked', Boolean(stored.drafts[0].expired) && /Time is up/.test(await text('.fz-iv-expired')) && !(await page.$eval('.fz-iv-answer textarea', area => area.disabled)) && /Time is up/.test(await text('.fz-iv-pace')));
  await shot('09-expired');
  await clickIn('.fz-iv-expired button', /Finish and review/); await page.waitForSelector('.fz-iv-report', { timeout: 20_000 }); await wait(200);
  check('The report records when time ran out and the overtime', /Time ran out during Requirements/.test(await text('.fz-iv-report')) && /over time/.test(await text('.fz-iv-report')));

  // ── Targeted practice: separate from interviews, graded by measurement ─────
  await clickIn('.fz-iv-report .fz-crumbs button', /^Interview$/); await page.waitForSelector('.fz-catalog.fz-iv'); await wait(200);
  const interviewsBefore = await page.evaluate(() => localStorage.getItem('flowzen-interviews-v1'));
  check('The dashboard offers targeted practice for seven skills and recommends drills from weak areas', (await page.$$('.fz-iv-drills .fz-iv-card')).length === 7 && (await page.$$('#iv-practice ~ .fz-iv-recs li, .fz-iv-recs li')).length > 0);
  await clickIn('.fz-iv-drills button', /Where does it saturate\? \(1\)/); await page.waitForSelector('.fz-iv-drill');
  await page.evaluate(() => [...document.querySelectorAll('.fz-iv-choices label')].find(label => label.textContent.trim() === 'Database')?.querySelector('input')?.click());
  await page.type('.fz-iv-drill textarea', 'Database capacity is 4 / 18 ms, about 222 per second, which is less than the 300 offered.');
  await clickIn('.fz-iv-drill button', /^Submit$/);
  await page.waitForFunction(() => /Result: \d+%/.test(document.querySelector('.fz-iv-drill')?.textContent ?? ''), { timeout: 60_000 }); await wait(300);
  const drill = await text('.fz-iv-drill');
  check('A bottleneck drill is checked against a simulator measurement', /Measured: Database was the busiest/.test(drill) && /Result: 100%/.test(drill), drill.slice(0, 300));
  const practiceStore = await page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-interview-practice-v1') ?? 'null'));
  check('Drill attempts are stored separately and do not touch interview history', practiceStore?.attempts?.length === 1 && await page.evaluate(() => localStorage.getItem('flowzen-interviews-v1')) === interviewsBefore);
  await shot('10-drill');
  await clickText('.fz-nav button', 'Interview'); await page.waitForSelector('.fz-iv'); await wait(200);
  await page.click('.fz-toolbar button[aria-label^="Switch to"]'); await wait(300);
  await shot('11-dashboard-other-theme');
  for (const width of [820, 390]) {
    await page.setViewport({ width, height: 900 }); await wait(300);
    check(`The interview dashboard fits ${width} px without horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await page.setViewport({ width: 1440, height: 900 });
} catch (error) {
  await finish(error);
}
await finish();
