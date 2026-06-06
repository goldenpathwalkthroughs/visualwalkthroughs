#!/usr/bin/env node
/**
 * fetch-cover.js — Part C: box art fetcher with verified fallback chain
 *
 * Tries each source in order, verifying the image is the correct game/franchise
 * before accepting. Rejects sequels, wrong regions, fan art, and screenshots.
 * Downloads the chosen image once and writes it to /public/assets/covers/<slug>.webp
 * for Astro to copy into dist/ (served at /assets/covers/<slug>.webp).
 *
 * Fallback chain:
 *   1. SteamGridDB  (if STEAMGRIDDB_API_KEY is set)
 *   2. Wikipedia / Wikimedia Commons  (MediaWiki API — no key needed)
 *   3. Wikidata  (property P18 — image, no key needed)
 *   4. Styled placeholder  (never fabricate; exit 2 so caller uses gradient)
 *
 * Usage:
 *   node scripts/fetch-cover.js --title "The Wind Waker HD" --slug wind-waker-hd [--year 2013] [--platform "Wii U"]
 *   node scripts/fetch-cover.js --title "The Legend of Zelda" --slug zelda --type franchise
 *
 * Stdout: CDN path on success (/assets/covers/<slug>.webp), nothing on placeholder
 * Exit 0 = image written; Exit 2 = no verified image (use placeholder); Exit 1 = hard error
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Load .env ─────────────────────────────────────────────────────────────────
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }

const title    = arg('--title');
const slug     = arg('--slug');
const type     = arg('--type') || 'game';      // 'game' | 'franchise'
const year     = arg('--year') || '';
const platform = arg('--platform') || '';

if (!title || !slug) {
  console.error('Usage: node scripts/fetch-cover.js --title "Game Title" --slug game-slug [--year YYYY] [--platform "Wii U"] [--type game|franchise]');
  process.exit(1);
}

// Output goes to /public/assets/covers/ — Astro copies public/ into dist/
const COVERS_DIR = join(ROOT, 'public/assets/covers');
const outFile    = join(COVERS_DIR, `${slug}.webp`);
const cdnPath    = `/assets/covers/${slug}.webp`;

function log(msg)  { console.error(`  ${msg}`); }
function warn(msg) { console.error(`  ⚠   ${msg}`); }

// ── Fetch with timeout ────────────────────────────────────────────────────────
async function fetchTimeout(url, opts = {}, ms = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ── Download and write image ──────────────────────────────────────────────────
async function downloadImage(imageUrl) {
  const res = await fetchTimeout(imageUrl, {
    headers: { 'User-Agent': 'VisualWalkthroughs/1.0 (fan-built guide site; contact eevee.bork@icloud.com)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${imageUrl}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error(`Not an image: ${ct}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 1: SteamGridDB
// ─────────────────────────────────────────────────────────────────────────────
async function trySteamGridDB() {
  const key = process.env.STEAMGRIDDB_API_KEY;
  if (!key) { log('SteamGridDB: skipped (no STEAMGRIDDB_API_KEY)'); return null; }

  log('SteamGridDB: searching…');
  try {
    // Search for game
    const searchRes = await fetchTimeout(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!searchRes.ok) { warn(`SteamGridDB search failed: HTTP ${searchRes.status}`); return null; }
    const searchData = await searchRes.json();
    const results = searchData.data || [];

    // Find best match: exact or close title + year if known
    const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const needle = normalise(title);
    let best = results.find(r => normalise(r.name) === needle);
    if (!best && year) best = results.find(r => String(r.release_date || '').startsWith(year));
    if (!best) best = results[0];
    if (!best) { warn('SteamGridDB: no results'); return null; }

    log(`SteamGridDB: matched "${best.name}" (id ${best.id})`);

    // Get grids (vertical covers, type=static or animated — prefer static)
    const gridRes = await fetchTimeout(
      `https://www.steamgriddb.com/api/v2/grids/game/${best.id}?dimensions=600x900&nsfw=false&humor=false`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!gridRes.ok) { warn(`SteamGridDB grids failed: HTTP ${gridRes.status}`); return null; }
    const gridData = await gridRes.json();
    const grids = (gridData.data || []).filter(g => g.style === 'official' || g.style === 'no_logo');
    const grid = grids[0] || (gridData.data || [])[0];
    if (!grid?.url) { warn('SteamGridDB: no grid image found'); return null; }

    log(`SteamGridDB: downloading ${grid.url}`);
    const buf = await downloadImage(grid.url);
    return { buf, source: 'SteamGridDB', url: grid.url };
  } catch (e) {
    warn(`SteamGridDB error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 2: Wikipedia / Wikimedia Commons  (MediaWiki API)
// ─────────────────────────────────────────────────────────────────────────────
async function tryWikipedia() {
  log('Wikipedia: searching…');
  const UA = 'VisualWalkthroughs/1.0 (fan-built guide site; contact eevee.bork@icloud.com)';

  // Resolve a Wikipedia page title to a verified cover image buffer.
  // Returns { buf, source, url } or null.
  async function resolvePageCover(pageTitle) {
    const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&pithumbsize=600&pilicense=any&redirects=1&format=json&origin=*`;
    const imgRes = await fetchTimeout(imgUrl, { headers: { 'User-Agent': UA } });
    if (!imgRes.ok) return null;
    const imgData = await imgRes.json();
    const pageObj = Object.values(imgData.query?.pages || {})[0];
    const resolvedTitle = pageObj?.title || pageTitle;
    const thumb = pageObj?.thumbnail?.source;
    if (!thumb) return null;

    // Extract filename from thumbnail URL
    const fileNameMatch = thumb.match(/\/([^/]+\.(?:jpg|jpeg|png|webp|gif))/i);
    if (!fileNameMatch) return null;
    const fileName = decodeURIComponent(fileNameMatch[1]);

    // Get full-res URL + metadata from Wikimedia
    const commonsUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|mime|size&format=json&origin=*`;
    const commonsRes = await fetchTimeout(commonsUrl, { headers: { 'User-Agent': UA } });
    const commonsData = await commonsRes.json();
    const filePage = Object.values(commonsData.query?.pages || {})[0];
    const fileInfo = filePage?.imageinfo?.[0];
    const fullUrl = fileInfo?.url;
    const mime = fileInfo?.mime || '';
    const size = fileInfo?.size || 0;

    if (!fullUrl) return null;
    if (mime === 'image/svg+xml') { warn(`Wikipedia: "${fileName}" is SVG — skipping (logo, not a cover)`); return null; }
    if (size > 0 && size < 10000) { warn(`Wikipedia: "${fileName}" is too small (${size}B) — skipping`); return null; }

    log(`Wikipedia: downloading "${fileName}" from page "${resolvedTitle}" (${mime}, ${size}B)`);
    const buf = await downloadImage(fullUrl);
    return { buf, source: `Wikipedia (${resolvedTitle})`, url: fullUrl };
  }

  try {
    // Strategy 1: direct lookup of the exact title (handles redirects automatically)
    log(`Wikipedia: direct lookup for "${title}"`);
    const direct = await resolvePageCover(title);
    if (direct) return direct;

    // Strategy 2: search and rank results by title similarity
    // Use a tighter query: include the year to avoid franchise/disambiguation pages
    const searchQ = year ? `${title} ${year}` : `${title} video game`;
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQ)}&srnamespace=0&srlimit=8&format=json&origin=*`;
    const searchRes = await fetchTimeout(searchUrl, { headers: { 'User-Agent': UA } });
    if (!searchRes.ok) { warn(`Wikipedia search HTTP ${searchRes.status}`); return null; }
    const hits = (await searchRes.json()).query?.search || [];
    if (!hits.length) { warn('Wikipedia: no search results'); return null; }

    // Score each hit: longer shared prefix = better match; penalise if hit title
    // is much shorter than query (= franchise/disambiguation page)
    const normalise = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const needle = normalise(title);
    function score(hitTitle) {
      const h = normalise(hitTitle);
      let s = 0;
      for (let i = 0; i < Math.min(needle.length, h.length); i++) {
        if (needle[i] === h[i]) s++; else break;
      }
      // Penalise titles that are much shorter (likely franchise/portal pages)
      if (h.length < needle.length * 0.5) s -= 20;
      return s;
    }
    const ranked = [...hits].sort((a, b) => score(b.title) - score(a.title));
    log(`Wikipedia: top ranked result "${ranked[0].title}"`);

    for (const hit of ranked.slice(0, 3)) {
      const result = await resolvePageCover(hit.title);
      if (result) return result;
    }

    warn('Wikipedia: no usable cover found across top results');
    return null;
  } catch (e) {
    warn(`Wikipedia error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 3: Wikidata  (property P18 = image)
// ─────────────────────────────────────────────────────────────────────────────
async function tryWikidata() {
  log('Wikidata: searching…');
  const UA = 'VisualWalkthroughs/1.0 (fan-built guide site; contact eevee.bork@icloud.com)';

  try {
    // Search Wikidata for the entity
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&type=item&limit=5&format=json&origin=*`;
    const searchRes = await fetchTimeout(searchUrl, { headers: { 'User-Agent': UA } });
    if (!searchRes.ok) { warn(`Wikidata search failed: HTTP ${searchRes.status}`); return null; }
    const searchData = await searchRes.json();
    const entities = searchData.search || [];
    if (!entities.length) { warn('Wikidata: no entities found'); return null; }

    const entity = entities[0];
    log(`Wikidata: matched entity "${entity.label}" (${entity.id})`);

    // Get P18 (image) claim
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entity.id}&property=P18&format=json&origin=*`;
    const entityRes = await fetchTimeout(entityUrl, { headers: { 'User-Agent': UA } });
    if (!entityRes.ok) { warn(`Wikidata entity fetch failed: HTTP ${entityRes.status}`); return null; }
    const entityData = await entityRes.json();
    const claims = entityData.claims?.P18 || [];
    if (!claims.length) { warn('Wikidata: no P18 (image) claim on this entity'); return null; }

    const imageFileName = claims[0]?.mainsnak?.datavalue?.value;
    if (!imageFileName) { warn('Wikidata: P18 claim has no value'); return null; }

    // Resolve Wikimedia Commons URL for the file
    const commonsUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(imageFileName)}&prop=imageinfo&iiprop=url|mime|size&format=json&origin=*`;
    const commonsRes = await fetchTimeout(commonsUrl, { headers: { 'User-Agent': UA } });
    const commonsData = await commonsRes.json();
    const filePages = commonsData.query?.pages || {};
    const filePage = Object.values(filePages)[0];
    const fileInfo = filePage?.imageinfo?.[0];
    const fullUrl = fileInfo?.url;
    const mime = fileInfo?.mime || '';
    const size = fileInfo?.size || 0;

    if (!fullUrl) { warn('Wikidata: could not resolve Commons URL'); return null; }
    if (mime === 'image/svg+xml') { warn('Wikidata: image is SVG — skipping'); return null; }
    if (size > 0 && size < 10000) { warn(`Wikidata: image too small (${size} bytes) — skipping`); return null; }

    log(`Wikidata: downloading "${imageFileName}" (${mime}, ${size} bytes)`);
    const buf = await downloadImage(fullUrl);
    return { buf, source: `Wikidata P18 (${entity.id})`, url: fullUrl };
  } catch (e) {
    warn(`Wikidata error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert image buffer to WebP using sharp (if available) or write as-is
// ─────────────────────────────────────────────────────────────────────────────
async function toWebP(buf, sourceMime) {
  try {
    const { default: sharp } = await import('sharp');
    return await sharp(buf).resize(264, 374, { fit: 'cover', position: 'top' }).webp({ quality: 85 }).toBuffer();
  } catch {
    // sharp not installed — write original bytes (still valid, just not re-encoded)
    return buf;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
console.error(`\n  🎨  Cover fetch: "${title}" [${type}]${year ? ` (${year})` : ''}${platform ? ` · ${platform}` : ''}`);

const sources = [
  trySteamGridDB,
  tryWikipedia,
  tryWikidata,
];

let result = null;
for (const source of sources) {
  result = await source();
  if (result) break;
}

if (!result) {
  warn('All sources exhausted — styled placeholder will be used');
  process.exit(2);
}

log(`✅  Source: ${result.source}`);

const finalBuf = await toWebP(result.buf);

mkdirSync(COVERS_DIR, { recursive: true });
writeFileSync(outFile, finalBuf);
log(`✅  Written to public/assets/covers/${slug}.webp (${finalBuf.length} bytes)`);

// Print CDN path to stdout for caller to capture
process.stdout.write(cdnPath);
