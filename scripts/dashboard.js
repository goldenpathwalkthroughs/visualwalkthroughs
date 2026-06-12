#!/usr/bin/env node
/**
 * dashboard.js — VisualWalkthroughs LiveOps dashboard generator
 *
 * Reads the repo's own operational data and renders a single self-contained
 * HTML file (ops-dashboard.html) with the key information an operations manager
 * needs at a glance: catalogue, releases, recent changes, the latest nightly
 * report, what needs the owner, and the pipeline guardrails.
 *
 * It only READS — never writes content, never touches protected paths, never
 * deploys. Regenerate any time with:  npm run dashboard
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'ops-dashboard.html');
const PROD = 'https://visualwalkthroughs.pages.dev';

// ── helpers ───────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
// minimal inline markdown → html (bold + `code`), for report lines
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

// ── gather data ───────────────────────────────────────────────────────────────
const gamesDir = join(ROOT, 'content/games');
const games = readdirSync(gamesDir).filter((f) => f.endsWith('.json')).map((f) => {
  const d = readJSON(join(gamesDir, f));
  return {
    title: d.title, slug: d.slug, franchise: d.franchiseSlug, year: d.year,
    status: d.status ?? 'published', platforms: d.platforms ?? [],
    sections: (d.sections ?? []).length, bosses: (d.bossFights ?? []).length,
  };
}).sort((a, b) => a.franchise.localeCompare(b.franchise) || a.title.localeCompare(b.title));

const franDir = join(ROOT, 'content/franchises');
const franchises = readdirSync(franDir).filter((f) => f.endsWith('.json')).map((f) => readJSON(join(franDir, f)))
  .sort((a, b) => (a.featureRank ?? 99) - (b.featureRank ?? 99));

const cfg = readJSON(join(ROOT, 'pipeline.config.json'));

// releases (annotated/lightweight tags) with their date
const tags = sh("git tag -l 'release-*'").split('\n').filter(Boolean);
const releases = tags.map((t) => ({ tag: t, date: sh(`git log -1 --format=%ci ${t}`).slice(0, 10), subject: sh(`git log -1 --format=%s ${t}`) }))
  .filter((r) => r.date).sort((a, b) => b.date.localeCompare(a.date) || b.tag.localeCompare(a.tag));

// recent changes (commit log)
const log = sh("git log -16 --format=%h\x1f%ci\x1f%s").split('\n').filter(Boolean).map((l) => {
  const [hash, ci, subject] = l.split('\x1f');
  return { hash, date: (ci || '').slice(0, 10), subject: subject || '' };
});

// nightly reports
const repDir = join(ROOT, 'reports');
const reports = existsSync(repDir) ? readdirSync(repDir).filter((f) => f.endsWith('.md')).sort().reverse() : [];
const latestReport = reports[0];
let reportSections = {};
if (latestReport) {
  const txt = readFileSync(join(repDir, latestReport), 'utf8');
  // split on "## " headers
  const parts = txt.split(/^##\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const head = p.slice(0, nl).trim().toLowerCase();
    const body = p.slice(nl + 1).trim();
    reportSections[head] = body;
  }
}
const pickSection = (...keys) => {
  for (const k of Object.keys(reportSections)) if (keys.some((kw) => k.includes(kw))) return reportSections[k];
  return null;
};
const ownerBody = pickSection('owner');
const spendBody = pickSection('spend');
const publishedBody = pickSection('published');
const shortlistBody = pickSection('shortlist', 'advisor');

// report body → list of clean lines (strip leading bullets)
const bodyLines = (body, max = 8) => (body || '').split('\n').map((l) => l.replace(/^[-*]\s+/, '').trim())
  .filter((l) => l && !l.startsWith('#')).slice(0, max);

// ── KPIs ──────────────────────────────────────────────────────────────────────
const published = games.filter((g) => g.status === 'published');
const drafts = games.filter((g) => g.status !== 'published');
const latestRelease = releases[0];
const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const byFranchise = franchises.map((f) => ({ ...f, games: games.filter((g) => g.franchise === f.slug) }));

// ── render ──────────────────────────────────────────────────────────────────
const kpi = (label, value, sub) => `
  <div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

const ownerCard = ownerBody && bodyLines(ownerBody).length && !/^nothing|^none\b/i.test(ownerBody.trim())
  ? `<div class="card alert"><h2>⚠ Needs the owner</h2><ul>${bodyLines(ownerBody).map((l) => `<li>${md(l)}</li>`).join('')}</ul><div class="src">from ${esc(latestReport)}</div></div>`
  : `<div class="card ok"><h2>✓ Needs the owner</h2><p>Nothing flagged in the latest report (${esc(latestReport || '—')}).</p></div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VisualWalkthroughs · LiveOps</title>
<style>
:root{--bg:#0b0e13;--panel:#141925;--panel2:#1b2230;--line:rgba(255,255,255,.09);--text:#eef0f6;--muted:#9aa1b4;--muted2:#6b7186;--accent:#f2b34b;--green:#5fcf8f;--red:#ff6a5a;--blue:#5fb6e8;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:0 0 80px}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
header{background:linear-gradient(160deg,#161b27,#0d1118);border-bottom:1px solid var(--line);padding:26px 0 22px;margin-bottom:26px}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
h1{font-size:1.5rem;margin:0;letter-spacing:-.02em}
h1 span{color:var(--accent)}
.gen{color:var(--muted2);font-size:.82rem;font-family:var(--mono)}
.prod{color:var(--green);text-decoration:none;font-size:.85rem;font-weight:600}
.prod::before{content:"●";margin-right:6px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:26px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.kpi-label{color:var(--muted2);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.kpi-value{font-size:1.7rem;font-weight:700;margin-top:6px;letter-spacing:-.02em}
.kpi-sub{color:var(--muted);font-size:.82rem;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.card h2{font-size:1rem;margin:0 0 12px;letter-spacing:-.01em}
.card.alert{border-color:rgba(255,106,90,.4);background:linear-gradient(160deg,rgba(255,106,90,.08),var(--panel))}
.card.alert h2{color:var(--red)}
.card.ok h2{color:var(--green)}
.card .src{color:var(--muted2);font-size:.74rem;margin-top:10px;font-family:var(--mono)}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th{text-align:left;color:var(--muted2);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;font-size:.66rem;font-weight:700;padding:2px 8px;border-radius:5px}
.pill.pub{background:rgba(95,207,143,.16);color:var(--green)}
.pill.draft{background:rgba(242,179,75,.16);color:var(--accent)}
.pill.off{background:rgba(95,207,143,.16);color:var(--green)}
.mono{font-family:var(--mono);font-size:.82rem;color:var(--muted)}
.tag{font-family:var(--mono);font-size:.78rem;color:var(--accent)}
ul{margin:0;padding-left:18px}
li{margin:3px 0}
code{font-family:var(--mono);font-size:.85em;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px}
.full{grid-column:1/-1}
.muted{color:var(--muted)}
.rel{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);align-items:baseline}
.rel:last-child{border-bottom:0}
.rel .d{font-family:var(--mono);font-size:.78rem;color:var(--muted2);flex:0 0 92px}
.cfgrow{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.cfgrow:last-child{border-bottom:0}
.cfgrow b{font-weight:600}
.foot{color:var(--muted2);font-size:.78rem;text-align:center;margin-top:30px}
</style></head><body>
<header><div class="wrap">
  <div><h1>Visual<span>Walkthroughs</span> · LiveOps</h1><div class="gen">generated ${esc(generated)} · regenerate with <code>npm run dashboard</code></div></div>
  <div style="text-align:right"><a class="prod" href="${PROD}" target="_blank">production live</a><div class="gen">latest: ${latestRelease ? esc(latestRelease.tag) : '—'}</div></div>
</div></header>
<div class="wrap">

  <div class="kpis">
    ${kpi('Published guides', published.length, `${drafts.length} draft${drafts.length === 1 ? '' : 's'} in progress`)}
    ${kpi('Franchises', franchises.length, byFranchise.map((f) => f.name).slice(0, 4).join(' · '))}
    ${kpi('Latest release', latestRelease ? `<span class="tag">${esc(latestRelease.date)}</span>` : '—', latestRelease ? esc(latestRelease.tag) : '')}
    ${kpi('Releases logged', releases.length, `since ${releases.length ? esc(releases[releases.length - 1].date) : '—'}`)}
    ${kpi('Spend cap', `£${cfg.spendCapGBP}`, `${cfg.timeCapMinutes} min/run · overflow <span class="pill off">OFF</span>`)}
    ${kpi('Nightly cadence', `${cfg.gamesPerNight}/night`, `${cfg.maxFixAttempts} fix attempts max`)}
  </div>

  <div class="grid">
    ${ownerCard}
    <div class="card">
      <h2>📰 Latest nightly · ${esc(latestReport || '—')}</h2>
      ${publishedBody ? `<ul>${bodyLines(publishedBody, 6).map((l) => `<li>${md(l)}</li>`).join('')}</ul>` : '<p class="muted">No report parsed.</p>'}
      ${spendBody ? `<div class="src">Spend: ${md(bodyLines(spendBody, 1)[0] || '—')}</div>` : ''}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>📚 Catalogue by franchise</h2>
      <table><thead><tr><th>Franchise</th><th>Guides</th><th>Titles</th></tr></thead><tbody>
      ${byFranchise.map((f) => `<tr><td><b>${esc(f.name)}</b><div class="mono">${esc(f.slug)}</div></td><td>${f.games.length}${f.guideCount !== f.games.length ? ` <span class="muted">(json: ${esc(f.guideCount)})</span>` : ''}</td><td>${f.games.map((g) => esc(g.title)).join('<br>') || '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card">
      <h2>🚀 Release timeline</h2>
      ${releases.slice(0, 12).map((r) => `<div class="rel"><span class="d">${esc(r.date)}</span><div><span class="tag">${esc(r.tag.replace('release-', ''))}</span><div class="muted" style="font-size:.82rem">${esc(r.subject).slice(0, 70)}</div></div></div>`).join('')}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>🔧 Recent changes</h2>
      <table><tbody>
      ${log.map((c) => `<tr><td class="mono" style="white-space:nowrap">${esc(c.date)}</td><td class="tag">${esc(c.hash)}</td><td>${esc(c.subject).slice(0, 80)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card">
      <h2>🛡 Pipeline &amp; guardrails</h2>
      <div class="cfgrow"><span class="muted">Games per night</span><b>${cfg.gamesPerNight}</b></div>
      <div class="cfgrow"><span class="muted">Spend cap</span><b>£${cfg.spendCapGBP}</b></div>
      <div class="cfgrow"><span class="muted">Time cap</span><b>${cfg.timeCapMinutes} min</b></div>
      <div class="cfgrow"><span class="muted">Max fix attempts</span><b>${cfg.maxFixAttempts}</b></div>
      <div class="cfgrow"><span class="muted">Subscription overflow</span><b><span class="pill off">${cfg.subscriptionOverflow ? 'ON' : 'OFF'}</span></b></div>
      <div class="cfgrow"><span class="muted">Lighthouse budgets</span><b class="mono">perf ${cfg.lighthouse.performance} · a11y ${cfg.lighthouse.accessibility} · seo ${cfg.lighthouse.seo} · bp ${cfg.lighthouse.bestPractices}</b></div>
      <div class="cfgrow"><span class="muted">Protected paths</span><b>${(cfg.protectedPaths || []).length}</b></div>
    </div>
  </div>

  ${shortlistBody ? `<div class="card full"><h2>🔭 Content Advisor shortlist (next up)</h2><ul>${bodyLines(shortlistBody, 8).map((l) => `<li>${md(l)}</li>`).join('')}</ul><div class="src">from ${esc(latestReport)}</div></div>` : ''}

  <div class="card full" style="margin-top:18px">
    <h2>🗂 Reports archive</h2>
    <div class="mono">${reports.map((r) => esc(r)).join(' · ') || '—'}</div>
  </div>

  <div class="foot">Read-only snapshot from repo data · no network calls · regenerate with <code>npm run dashboard</code></div>
</div></body></html>`;

writeFileSync(OUT, html);
console.log(`✅  LiveOps dashboard written: ${OUT}`);
console.log(`    ${published.length} published guides · ${franchises.length} franchises · ${releases.length} releases · latest ${latestRelease ? latestRelease.tag : '—'}`);
console.log(`    Open it:  open "${OUT}"`);
