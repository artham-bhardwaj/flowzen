// Browser smoke test: design canvas, undo/redo, HLD / LLD / Unified views, and the challenge round trip.
// Run with `npm run test:browser` (see e2e/harness.mjs for requirements and environment variables).
import { startSuite, wait } from './harness.mjs';

const { page, check, finish, shot, navigate } = await startSuite('design');
try {
  // The app opens on Learn; the design canvas is the Playground's free canvas.
  check('The app opens on the Learn page', Boolean(await page.$('.fz-learn')));
  await navigate('Design'); await page.waitForSelector('.react-flow__node');
  const shapes = await page.$$eval('.react-flow__node', nodes => nodes.map(node => ({ id: node.dataset.id, d: node.querySelector('svg.fz-node__shape .fz-shape__outline')?.getAttribute('d') ?? '' })));
  check('Every component on the canvas is drawn with its own shape', shapes.length > 0 && shapes.every(shape => shape.d.length > 20), JSON.stringify(shapes.map(shape => shape.id)));
  const outline = id => shapes.find(shape => shape.id === id)?.d;
  check('Different kinds have different shapes (database cylinder, cache chip, queue pipe, load balancer, server rack)', new Set([outline('db'), outline('cache'), outline('queue'), outline('lb'), outline('app-a')]).size === 5);
  check('The library shows each component with its shape', (await page.$$('.fz-lib-item .fz-glyph svg.fz-shape')).length === 25);
  for (const width of [1440, 1280, 1024]) {
    await page.setViewport({ width, height: 900 }); await wait(250);
    check(`The editor toolbar fits ${width} px without horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('.fz-toolbar').scrollWidth <= window.innerWidth));
  }
  await page.setViewport({ width: 1440, height: 900 }); await wait(250);

  const count = () => page.$$eval('.react-flow__node', nodes => nodes.length);
  const edgeCount = () => page.$$eval('.react-flow__edge', edges => edges.length);
  const historyState = () => page.$$eval('.fz-history button', buttons => buttons.map(button => ({ disabled: button.disabled, label: button.getAttribute('aria-label') })));
  const press = async (combo) => { const keys = combo.split('+'); for (const key of keys.slice(0, -1)) await page.keyboard.down(key); await page.keyboard.press(keys.at(-1)); for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key); await wait(120); };
  const clickCanvasBlank = async () => {
    const point = await page.evaluate(() => {
      const pane = document.querySelector('.react-flow__pane'); const r = pane.getBoundingClientRect();
      for (let y = r.bottom - 20; y > r.top + 60; y -= 23) for (let x = r.left + 20; x < r.right - 60; x += 31) if (document.elementFromPoint(x, y) === pane) return { x, y };
      return null;
    });
    if (!point) throw new Error('no blank canvas point');
    await page.mouse.click(point.x, point.y); await wait(100);
  };
  const nodeBox = id => page.$eval(`.react-flow__node[data-id="${id}"]`, element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const nodePos = id => page.$eval(`.react-flow__node[data-id="${id}"]`, element => element.style.transform);
  const clickText = async (selector, text) => page.evaluate((selector, text) => { const target = [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === text); target?.click(); return Boolean(target); }, selector, text);

  // ── Undo / redo ───────────────────────────────────────────────────────────────
  let h = await historyState();
  check('Undo and Redo start disabled', h.length === 2 && h[0].disabled && h[1].disabled, JSON.stringify(h.map(x => x.label)));
  const initialNodes = await count(); const initialEdges = await edgeCount();

  await page.click('button[aria-label="Add Cache"]'); await wait(200);
  h = await historyState();
  check('Adding a component enables Undo with a descriptive tooltip', !h[0].disabled && /Undo Add Cache \(Ctrl\+Z\)/.test(h[0].label), h[0].label);
  await clickCanvasBlank();
  await press('Control+z');
  check('Ctrl+Z removes the added component', await count() === initialNodes);
  h = await historyState(); check('Redo enabled after undo, naming the edit', !h[1].disabled && /Redo Add Cache/.test(h[1].label), h[1].label);
  await press('Control+Shift+Z');
  check('Ctrl+Shift+Z re-adds it', await count() === initialNodes + 1);
  await press('Control+z'); await press('Control+y');
  check('Ctrl+Y redoes', await count() === initialNodes + 1);
  await press('Control+z');

  // Drag: many mouse moves → one entry.
  const before = await nodePos('lb'); const box = await nodeBox('lb');
  await page.mouse.move(box.x + 60, box.y + 20); await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) { await page.mouse.move(box.x + 60 + i * 6, box.y + 20 + i * 3); await wait(10); }
  await page.mouse.up(); await wait(200);
  const moved = await nodePos('lb');
  h = await historyState();
  check('Dragging a component records one "Move" entry', moved !== before && /Undo Move Load Balancer/.test(h[0].label), h[0].label);
  await clickCanvasBlank(); await press('Control+z');
  check('One undo returns the dragged component to its start', await nodePos('lb') === before);
  h = await historyState();
  check('After undoing the drag, the next undo is the earlier add (not a drag step)', /Nothing to undo|Undo Add Cache/.test(h[0].label), h[0].label);
  await press('Control+Shift+Z'); // redo the move
  check('Redo re-applies the whole drag', await nodePos('lb') === moved);

  // Delete with the keyboard, then undo restores node + edges.
  await page.click('.react-flow__node[data-id="cache"]'); await wait(150);
  await page.keyboard.press('Delete'); await wait(200);
  check('Delete key removes the component and its connections', await count() === initialNodes - 1 && await edgeCount() === initialEdges - 3);
  await clickCanvasBlank(); await press('Control+z');
  check('Undo restores the component and all its connections', await count() === initialNodes && await edgeCount() === initialEdges);

  // A new edit after undo clears redo.
  await press('Control+z'); // undo the redo'd move
  h = await historyState(); const hadRedo = !h[1].disabled;
  await page.click('button[aria-label="Add Worker"]'); await wait(200);
  h = await historyState();
  check('A new edit after undo clears the redo branch', hadRedo && h[1].disabled, h[1].label);
  await press('Control+z');

  // Connect two handles by dragging.
  const source = await page.$eval('.react-flow__node[data-id="events"] .react-flow__handle.source', element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const target = await page.$eval('.react-flow__node[data-id="lb"] .react-flow__handle.target', element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(source.x, source.y); await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) { await page.mouse.move(source.x + (target.x - source.x) * i / 10, source.y + (target.y - source.y) * i / 10); await wait(15); }
  await page.mouse.up(); await wait(200);
  h = await historyState();
  check('Creating a connection is undoable', await edgeCount() === initialEdges + 1 && /Undo Connect Order Events → Load Balancer/.test(h[0].label), h[0].label);
  await clickCanvasBlank(); await press('Control+z');
  check('Undo removes the new connection', await edgeCount() === initialEdges);

  // ── Detaching and moving existing connections ──────────────────────────────
  const edgeIds = () => page.$$eval('.react-flow__edge', items => items.map(item => item.getAttribute('data-id')));
  const pathMid = id => page.$eval(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`, path => { const p = path.getPointAtLength(path.getTotalLength() / 2); const m = path.getScreenCTM(); return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }; });
  const anchor = (id, end) => page.$eval(`.react-flow__edge[data-id="${id}"] .react-flow__edgeupdater-${end}`, circle => { const r = circle.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const dragFrom = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= 14; i += 1) { await page.mouse.move(from.x + (to.x - from.x) * i / 14, from.y + (to.y - from.y) * i / 14); await wait(16); } await page.mouse.up(); await wait(300); };
  // Make every arrow visible: close the inspector (it can cover the canvas) and fit the view.
  if (await page.$('.fz-inspector')) { await page.click('button[aria-label="Toggle inspector"]'); await wait(250); }
  await page.click('button[aria-label="Fit architecture to view"]'); await wait(400);
  // A plain click on a short arrow (mostly end anchor) selects it and must never delete it.
  const short = await pathMid('cache-db'); await page.mouse.click(short.x, short.y); await wait(250);
  const shortState = await page.evaluate(({ x, y }) => ({ top: document.elementFromPoint(x, y)?.getAttribute('class'), edge: document.querySelector('.react-flow__edge[data-id="cache-db"]')?.getAttribute('class') ?? 'missing', buttons: document.querySelectorAll('.fz-edge__remove').length }), short);
  check('Clicking a short arrow selects it and does not remove it', (await edgeIds()).includes('cache-db') && await page.$('.fz-edge__remove') !== null, JSON.stringify(shortState));
  await page.click('.fz-edge__remove'); await wait(250);
  check('The × button on a selected arrow removes the connection', !(await edgeIds()).includes('cache-db') && /Undo Disconnect Session Cache → Orders DB/.test((await historyState())[0].label), (await historyState())[0].label);
  await clickCanvasBlank(); await press('Control+z');
  check('…and Undo brings it back', (await edgeIds()).includes('cache-db'));
  // Drag the arrow head of Load Balancer → Checkout API · A into empty canvas: it detaches.
  const longMid = await pathMid('lb-app-a'); await page.mouse.click(longMid.x, longMid.y); await wait(200);
  const head = await anchor('lb-app-a', 'target');
  await dragFrom(head, { x: head.x + 30, y: head.y + 170 });
  check('Dragging an arrow’s end off a component detaches the connection', !(await edgeIds()).includes('lb-app-a') && (await edgeIds()).length === initialEdges - 1 && /Undo Disconnect Load Balancer → Checkout API · A/.test((await historyState())[0].label), (await historyState())[0].label);
  await clickCanvasBlank(); await press('Control+z');
  check('…as one undoable step', (await edgeIds()).includes('lb-app-a') && (await edgeIds()).length === initialEdges);
  // Drag the same arrow head onto another component's input: the connection moves.
  const again = await pathMid('lb-app-a'); await page.mouse.click(again.x, again.y); await wait(200);
  const dbInput = await page.$eval('.react-flow__node[data-id="db"] .react-flow__handle.target', element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await dragFrom(await anchor('lb-app-a', 'target'), dbInput);
  check('Dragging an arrow’s end onto another component moves the connection', (await edgeIds()).includes('lb-db') && !(await edgeIds()).includes('lb-app-a') && /Undo Move connection Load Balancer → Checkout API · A to Load Balancer → Orders DB/.test((await historyState())[0].label), (await historyState())[0].label);
  await clickCanvasBlank(); await press('Control+z');
  check('…and Undo moves it back', (await edgeIds()).includes('lb-app-a') && !(await edgeIds()).includes('lb-db'));

  // Rename via the inspector: typing is one step; Ctrl+Z inside the field is left to the browser.
  await page.click('.react-flow__node[data-id="db"]'); await wait(250);
  const nameInput = await page.$('.fz-field input');
  await nameInput.click({ clickCount: 3 }); await page.keyboard.type('Primary DB', { delay: 30 }); await wait(150);
  const nodesBeforeFieldUndo = await count();
  await press('Control+z');
  // An app-level undo would enable Redo; the field's native undo is just another edit, so Redo stays disabled.
  h = await historyState();
  check('Ctrl+Z inside a text field is left to the field (no architecture undo)', await count() === nodesBeforeFieldUndo && h[1].disabled, `redo=${h[1].label}`);
  check('The field’s own undo leaves no empty history step', !/Rename Orders DB/.test(h[0].label), h[0].label);
  await nameInput.click({ clickCount: 3 }); await page.keyboard.type('Primary DB', { delay: 30 }); await wait(1200);
  await clickCanvasBlank();
  h = await historyState();
  check('Renaming is one history entry', /Undo Rename Orders DB/.test(h[0].label), h[0].label);
  await press('Control+z');
  check('Undo restores the previous name', (await page.$eval('.react-flow__node[data-id="db"] .fz-node__name', element => element.textContent)) === 'Orders DB');

  // Simulation playback and selection do not create entries.
  await page.evaluate(() => [...document.querySelectorAll('.fz-toolbar button')].find(button => /^Run/.test(button.textContent.trim()))?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('.fz-toolbar button')].some(button => /Pause|Resume|Replay/.test(button.textContent)) && !document.querySelector('.fz-toolbar [aria-busy="true"]'), { timeout: 20000 });
  await wait(600);
  const labelAfterRun = (await historyState())[0].label;
  await page.click('.react-flow__node[data-id="app-a"]'); await wait(150); await clickCanvasBlank();
  check('Running a simulation and selecting components add no history entries', labelAfterRun === (await historyState())[0].label, labelAfterRun);
  await shot('01-design-undo');

  // ── HLD / LLD / Unified ──────────────────────────────────────────────────────
  await page.click('.react-flow__node[data-id="lb"]'); await wait(250);
  await clickText('[role="radiogroup"][aria-label="Design view"] button', 'HLD'); await wait(250);
  check('HLD: inspector shows the component’s role and neighbors', await page.$('.fz-role') !== null && (await page.$$eval('.fz-role .fz-neighbors li', items => items.length)) >= 3);
  check('HLD: no low-level tabs', await page.$('.fz-node-tabs') === null);
  await shot('02-hld-role');
  await page.evaluate(() => [...document.querySelectorAll('.fz-role__lld')][0]?.click()); await wait(800);
  check('“Low-level design” button switches to LLD keeping the selection', await page.$eval('[aria-label="Design view"] [aria-checked="true"]', element => element.textContent) === 'LLD' && await page.$('.fz-lld') !== null);
  check('LLD widens the inspector', await page.$('.fz-app.has-wide-inspector') !== null);
  check('LLD canvas nodes show Java design coverage', (await page.$$eval('.fz-node__lld', items => items.map(item => item.textContent))).some(text => /Java design · 10 types/.test(text)));
  check('LLD overview shows canvas neighbors and config bindings', await page.$('.fz-lld__role') !== null && (await page.$$eval('.fz-bindings tbody tr', rows => rows.length)) > 0);
  check('Illustrative-code disclaimer is shown', /not production code/.test(await page.$eval('.fz-lld__disclaimer', element => element.textContent)));
  await clickText('.fz-lld__tabs button', 'Classes'); await wait(200);
  check('Class diagram renders boxes and relations', (await page.$$eval('.fz-uml__box', items => items.length)) === 7 && (await page.$$eval('.fz-uml__edge', items => items.length)) >= 6);
  await page.evaluate(() => { const box = [...document.querySelectorAll('.fz-uml__box')].find(element => element.getAttribute('aria-label') === 'interface LoadBalancingStrategy'); box?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await wait(200);
  check('Clicking a class shows its responsibility and dependencies', /LoadBalancingStrategy/.test(await page.$eval('.fz-classcard h3', element => element.textContent)) && /implemented by/.test(await page.$eval('.fz-classcard', element => element.textContent)));
  await page.evaluate(() => [...document.querySelectorAll('.fz-classcard .fz-rels button')].find(button => button.textContent === 'RoundRobinStrategy')?.click()); await wait(150);
  check('Following a dependency selects the related class', /RoundRobinStrategy/.test(await page.$eval('.fz-classcard h3', element => element.textContent)));
  await shot('03-lld-classes-dark');
  await page.evaluate(() => [...document.querySelectorAll('.fz-classcard button')].find(button => /View code/.test(button.textContent))?.click()); await wait(200);
  check('“View code” opens the class’s file with highlighting', /RoundRobinStrategy\.java/.test(await page.$eval('.fz-code figcaption', element => element.textContent)) && (await page.$$eval('.fz-code .tk-keyword', items => items.length)) > 3);
  await page.evaluate(() => [...document.querySelectorAll('.fz-code .tk-link')].find(button => button.textContent === 'LoadBalancingStrategy')?.click()); await wait(150);
  check('Clicking a type in the code follows it to its file', /LoadBalancingStrategy\.java/.test(await page.$eval('.fz-code figcaption', element => element.textContent)));
  await page.evaluate(() => document.querySelector('.fz-code figcaption button').click()); await wait(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('Copy puts the file on the clipboard', clip.includes('public interface LoadBalancingStrategy'), clip.slice(0, 40));
  await shot('04-lld-code');
  await clickText('.fz-lld__tabs button', 'Principles'); await wait(200);
  const principleCount = await page.$$eval('.fz-principles > li', items => items.length);
  await page.click('.fz-principle__head'); await wait(150);
  check('Principles list expands to meaning, evidence, benefit, violation and trade-off', principleCount === 4 && (await page.$$eval('.fz-principle__body h4', items => items.map(item => item.textContent))).join('|') === 'Where in the code|Why it helps|What a violation looks like|Trade-off');
  check('Refactoring example shows before and after code', (await page.$$eval('.fz-refactor .fz-code', items => items.length)) === 2);
  await shot('05-lld-principles');
  await clickText('.fz-lld__tabs button', 'Design'); await wait(200);
  check('Design choice matches the canvas configuration', /Matches this component’s “Algorithm” setting/.test(await page.$eval('.fz-choice', element => element.textContent)));
  await clickText('.fz-choice__options button', 'Least connections'); await wait(150);
  check('Switching a design choice shows the changed implementation', /LeastConnectionsStrategy/.test(await page.$eval('.fz-choice .fz-code pre', element => element.textContent)));
  // Edit history ignores everything done in the LLD inspector.
  check('LLD exploration adds no history entries', labelAfterRun === (await historyState())[0].label);

  await page.click('.react-flow__node[data-id="client"]'); await wait(300);
  check('Uncovered kinds say so explicitly', /No low-level design for Client yet/.test(await page.$eval('.fz-inspector', element => element.textContent)));
  await page.click('.react-flow__node[data-id="db"]'); await wait(500);
  check('Selecting another component in LLD shows its design', /SQL Database/.test(await page.$eval('.fz-lld__head h2', element => element.textContent)));
  await clickText('[role="radiogroup"][aria-label="Design view"] button', 'Unified'); await wait(250);
  check('Unified keeps the selection and offers Component / Low-level design tabs', await page.$('.fz-node-tabs') !== null && await page.$('.fz-lld') !== null);
  await clickText('.fz-node-tabs button', 'Component'); await wait(200);
  check('Unified component tab shows properties and the role section', await page.$('.fz-field') !== null && await page.$('.fz-role') !== null && await page.$('.fz-app.has-wide-inspector') === null);

  // Light theme.
  await clickText('.fz-node-tabs button', 'Low-level design'); await wait(300);
  await clickText('.fz-lld__tabs button', 'Classes'); await wait(150);
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await shot('06-lld-classes-${themeBefore}');
  await clickText('.fz-lld__tabs button', 'Code'); await wait(150);
  await shot('07-lld-code-${themeBefore}');
  await page.click('.fz-toolbar button[aria-label^="Switch to"]'); await wait(300);
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check('Theme toggle switches between light and dark', themeBefore !== themeAfter && ['light', 'dark'].includes(themeAfter), `${themeBefore} → ${themeAfter}`);
  await shot('07b-lld-code-${themeAfter}');
  await clickText('.fz-lld__tabs button', 'Classes'); await wait(150);
  await shot('06b-lld-classes-${themeAfter}');

  // ── Challenge: edit history vs. submitted attempts ───────────────────────────
  await clickText('.fz-nav button', 'Challenges'); await page.waitForSelector('.fz-catalog', { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('.fz-catalog button')].find(button => /The Slow API/.test(button.getAttribute('aria-label') ?? button.textContent))?.click());
  await page.waitForSelector('.fz-brief', { timeout: 5000 }); await wait(400);
  h = await historyState();
  check('A challenge starts with its own empty edit history', h[0].disabled && h[1].disabled);
  // Assert what the brief says, not how many lists it happens to contain.
  const brief = await page.$eval('.fz-brief', element => {
    const section = title => { const heading = [...element.querySelectorAll('h3, h4')].find(node => node.textContent.trim().startsWith(title)); const list = heading?.nextElementSibling?.tagName === 'UL' ? heading.nextElementSibling : null; return list ? [...list.querySelectorAll('li')].map(item => item.textContent) : []; };
    return { topics: [...element.querySelectorAll('.fz-brief__topics li')].map(item => item.textContent), functional: section('Functional'), nonFunctional: section('Non-functional'), learn: section('What you’ll learn') };
  });
  check('Challenge brief states its topics, functional and non-functional requirements, and learning objectives',
    brief.topics.includes('Horizontal scaling') && brief.functional.some(item => /profile request/.test(item)) && brief.nonFunctional.some(item => /p95 latency/.test(item)) && brief.learn.some(item => /Little’s law/.test(item)), JSON.stringify(brief).slice(0, 160));
  await shot('08-challenge-brief');
  await page.click('.react-flow__node[data-id="api"]'); await wait(300);
  await clickText('.fz-node-tabs button', 'Component'); await wait(150);
  const instances = await page.evaluateHandle(() => [...document.querySelectorAll('.fz-field')].find(field => /Instances/.test(field.textContent))?.querySelector('input'));
  await instances.click({ clickCount: 3 }); await page.keyboard.type('14'); await wait(1200);
  await clickCanvasBlank();
  h = await historyState();
  check('Config edit in a challenge is undoable', /Undo Edit Profile API · instances/.test(h[0].label), h[0].label);
  await clickText('.fz-rtabs button', 'Challenge'); await wait(150);
  await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].find(button => /Submit solution/.test(button.textContent))?.click());
  await page.waitForSelector('.fz-results', { timeout: 30000 }); await wait(300);
  const verdict = await page.$eval('.fz-results', element => element.textContent);
  check('Submission is graded by the real simulator (PASS)', /PASS/.test(verdict));
  await shot('09-challenge-pass');
  await page.keyboard.press('Escape'); await wait(200);
  await page.evaluate(() => [...document.querySelectorAll('.fz-results button')].find(button => /Keep practicing|Try again/.test(button.textContent))?.click()); await wait(200);
  await clickCanvasBlank();
  await press('Control+z');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-challenges-v1') ?? '{}'));
  const entry = progress.challenges?.['slow-api'];
  const instancesNow = await page.evaluate(() => { const node = document.querySelector('.react-flow__node[data-id="api"] .fz-node__spec'); return node?.textContent ?? ''; });
  check('Undo after submitting reverts the edit but keeps the recorded attempt', entry?.solved === true && entry?.attempts === 1, `attempts=${entry?.attempts} solved=${entry?.solved} spec=${instancesNow}`);
  check('“Last result” is still available after undo', await page.evaluate(() => [...document.querySelectorAll('.fz-brief button')].some(button => /Last result/.test(button.textContent))));

  // Back to design: its history is still there.
  await navigate('Design'); await wait(300);
  h = await historyState();
  check('Returning to Design restores that canvas’s history (its redo entry survives)', /Redo Rename Orders DB/.test(h[1].label), h[1].label);
} catch (error) {
  await finish(error);
}
await finish();
