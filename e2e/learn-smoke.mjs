// Browser smoke test for the Learn experience: curriculum navigation, lesson rendering, knowledge checks, experiments,
// exercises checked in the Playground, component guides and LLD, alternatives as variants, challenge links,
// persistence and responsiveness. Run with `npm run test:browser` (see e2e/harness.mjs).
import { startSuite, wait } from './harness.mjs';

const { page, check, finish, shot, clickText, clickBlank, press, history, navigate } = await startSuite('learn');
try {
  page.on('dialog', dialog => dialog.accept());
  const learnStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-learn-v1') ?? 'null'));
  const labStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-lab-v1') ?? 'null'));
  const mainText = () => page.$eval('.fz-learn__main, .fz-learn.is-catalog', element => element.textContent);
  const clickIn = (selector, pattern) => page.evaluate((selector, source) => { const target = [...document.querySelectorAll(selector)].find(element => new RegExp(source).test(element.textContent)); target?.click(); return Boolean(target); }, selector, pattern.source);
  const openLesson = async title => {
    if (await page.$('.fz-learn__lessons, .fz-learn__modules')) {
      // Expand collapsed modules so every written lesson is reachable from the sidebar.
      await page.evaluate(() => document.querySelectorAll('.fz-learn__modtoggle[aria-expanded="false"]').forEach(button => button.click())); await wait(100);
      await clickIn('.fz-learn__lessons button', new RegExp(`^${title}$`));
    } else await page.evaluate(title => document.querySelector(`.fz-ccard button[aria-label="Open ${title}"]`)?.click(), title);
    await page.waitForSelector('.fz-lessonview'); await wait(200);
  };
  const step = async label => { await clickIn('.fz-steps button', new RegExp(`${label}$`)); await wait(200); };
  /** Answers a knowledge check: `choices[i]` is the list of option indexes to select for question i. */
  const answer = async choices => {
    const questions = await page.$$('.fz-quiz__q');
    for (const [i, picks] of choices.entries()) for (const k of picks) { const options = await questions[i].$$('.fz-quiz__opt input'); await options[k].click(); }
    await clickIn('.fz-quiz button', /^Check answers$/); await wait(250);
  };

  // ── Entry point and curriculum ──────────────────────────────────────────────
  check('Learn is the primary entry point', Boolean(await page.$('.fz-learn')) && await page.$eval('.fz-nav button[aria-current="page"]', element => element.textContent) === 'Learn');
  const navLabels = await page.$$eval('.fz-nav button', buttons => buttons.map(button => button.textContent));
  check('Main navigation is Learn, Playground, Interview, Challenges', JSON.stringify(navLabels) === JSON.stringify(['Learn', 'Playground', 'Interview', 'Challenges']), navLabels.join(','));
  const modules = await page.$$eval('.fz-modcard', cards => cards.length);
  check('The dashboard lists all ten modules with progress', modules === 10 && /0 of 9 lessons completed/.test(await mainText()));
  check('It recommends the first lesson to start with', /Recommended next/i.test(await mainText()) && /What system design is/.test(await page.$eval('.fz-hero__card', element => element.textContent)));
  // The overview uses the shared catalog layout: hero, filter facets, results bar and lesson cards.
  check('The overview is a catalog: hero with related topics, filters, results bar and a card per lesson',
    /Tell me more/.test(await page.$eval('.fz-hero', element => element.textContent)) && (await page.$$('.fz-hero__topics button')).length === 10
    && (await page.$$('.fz-filters .fz-facet')).length === 3 && /100 results/.test(await page.$eval('.fz-results-bar h2', element => element.textContent)) && (await page.$$('.fz-card-grid .fz-ccard')).length === 100);
  check('Lesson cards show the component’s shape, and planned lessons cannot be opened', (await page.$$('.fz-ccard__art .fz-glyph svg.fz-shape')).length === 100 && (await page.$$('.fz-ccard.is-planned button:disabled')).length === 90);
  await page.evaluate(() => [...document.querySelectorAll('.fz-facet label')].find(label => /^Completed/.test(label.querySelector('.fz-facet__label')?.textContent ?? ''))?.querySelector('input')?.click()); await wait(150);
  check('Facets filter the lessons', /0 results/.test(await page.$eval('.fz-results-bar h2', element => element.textContent)));
  await clickIn('.fz-filters button', /Clear filters/); await wait(150);
  await shot('01-dashboard');
  await clickIn('.fz-hero__topics button', /Networking and Request Flow/); await page.waitForSelector('.fz-modlessons'); await wait(200);
  const sidebar = await page.$$eval('.fz-learn__modules > li', items => items.map(item => item.querySelectorAll('.fz-learn__lessons li').length));
  check('Module pages keep the curriculum sidebar', sidebar.length === 10 && sidebar[1] === 9, sidebar.join(','));
  check('Planned modules are shown as planned, not as content', /This module is planned/.test(await mainText()) && (await page.$$('.fz-modlessons li.is-planned')).length === 9 && (await page.$$('.fz-learn__lessons li.is-planned')).length >= 9);

  // ── Lesson rendering and reading progress ──────────────────────────────────
  await openLesson('Horizontal vs vertical scaling');
  const steps = await page.$$eval('.fz-steps button', buttons => buttons.map(button => button.textContent.replace(/^[A-G]/, '')));
  check('A lesson uses the standard sections A–G', JSON.stringify(steps) === JSON.stringify(['Concept', 'Why and when', 'Alternatives', 'Design example', 'Experiment', 'Knowledge check', 'Exercise']), steps.join(','));
  const concept = await page.$eval('.fz-lessonview__body', element => element.textContent);
  check('The concept section has a definition, terminology, an example, advantages and limitations',
    /scaling up/i.test(concept) && /Terminology/.test(concept) && /Real-world example/.test(concept) && /Advantages/.test(concept) && /Limitations/.test(concept));
  check('Architecture diagrams render as accessible SVG', (await page.$$('.fz-lessonview__body .fz-diagram svg[role="img"]')).length >= 1);
  check('The lesson states how much the simulator can show', /Simulated/.test(await page.$eval('.fz-lessonview__meta', element => element.textContent)) && /no health checks/.test(await page.$eval('.fz-lessonview__simnote', element => element.textContent)));
  await shot('02-lesson-concept');
  let stored = await learnStore();
  check('Reading progress is stored locally under its own key', stored?.lessons['horizontal-vertical']?.visited.includes('concept') && !stored.lessons['horizontal-vertical'].readAt);
  for (let i = 0; i < 3; i++) { await page.click('.fz-lessonview__pager .fz-btn--primary'); await wait(150); }
  check('Next moves through the sections in order', /Design example/.test(await page.$eval('.fz-steps button[aria-current="step"]', element => element.textContent)));
  stored = await learnStore();
  check('The lesson is marked read after every reading section is opened', Boolean(stored.lessons['horizontal-vertical'].readAt));

  // ── Experiment ─────────────────────────────────────────────────────────────
  await step('Experiment');
  const design = await page.$eval('.fz-experiment', element => element.textContent);
  check('The experiment states the question, hypothesis, controls, variable and metrics', /Question/.test(design) && /Hypothesis/.test(design) && /Held constant/.test(design) && /Variable/.test(design) && /Measured/.test(design));
  await clickIn('.fz-experiment button', /Run all 4 variants/);
  await page.waitForSelector('.fz-experiment__result', { timeout: 60_000 }); await wait(300);
  const result = await page.$eval('.fz-experiment', element => element.textContent);
  check('Measured results are shown per variant with a measured conclusion', (await page.$$('.fz-experiment__table thead th')).length === 5 && /Measured\s*Supports the hypothesis/.test(result) && /30%/.test(result) && /7\.5%/.test(result));
  check('Explanation and simulator limitations are kept separate from measurements', /explanation, not measured/.test(result) && /What the simulator does not model/.test(result) && /no health checks/.test(result));
  stored = await learnStore();
  const record = stored.experiments['vertical-vs-horizontal']?.[0];
  check('The run is recorded with identical seed for every variant', record?.variants.length === 4 && record.benchmark.seed === 42 && record.variants.every(variant => variant.complete && variant.rps === 300));
  await shot('03-experiment');

  // ── Knowledge check ─────────────────────────────────────────────────────────
  await step('Knowledge check');
  await answer([[2], [2], [2], [2]]);
  let quiz = await page.$eval('.fz-quiz', element => element.textContent);
  check('A failing knowledge check explains each answer and does not complete', /need 70%/.test(quiz) && (await page.$$('.fz-quiz__why')).length === 4);
  await clickIn('.fz-quiz button', /Retake/); await wait(150);
  await answer([[0], [1], [1], [0]]);
  quiz = await page.$eval('.fz-quiz', element => element.textContent);
  stored = await learnStore();
  check('Answering correctly passes; the best result and attempts are kept', /4 of 4 correct/.test(quiz) && stored.lessons['horizontal-vertical'].quiz.attempts === 2 && stored.lessons['horizontal-vertical'].quiz.best.passed === true);
  await shot('04-knowledge-check');

  // ── Exercise: numeric task ──────────────────────────────────────────────────
  await step('Exercise');
  const numeric = await page.$('.fz-task input[aria-label^="Answer"]');
  await numeric.type('6'); await clickIn('.fz-task button', /^Check$/); await wait(150);
  check('A wrong numeric answer is not accepted', /Not within tolerance/.test(await page.$eval('.fz-task', element => element.textContent)));
  await numeric.click({ clickCount: 3 }); await numeric.type('4'); await clickIn('.fz-task button', /^Check$/); await wait(200);
  stored = await learnStore();
  check('A correct answer completes the task and shows the working', /Correct/.test(await page.$eval('.fz-task', element => element.textContent)) && Boolean(stored.lessons['horizontal-vertical'].tasks?.n1));

  // ── Lesson → component guide → LLD ─────────────────────────────────────────
  await clickIn('.fz-related-comp', /^Load Balancer/); await page.waitForSelector('.fz-guide'); await wait(200);
  const guide = await mainText();
  check('A component links to its guide: why, when, alternatives, configuration, failure modes, simulator limits',
    /Why use this\?/.test(guide) && /Use it when/.test(guide) && /Alternatives/.test(guide) && /Configuration/.test(guide) && /Common failure modes/.test(guide) && /Always round robin/.test(guide));
  await clickIn('.fz-guide__tabs button', /Low-level design/); await page.waitForSelector('.fz-lld', { timeout: 10_000 }); await wait(200);
  check('The guide opens the LLD explorer, labelled illustrative and not executed', /Illustrative Java/.test(await mainText()) && /never executed/.test(await mainText()) && (await page.$$('.fz-lld__tabs button')).length === 5);
  await shot('05-component-lld');
  await openLesson('Why caching exists');
  await clickIn('.fz-lessonview__related .fz-chip', /^Cache$/); await page.waitForSelector('.fz-lld', { timeout: 10_000 });
  check('A lesson’s LLD link opens that component’s design directly', /Low-level design/.test(await page.$eval('.fz-guide__tabs [aria-selected="true"]', element => element.textContent)) && /Cache/.test(await page.$eval('.fz-guide__head h1', element => element.textContent)));

  // ── Build exercise checked in the Playground ───────────────────────────────
  await openLesson('Capacity estimation and back-of-the-envelope calculations');
  await step('Exercise');
  await clickIn('.fz-task button', /Build it in the Playground/);
  await page.waitForSelector('.fz-buildcheck', { timeout: 10_000 }); await wait(400);
  check('The exercise opens in the Playground with its starting design and checks', (await page.$$('.react-flow__node')).length === 2 && /Compute slots ≤ 45/.test(await page.$eval('.fz-buildcheck', element => element.textContent)));
  let h = await history();
  check('Loading the starter is one undoable edit', /Undo Load exercise: Capacity estimation/.test(h[0].label), h[0].label);
  await clickIn('.fz-buildcheck button', /Check my design/);
  await page.waitForFunction(() => /Not yet|All checks met/.test(document.querySelector('.fz-buildcheck')?.textContent ?? ''), { timeout: 30_000 });
  check('The starter design fails the measured checks', /Not yet/.test(await page.$eval('.fz-buildcheck', element => element.textContent)));
  await page.click('.react-flow__node[data-id="api"]'); await wait(250);
  await clickText('.fz-rtabs button', 'Inspector'); await wait(200);
  const instances = await page.evaluateHandle(() => [...document.querySelectorAll('.fz-field')].find(field => field.querySelector('span')?.textContent.startsWith('Instances'))?.querySelector('input'));
  await instances.click({ clickCount: 3 }); await page.keyboard.type('40'); await wait(800);
  await clickText('.fz-rtabs button', 'Lab'); await page.waitForSelector('.fz-buildcheck'); await wait(200);
  await clickIn('.fz-buildcheck button', /Check my design/);
  await page.waitForFunction(() => /All checks met|Not yet/.test(document.querySelector('.fz-buildcheck .fz-alert')?.textContent ?? ''), { timeout: 30_000 });
  stored = await learnStore();
  check('Provisioning the estimated slots passes, and the task is recorded', /All checks met/.test(await page.$eval('.fz-buildcheck', element => element.textContent)) && Boolean(stored.lessons['capacity-estimation'].tasks?.provision));
  await shot('06-build-check');
  await clickIn('.fz-buildcheck button', /Back to the lesson/); await page.waitForSelector('.fz-exercise'); await wait(200);
  check('Back in the lesson, the build task shows as completed', (await page.$$('.fz-task.is-done')).length === 1);

  // ── Guided experiment, variants and alternatives in the Playground ─────────
  await openLesson('Why caching exists'); await step('Experiment');
  await clickIn('.fz-lessonview__body button', /Open in the Playground/);
  await page.waitForSelector('.fz-guided', { timeout: 10_000 }); await wait(300);
  check('“Open in the Playground” shows the same experiment in the Guided tab', await page.$eval('.fz-guided select', element => element.value) === 'cache-vs-database');
  await clickIn('.fz-experiment__variants li', /Single cache node/) ;
  await page.evaluate(() => [...document.querySelectorAll('.fz-experiment__variants li')].find(item => /Single cache node/.test(item.textContent))?.querySelector('button')?.click()); await wait(200);
  check('Loading a variant over a non-empty canvas asks first', Boolean(await page.$('.fz-confirm')));
  await clickIn('.fz-confirm button', /Replace/); await wait(500);
  let lab = await labStore();
  check('The variant is copied into the canvas and the lab benchmark matches its workload', (await page.$$('.react-flow__node')).length === 4 && lab.benchmark.rps === 2400 && lab.benchmark.seed === 42);
  await page.click('.react-flow__node[data-id="cache"]'); await wait(250);
  await clickText('.fz-rtabs button', 'Inspector'); await wait(200);
  check('Selecting a component shows “Why use this?”', /Why use this\?/.test(await page.$eval('.fz-inspector', element => element.textContent)));
  await page.click('.fz-why__alts summary'); await wait(150);
  await shot('07-why-alternatives');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-lab-v1')).variants.length);
  await clickIn('.fz-why__alts button', /Try Distributed Cache/); await wait(600);
  lab = await labStore();
  const saved = lab.variants.find(variant => /^Before Distributed Cache for Cache/.test(variant.name));
  check('“Try alternative” first saves the original design as a variant', lab.variants.length === before + 1 && saved?.architecture.nodes.find(node => node.id === 'cache').kind === 'cache');
  check('…then swaps the component on the canvas, keeping its connections', /Distributed Cache/.test(await page.$eval('.react-flow__node[data-id="cache"]', element => element.textContent)) && (await page.$$('.react-flow__edge')).length === 3);
  const savedJson = JSON.stringify(saved);
  await clickBlank(); await press('Control+z'); await wait(400);
  check('Undo restores the original component; the saved variant is unchanged', /Cache/.test(await page.$eval('.react-flow__node[data-id="cache"]', element => element.textContent)) && !/Distributed/.test(await page.$eval('.react-flow__node[data-id="cache"]', element => element.textContent))
    && JSON.stringify((await labStore()).variants.find(variant => variant.id === saved.id)) === savedJson);

  // ── Library: why and learn more ─────────────────────────────────────────────
  await page.hover('button[aria-label="Add Rate Limiter"]'); await wait(150);
  check('The library shows “Why use this?” for the focused component', /Why use this\?/.test(await page.$eval('.fz-library__detail', element => element.textContent)));
  await clickIn('.fz-library__detail button', /When to use it/); await page.waitForSelector('.fz-guide'); await wait(200);
  check('…and links to its full guide in Learn', /Rate Limiter/.test(await page.$eval('.fz-guide__head h1', element => element.textContent)));

  // ── Challenges stay optional and link back to lessons ──────────────────────
  const learnBefore = JSON.stringify(await learnStore());
  await openLesson('Why caching exists');
  await clickIn('.fz-related-challenges button', /Cache It Right/); await page.waitForSelector('.fz-brief'); await wait(400);
  const brief = await page.$eval('.fz-brief', element => element.textContent);
  check('A challenge shows the concepts (lessons) it tests', /Concepts tested/.test(brief) && /Why caching exists/.test(brief));
  await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].find(button => /Submit solution/.test(button.textContent))?.click());
  await page.waitForSelector('.fz-results', { timeout: 30_000 }); await wait(300);
  check('Failed criteria link back to relevant lessons', /FAIL/.test(await page.$eval('.fz-results', element => element.textContent)) && (await page.$$('.fz-results__learn button')).length > 0);
  await clickIn('.fz-results__learn button', /Why caching exists/); await page.waitForSelector('.fz-lessonview'); await wait(300);
  const challenges = await page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-challenges-v1')));
  check('Opening a lesson from a challenge keeps its draft and recorded attempt', challenges.drafts['cache-it-right'] && challenges.challenges['cache-it-right'].attempts === 1);
  check('Challenge activity does not change learning progress', JSON.stringify(await learnStore()) === learnBefore);

  // ── Persistence ─────────────────────────────────────────────────────────────
  const beforeReload = JSON.stringify(await learnStore());
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.fz-learn'); await wait(300);
  check('Learning progress survives a reload unchanged', JSON.stringify(await learnStore()) === beforeReload);
  check('The overview reflects saved checks and experiments', /Horizontal vs vertical scaling/.test(await page.$eval('.fz-dashboard', element => element.textContent)) && /1 run/.test(await page.$eval('.fz-explist', element => element.textContent)));
  await openLesson('Horizontal vs vertical scaling'); await step('Experiment');
  check('Revisiting a lesson shows the previous experiment result', Boolean(await page.$('.fz-experiment__result')));

  // ── Themes and narrow screens ───────────────────────────────────────────────
  await page.click('.fz-toolbar button[aria-label^="Switch to"]'); await wait(300);
  await shot('08-lesson-other-theme');
  await step('Concept');
  for (const width of [820, 390]) {
    await page.setViewport({ width, height: 900 }); await wait(300);
    check(`The Learn page fits a ${width} px window without horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  check('On narrow screens the curriculum sits behind a button', await page.$eval('.fz-learn__nav', element => getComputedStyle(element).display) === 'none');
  await clickIn('.fz-learn__navtoggle', /Curriculum/); await wait(150);
  check('…which opens it', await page.$eval('.fz-learn__nav', element => getComputedStyle(element).display) !== 'none');
  await shot('09-narrow');
  await page.setViewport({ width: 1440, height: 900 });
} catch (error) {
  await finish(error);
}
await finish();
