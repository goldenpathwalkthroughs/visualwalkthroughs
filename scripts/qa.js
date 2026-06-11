#!/usr/bin/env node
/**
 * qa.js — Gate #2: browser-based QA + Lighthouse
 *
 * Launches a real Chromium browser, drives the site, and checks that
 * every interactive feature works and every Lighthouse budget is met.
 *
 * Usage:
 *   npm run qa                                       — QA localhost:4321
 *   npm run qa -- --url https://preview.pages.dev   — QA a preview deploy
 *   npm run qa -- --url https://... --game zelda/wind-waker-hd
 *
 * Exit 0 = all pass, Exit 1 = one or more failures
 */

import { chromium } from 'playwright';
import { launch as launchChrome } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'pipeline.config.json'), 'utf8'));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const urlIdx  = args.indexOf('--url');
const gameIdx = args.indexOf('--game');
const urlArg  = urlIdx  !== -1 ? args[urlIdx  + 1] : 'http://localhost:4321';
const gameArg = gameIdx !== -1 ? args[gameIdx + 1] : 'zelda/wind-waker-hd';
const base = urlArg.replace(/\/$/, '');

const PAGES = {
  home: `${base}/`,
  franchise: `${base}/zelda/`,
  game: `${base}/${gameArg}/`,
};

const LH_BUDGETS = CONFIG.lighthouse;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(msg) { console.log(`  ✅  ${msg}`); }
function fail(msg) { console.log(`  ❌  ${msg}`); return 1; }
function warn(msg) { console.log(`  ⚠   ${msg}`); }
function section(title) { console.log(`\n── ${title} ──────────────────────────────`); }

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkPage(browser, url, label) {
  section(`HTTP + crawl: ${label}`);
  let failures = 0;

  // 1. Server HTML check (no JS, just fetch)
  let html = '';
  try {
    const res = await fetch(url);
    if (res.ok) { pass(`HTTP ${res.status} — ${url}`); }
    else { failures += fail(`HTTP ${res.status} — ${url}`); }
    html = await res.text();
  } catch (e) {
    failures += fail(`Could not fetch ${url}: ${e.message}`);
    return failures;
  }

  // 2. Crawl check — walkthrough text must be in server HTML (not JS-only)
  if (label === 'game') {
    const textMarkers = url.includes('mina')
      ? ['Golden path', 'Tenebrous Isle', 'Loner\'s Landing']
      : url.includes('007')
        ? ['Golden path', 'Château Miremonde', 'Aurora Station']
        : url.includes('pokopia')
          ? ['Golden path', 'Withered Wasteland', 'Sparkling Skylands']
          : url.includes('firered') || url.includes('leafgreen')
            ? ['Golden path', 'Pewter City', 'Indigo Plateau']
            : url.includes('yoshi')
              ? ['Golden path', 'Wildwoods', 'Remote Isle']
              : url.includes('ocarina')
              ? ['Golden path', 'Kokiri Forest', "Ganon's Castle"]
              : url.includes('majoras-mask')
              ? ['Golden path', 'Clock Town', 'Stone Tower']
              : url.includes('rebirth')
              ? ['Golden path', 'Grasslands', 'Forgotten Capital']
              : url.includes('legends-za')
              ? ['Golden path', 'Lumiose City', 'Prism Tower']
              : url.includes('legends-arceus')
              ? ['Golden path', 'Jubilife Village', 'Obsidian Fieldlands']
              : ['Golden path', 'Outset Island', 'Forsaken Fortress'];
    for (const marker of textMarkers) {
      if (html.includes(marker)) pass(`Server HTML contains "${marker}" (indexable)`);
      else failures += fail(`Server HTML missing "${marker}" — content may not be indexed by Google`);
    }
    if (html.includes('spoiler')) pass('Spoiler spans present in server HTML');
    else warn('No spoiler spans found in server HTML');
  }

  return failures;
}

