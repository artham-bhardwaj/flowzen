// Shared setup for Flowzen's browser smoke suites.
//
// Serves the production build (dist/) with Vite's preview server on a free port and drives a locally
// installed Chrome/Chromium through puppeteer-core (no browser is downloaded). Each suite gets a fresh
// browser profile and empty localStorage.
//
// Environment:
//   CHROME_PATH        browser executable, if not in a standard location
//   SMOKE_SCREENSHOTS  directory to save screenshots into (optional)
//
// Exit codes: 0 all checks passed, 1 a check failed or the suite crashed, 2 environment not available.
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

export const ENVIRONMENT_UNAVAILABLE = 2;
const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Starts a suite. Returns the page, a `check` recorder, common helpers, and `finish()` (prints the summary and exits). */
export async function startSuite(name) {
  const executablePath = candidates.find(path => existsSync(path));
  if (!executablePath) { console.error(`[${name}] No Chrome/Chromium found. Set CHROME_PATH to run the browser smoke tests.`); process.exit(ENVIRONMENT_UNAVAILABLE); }
  if (!existsSync(`${root}dist/index.html`)) { console.error(`[${name}] No production build found. Run \`npm run build\` first (or use \`npm run test:browser\`).`); process.exit(ENVIRONMENT_UNAVAILABLE); }

  const server = await preview({ root, preview: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'silent' });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--window-size=1440,900'] });
  await browser.defaultBrowserContext().overridePermissions(url.replace(/\/$/, ''), ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = []; const results = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  const check = (label, ok, detail = '') => { results.push({ label, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
  const shots = process.env.SMOKE_SCREENSHOTS;
  const helpers = {
    /** Saves a screenshot when SMOKE_SCREENSHOTS is set. */
    shot: async file => { if (shots) { mkdirSync(`${shots}/${name}`, { recursive: true }); await page.screenshot({ path: `${shots}/${name}/${file}.png` }); } },
    /** Clicks the first element matching `selector` whose text (or aria-label) is exactly `text`. */
    clickText: (selector, text) => page.evaluate((selector, text) => {
      const target = [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === text || element.getAttribute('aria-label') === text);
      target?.click(); return Boolean(target);
    }, selector, text),
    /** Clicks the first element matching `selector` whose text matches `pattern`. */
    clickMatching: (selector, pattern) => page.evaluate((selector, source) => {
      const target = [...document.querySelectorAll(selector)].find(element => new RegExp(source).test(element.textContent) || new RegExp(source).test(element.getAttribute('aria-label') ?? ''));
      target?.click(); return Boolean(target);
    }, selector, pattern.source),
    press: async combo => { const keys = combo.split('+'); for (const key of keys.slice(0, -1)) await page.keyboard.down(key); await page.keyboard.press(keys.at(-1)); for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key); await wait(150); },
    /** Clicks a point where the canvas pane itself is on top (no node, edge, panel or overlay). */
    clickBlank: async () => {
      const point = await page.evaluate(() => {
        const pane = document.querySelector('.react-flow__pane'); const r = pane.getBoundingClientRect();
        for (let y = r.bottom - 20; y > r.top + 60; y -= 23) for (let x = r.left + 20; x < r.right - 60; x += 31) if (document.elementFromPoint(x, y) === pane) return { x, y };
        return null;
      });
      if (!point) throw new Error('no blank canvas point');
      await page.mouse.click(point.x, point.y); await wait(120);
    },
    /**
     * Goes to a workspace: 'Learn' or 'Challenges' (main navigation), or 'Lab' / 'Design' (the Playground's two modes,
     * reached through the Playground entry and its mode switch).
     */
    navigate: async target => {
      const click = (selector, text) => page.evaluate((selector, text) => { const button = [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === text); button?.click(); return Boolean(button); }, selector, text);
      if (target === 'Learn' || target === 'Challenges') { await click('.fz-nav button', target); await wait(400); return; }
      if (!await page.$('.fz-subnav')) { await click('.fz-nav button', 'Playground'); await wait(400); }
      await click('.fz-subnav button', target === 'Design' ? 'Canvas' : 'Lab'); await wait(400);
    },
    history: () => page.$$eval('.fz-history button', buttons => buttons.map(button => ({ disabled: button.disabled, label: button.getAttribute('aria-label') }))),
    progress: () => page.evaluate(() => JSON.parse(localStorage.getItem('flowzen-challenges-v1') ?? '{}')),
    text: selector => page.$eval(selector, element => element.textContent),
  };

  async function finish(crash) {
    if (crash) { console.error(crash); results.push({ label: 'suite completed without crashing', ok: false }); }
    check(`[${name}] no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
    const failed = results.filter(result => !result.ok).length;
    console.log(`\n[${name}] ${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
  return { page, url, check, finish, ...helpers };
}