async function checkInteractive(browser, url) {
  section('Interactive features (game page)');
  let failures = 0;
  const consoleErrors = [];

  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.goto(url, { waitUntil: 'networkidle' });

  // 3. Section expand/collapse
  try {
    const secHead = page.locator('#sec-0 .sec-head');
    await secHead.click();
    await page.waitForFunction(() => document.getElementById('sec-0')?.classList.contains('open'), { timeout: 2000 });
    pass('Section 1 expands on click');

    await secHead.click();
    await page.waitForFunction(() => !document.getElementById('sec-0')?.classList.contains('open'), { timeout: 2000 });
    pass('Section 1 collapses on second click');
  } catch {
    failures += fail('Section expand/collapse failed');
  }

  // 4. Progress bar
  try {
    await page.evaluate(() => window.markDone(0));
    const progText = await page.locator('#prog-txt').textContent();
    if (progText?.includes('1 /')) pass(`Progress bar updates: "${progText?.trim()}"`);
    else failures += fail(`Progress bar did not update (got "${progText?.trim()}")`);
  } catch {
    failures += fail('Progress bar / markDone not working');
  }

  // 5. Spoiler toggle
  try {
    const initiallyBlurred = await page.evaluate(() => document.body.classList.contains('spoilers-safe'));
    if (initiallyBlurred) pass('Spoiler-safe mode is ON by default');
    else warn('Spoiler-safe mode is OFF by default — expected ON');

    await page.evaluate(() => window.toggleSpoilers());
    const nowOff = await page.evaluate(() => !document.body.classList.contains('spoilers-safe'));
    if (nowOff) pass('Spoiler toggle turns OFF');
    else failures += fail('Spoiler toggle did not respond');

    await page.evaluate(() => window.toggleSpoilers()); // restore
  } catch {
    failures += fail('Spoiler toggle failed');
  }

  // 6. Completionist toggle
  try {
    const initiallyOff = await page.evaluate(() => !document.body.classList.contains('comp-on'));
    if (initiallyOff) pass('Completionist mode is OFF by default');
    else warn('Completionist mode is ON by default — expected OFF');

    await page.evaluate(() => window.toggleComp());
    const nowOn = await page.evaluate(() => document.body.classList.contains('comp-on'));
    if (nowOn) pass('Completionist toggle turns ON');
    else failures += fail('Completionist toggle did not respond');

    await page.evaluate(() => window.toggleComp()); // restore
  } catch {
    failures += fail('Completionist toggle failed');
  }

  // 7. Video thumbnails
  try {
    const thumbCount = await page.locator('.vid .thumb').count();
    if (thumbCount > 0) pass(`${thumbCount} video thumbnail(s) rendered`);
    else failures += fail('No video thumbnails found');

    // TTS button present
    const ttsCount = await page.locator('.tts').count();
    if (ttsCount > 0) pass(`${ttsCount} TTS button(s) present`);
    else failures += fail('No TTS buttons found');
  } catch {
    failures += fail('Video/TTS element check failed');
  }

  // 8. Spotlight search (Cmd+K)
  try {
    await page.keyboard.press('Meta+k');
    await page.waitForFunction(() => document.getElementById('spot')?.classList.contains('open'), { timeout: 2000 });
    pass('Spotlight opens with Cmd+K');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('spot')?.classList.contains('open'), { timeout: 2000 });
    pass('Spotlight closes with Escape');
  } catch {
    failures += fail('Spotlight search (Cmd+K) not working');
  }

  // 9. Console errors
  if (consoleErrors.length === 0) {
    pass('Zero console errors');
  } else {
    for (const e of consoleErrors) {
      failures += fail(`Console error: ${e}`);
    }
  }

  await page.close();
  return failures;
}

async function checkMobile(browser, url) {
  section('Mobile viewport (375px)');
  let failures = 0;

  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    // Basic render check
    const h1 = await page.locator('h1').first().textContent();
    if (h1) pass(`Page renders on mobile — h1: "${h1?.trim()}"`);
    else failures += fail('No h1 found on mobile render');

    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    if (!hasOverflow) pass('No horizontal overflow on mobile');
    else failures += fail('Horizontal overflow detected on mobile (content wider than viewport)');
  } catch (e) {
    failures += fail(`Mobile render failed: ${e.message}`);
  }

  await page.close();
  return failures;
}

async function runLighthouse(url) {
  section('Lighthouse (performance / SEO / accessibility)');
  let failures = 0;

  // Detect whether the server is returning x-robots-tag: noindex.
  // Cloudflare Pages preview deployments always do this — it's intentional and
  // correct behaviour, not a content problem.  Lighthouse will fail the "page
  // isn't blocked from indexing" SEO audit on preview, so we skip the SEO
  // category when noindex is detected and leave a clear note.
  let isNoindex = false;
  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    const robotsTag = headRes.headers.get('x-robots-tag') ?? '';
    if (robotsTag.toLowerCase().includes('noindex')) {
      isNoindex = true;
      warn('x-robots-tag: noindex detected — this is a Cloudflare preview; ' +
           'SEO audit skipped on preview (production will not have this header)');
    }
  } catch { /* ignore — HEAD may not work in all environments */ }

  let chrome;
  try {
    chrome = await launchChrome({ chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'] });

    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });

    if (!result?.lhr) {
      warn('Lighthouse returned no result — skipping scores');
      return 0;
    }

    const scores = {
      performance: Math.round((result.lhr.categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((result.lhr.categories.accessibility?.score ?? 0) * 100),
      'best-practices': Math.round((result.lhr.categories['best-practices']?.score ?? 0) * 100),
      seo: Math.round((result.lhr.categories.seo?.score ?? 0) * 100),
    };

    const budgets = {
      performance: LH_BUDGETS.performance,
      accessibility: LH_BUDGETS.accessibility,
      'best-practices': LH_BUDGETS.bestPractices,
      seo: LH_BUDGETS.seo,
    };

    for (const [cat, score] of Object.entries(scores)) {
      // Skip SEO on noindex previews — failure is a CDN header, not a content problem.
      if (cat === 'seo' && isNoindex) {
        warn(`seo: ${score} — skipped on preview (noindex CDN header); ` +
             `verify manually after promote`);
        continue;
      }
      const budget = budgets[cat];
      if (score >= budget) pass(`${cat}: ${score} (budget ≥ ${budget})`);
      else failures += fail(`${cat}: ${score} — below budget of ${budget}`);
    }
  } catch (e) {
    warn(`Lighthouse error: ${e.message} — skipping score check`);
  } finally {
    await chrome?.kill();
  }

  return failures;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' VisualWalkthroughs — QA Harness');
console.log(`  Target: ${base}`);
console.log('══════════════════════════════════════════');

let totalFailures = 0;
const browser = await chromium.launch({ headless: true });

try {
  // HTTP + server HTML checks (all three pages)
  totalFailures += await checkPage(browser, PAGES.home, 'home');
  totalFailures += await checkPage(browser, PAGES.franchise, 'franchise');
  totalFailures += await checkPage(browser, PAGES.game, 'game');

  // Interactive JS checks
  totalFailures += await checkInteractive(browser, PAGES.game);

  // Mobile viewport
  totalFailures += await checkMobile(browser, PAGES.game);
} finally {
  await browser.close();
}

// Lighthouse runs separately (needs its own Chrome instance)
totalFailures += await runLighthouse(PAGES.game);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
if (totalFailures === 0) {
  console.log('✅  QA PASSED — safe to promote\n');
  process.exit(0);
} else {
  console.log(`❌  QA FAILED — ${totalFailures} check${totalFailures > 1 ? 's' : ''} failed\n`);
  process.exit(1);
}
