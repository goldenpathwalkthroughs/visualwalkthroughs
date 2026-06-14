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

// build queue (guides-to-do)
let queue = { queue: [], _meta: {} };
try { queue = readJSON(join(ROOT, 'content/queue.json')); } catch { /* no queue yet */ }
const builtSet = new Set(games.map((g) => g.title.toLowerCase()));
const queued = (queue.queue || []).filter((q) => q.status === 'queued' && !builtSet.has(String(q.title).toLowerCase()));
const onHold = (queue.queue || []).filter((q) => q.status === 'hold');
const nextUp = queued.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];

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

// ── live web analytics (Cloudflare Web Analytics / RUM) ─────────────────────
// Optional: fetches audience + behaviour data from the Cloudflare GraphQL API.
// Reads creds from .env (never printed/committed). Degrades gracefully — if the
// API is unreachable or the token lacks scope, the dashboard still generates.
function loadEnv() {
  const env = { ...process.env };
  const p = join(ROOT, '.env');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
function siteTag() {
  try {
    const m = readFileSync(join(ROOT, 'src/layouts/Base.astro'), 'utf8')
      .match(/data-cf-beacon=[^>]*"token":\s*"([a-f0-9]{32})"/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return null;
}
const CF_WA_LINK = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

async function fetchAnalytics() {
  const env = loadEnv();
  const token = env.CLOUDFLARE_API_TOKEN, account = env.CLOUDFLARE_ACCOUNT_ID, tag = siteTag();
  if (!token || !account) return { error: 'No CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID found in .env — live analytics skipped.' };
  if (!tag) return { error: 'No Web Analytics beacon token found in Base.astro — is the beacon enabled?' };
  const now = new Date();
  const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
  const ago = (days) => iso(new Date(now.getTime() - days * 864e5));
  const node = (alias, from, extra = '') =>
    `${alias}:rumPageloadEventsAdaptiveGroups(limit:${extra ? 12 : 1},filter:{siteTag:$s,datetime_geq:"${from}",datetime_leq:$e}${extra ? ',orderBy:[count_DESC]' : ''}){count ${extra ? extra : 'sum{visits}'}}`;
  const query = `query($a:String!,$s:String!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
    ${node('w1', ago(1))}
    ${node('w7', ago(7))}
    ${node('w30', ago(30))}
    ${node('pages', ago(7), 'dimensions{requestPath}')}
    ${node('refs', ago(7), 'dimensions{refererHost}')}
    ${node('countries', ago(7), 'dimensions{countryName}')}
    ${node('devices', ago(7), 'dimensions{deviceType}')}
  }}}`;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { a: account, s: tag, e: iso(now) } }),
    });
    clearTimeout(to);
    const j = await res.json();
    if (j.errors && j.errors.length) {
      const msg = j.errors[0]?.message || 'unknown error';
      return { error: `Cloudflare API error — the token may lack the "Account Analytics → Read" scope. (${msg})` };
    }
    const acc = j.data?.viewer?.accounts?.[0];
    if (!acc) return { error: 'No analytics account returned — check CLOUDFLARE_ACCOUNT_ID.' };
    const tot = (n) => ({ views: acc[n]?.[0]?.count ?? 0, visits: acc[n]?.[0]?.sum?.visits ?? 0 });
    const rows = (n, dim) => (acc[n] || []).map((r) => ({ label: r.dimensions?.[dim] || '—', count: r.count })).filter((r) => r.label);
    return {
      window: { from: ago(7).slice(0, 10), to: iso(now).slice(0, 10) },
      d1: tot('w1'), d7: tot('w7'), d30: tot('w30'),
      pages: rows('pages', 'requestPath'), refs: rows('refs', 'refererHost'),
      countries: rows('countries', 'countryName'), devices: rows('devices', 'deviceType'),
    };
  } catch (e) {
    return { error: `Could not reach the Cloudflare API (${e.name === 'AbortError' ? 'timeout' : e.message}). Dashboard generated without live analytics.` };
  }
}

// ── Deploy-sync / drift check (prod vs git) ──────────────────────────────────
// Flags the failure mode we hit: local commits not pushed, or the live
// deployment not matching origin/main (e.g. a direct upload bypassing the build).
async function gitDrift() {
  try { sh('git fetch origin --quiet'); } catch { /* offline — use last-known */ }
  const localHead = sh('git rev-parse --short HEAD');
  const originHead = sh('git rev-parse --short origin/main');
  const counts = sh('git rev-list --left-right --count HEAD...origin/main').split(/\s+/);
  const ahead = Number(counts[0]) || 0, behind = Number(counts[1]) || 0;

  const env = loadEnv();
  const token = env.CLOUDFLARE_API_TOKEN, account = env.CLOUDFLARE_ACCOUNT_ID;
  const project = env.CLOUDFLARE_PROJECT_NAME || 'visualwalkthroughs';
  let live = null, liveErr = null;
  if (token && account) {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments?env=production&per_page=1`,
        { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      clearTimeout(to);
      const d = (await res.json()).result?.[0];
      if (d) live = {
        commit: (d.deployment_trigger?.metadata?.commit_hash || '').slice(0, 7),
        isGit: d.deployment_trigger?.type === 'github:push' || !!d.deployment_trigger?.metadata?.commit_hash,
        when: (d.created_on || '').slice(0, 16).replace('T', ' '),
      };
      else liveErr = 'no deployments returned';
    } catch (e) { liveErr = e.name === 'AbortError' ? 'timeout' : e.message; }
  } else liveErr = 'no Cloudflare creds in .env';

  const matches = live && live.commit && originHead && (live.commit.startsWith(originHead) || originHead.startsWith(live.commit));
  let status, cls, msg;
  if (ahead > 0) { status = 'DRIFT'; cls = 'drift-bad'; msg = `${ahead} local commit${ahead === 1 ? '' : 's'} not pushed to origin/main — the live site can't include them. Run: git push origin main`; }
  else if (liveErr) { status = 'UNKNOWN'; cls = 'drift-warn'; msg = `Couldn't read the live deployment (${liveErr}). Showing git state only.`; }
  else if (live && !live.isGit) { status = 'DRIFT'; cls = 'drift-warn'; msg = 'Live production is a direct upload, not a git build — origin/main is not the source of truth. Push to main to let the git build take over.'; }
  else if (live && !matches) { status = 'DRIFT'; cls = 'drift-bad'; msg = `Live production is on ${live.commit}, but origin/main is ${originHead}. The live site is stale — redeploy/push to sync.`; }
  else { status = 'IN SYNC'; cls = 'drift-ok'; msg = 'Live production matches origin/main — pushing to main auto-deploys the full site.'; }
  return { localHead, originHead, ahead, behind, live, status, cls, msg };
}

const analytics = await fetchAnalytics();
const drift = await gitDrift();

// ── render ──────────────────────────────────────────────────────────────────
const kpi = (label, value, sub) => `
  <div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

const num = (n) => Number(n || 0).toLocaleString();
function analyticsCard(a) {
  if (a.error) {
    return `<div class="card full"><h2>📈 Audience &amp; behaviour</h2>
      <p class="muted">${esc(a.error)}</p>
      <p><a class="abtn" href="${CF_WA_LINK}" target="_blank">Open Cloudflare Web Analytics →</a></p></div>`;
  }
  const empty = a.d30.views === 0;
  const miniTable = (title, rows) => `<div class="abox"><div class="abox-h">${esc(title)}</div>${rows.length
    ? `<table>${rows.slice(0, 8).map((r) => `<tr><td>${esc(r.label)}</td><td class="anum">${num(r.count)}</td></tr>`).join('')}</table>`
    : '<div class="muted" style="font-size:.82rem;padding:4px 0">no data yet</div>'}</div>`;
  return `<div class="card full">
    <h2>📈 Audience &amp; behaviour <span class="muted" style="font-weight:400;font-size:.8rem">· Cloudflare Web Analytics · ${esc(a.window.from)} → ${esc(a.window.to)}</span></h2>
    ${empty ? '<p class="muted">The beacon is live and collecting — Cloudflare just has no page views recorded yet (it went live very recently, and data can take a few hours to surface). These figures fill in automatically on the next <code>npm run dashboard</code>.</p>' : ''}
    <div class="astats">
      <div class="astat"><div class="kpi-label">Views · 24h</div><div class="kpi-value">${num(a.d1.views)}</div><div class="kpi-sub">${num(a.d1.visits)} visits</div></div>
      <div class="astat"><div class="kpi-label">Views · 7d</div><div class="kpi-value">${num(a.d7.views)}</div><div class="kpi-sub">${num(a.d7.visits)} visits</div></div>
      <div class="astat"><div class="kpi-label">Views · 30d</div><div class="kpi-value">${num(a.d30.views)}</div><div class="kpi-sub">${num(a.d30.visits)} visits</div></div>
    </div>
    <div class="agrid">
      ${miniTable('Top pages', a.pages)}
      ${miniTable('Top referrers', a.refs)}
      ${miniTable('Top countries', a.countries)}
      ${miniTable('Devices', a.devices)}
    </div>
    <div class="src">live from Cloudflare · sample-adjusted estimates · <a href="${CF_WA_LINK}" target="_blank" style="color:var(--blue)">open in Cloudflare →</a></div>
  </div>`;
}

const confPill = (c) => `<span class="pill ${c === 'high' ? 'pub' : c === 'low' ? 'draft' : ''}" style="${c === 'medium' ? 'background:rgba(95,182,232,.16);color:var(--blue)' : ''}">${esc(c)}</span>`;
const queueCard = `<div class="card full"><h2>🎯 Build queue <span class="muted" style="font-weight:400;font-size:.8rem">· ${queued.length} ready · ${onHold.length} on hold · next build picks the top "ready" item</span></h2>
  ${nextUp ? `<div class="nextup"><span class="nextup-lbl">Next up</span> <b>${esc(nextUp.title)}</b> <span class="muted">${esc(Array.isArray(nextUp.platforms) ? nextUp.platforms.join(' / ') : '')}</span> ${confPill(nextUp.confidence)}</div>` : '<p class="muted">Queue is empty or all items are on hold — an idle night.</p>'}
  <table><thead><tr><th>#</th><th>Title</th><th>Signal</th><th>Conf.</th></tr></thead><tbody>
  ${queued.slice(0, 12).map((q) => `<tr><td class="mono">${esc(q.rank)}</td><td><b>${esc(q.title)}</b><div class="muted" style="font-size:.78rem">${esc(Array.isArray(q.platforms) ? q.platforms.join(' / ') : '')}</div></td><td class="muted" style="font-size:.82rem">${esc(q.signal || '')}</td><td>${confPill(q.confidence)}</td></tr>`).join('')}
  </tbody></table>
  ${onHold.length ? `<div class="src">On hold (data still settling): ${onHold.map((q) => esc(q.title)).join(' · ')}</div>` : ''}
  <div class="src">refreshed ${esc(queue._meta?.updated || '—')} · weekly scan replenishes · nightly job builds the top item</div>
</div>`;

const driftCard = `<div class="card full drift ${drift.cls}">
  <div class="drift-row">
    <span class="drift-status ${drift.cls}">${drift.status === 'IN SYNC' ? '✓ ' : '⚠ '}Deploy sync · ${esc(drift.status)}</span>
    <span class="muted" style="font-size:.82rem">${esc(drift.msg)}</span>
  </div>
  <div class="drift-grid">
    <div><span class="drift-lbl">Live production</span><span class="tag">${drift.live?.commit ? esc(drift.live.commit) : '—'}</span>${drift.live?.when ? `<span class="muted"> · ${esc(drift.live.when)}</span>` : ''}${drift.live && !drift.live.isGit ? ' <span class="muted">(direct upload)</span>' : ''}</div>
    <div><span class="drift-lbl">origin/main</span><span class="tag">${esc(drift.originHead || '—')}</span></div>
    <div><span class="drift-lbl">local HEAD</span><span class="tag">${esc(drift.localHead || '—')}</span>${drift.ahead ? ` <span class="pill draft">${drift.ahead} unpushed</span>` : ''}${drift.behind ? ` <span class="pill" style="background:rgba(95,182,232,.16);color:var(--blue)">${drift.behind} behind</span>` : ''}</div>
  </div>
</div>`;

const ownerCard = ownerBody && bodyLines(ownerBody).length && !/^nothing|^none\b/i.test(ownerBody.trim())
  ? `<div class="card alert"><h2>⚠ Needs the owner</h2><ul>${bodyLines(ownerBody).map((l) => `<li>${md(l)}</li>`).join('')}</ul><div class="src">from ${esc(latestReport)}</div></div>`
  : `<div class="card ok"><h2>✓ Needs the owner</h2><p>Nothing flagged in the latest report (${esc(latestReport || '—')}).</p></div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Primo Guides · LiveOps</title>
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
.drift{border-left:4px solid var(--muted2)}
.drift.drift-ok{border-left-color:var(--green)}
.drift.drift-bad{border-left-color:var(--red)}
.drift.drift-warn{border-left-color:var(--accent)}
.drift-row{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px}
.drift-status{font-weight:700;font-size:.95rem}
.drift-status.drift-ok{color:var(--green)}
.drift-status.drift-bad{color:var(--red)}
.drift-status.drift-warn{color:var(--accent)}
.drift-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;font-size:.86rem}
.drift-lbl{display:block;font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2);font-weight:700;margin-bottom:3px}
.nextup{background:var(--panel2);border:1px solid rgba(95,182,232,.3);border-radius:10px;padding:10px 14px;margin-bottom:14px}
.nextup-lbl{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-right:8px}
.astats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:6px 0 16px}
.astat{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.agrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.abox{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.abox-h{color:var(--blue);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:8px}
.abox table{font-size:.84rem}
.abox td{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);word-break:break-all}
.anum{text-align:right;font-family:var(--mono);color:var(--text);white-space:nowrap;padding-left:10px!important}
.abtn{display:inline-block;margin-top:6px;color:var(--blue);text-decoration:none;font-weight:600;font-size:.86rem}
.foot{color:var(--muted2);font-size:.78rem;text-align:center;margin-top:30px}
</style></head><body>
<header><div class="wrap">
  <div><h1>Primo <span>Guides</span> · LiveOps</h1><div class="gen">generated ${esc(generated)} · regenerate with <code>npm run dashboard</code></div></div>
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

  ${driftCard}

  ${analyticsCard(analytics)}

  <div class="grid" style="margin-top:18px">
    ${ownerCard}
    <div class="card">
      <h2>📰 Latest nightly · ${esc(latestReport || '—')}</h2>
      ${publishedBody ? `<ul>${bodyLines(publishedBody, 6).map((l) => `<li>${md(l)}</li>`).join('')}</ul>` : '<p class="muted">No report parsed.</p>'}
      ${spendBody ? `<div class="src">Spend: ${md(bodyLines(spendBody, 1)[0] || '—')}</div>` : ''}
    </div>
  </div>

  ${queueCard}

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

  <div class="foot">Read-only snapshot from repo data + live Cloudflare Web Analytics (optional, graceful fallback) · never writes, never deploys · regenerate with <code>npm run dashboard</code></div>
</div></body></html>`;

writeFileSync(OUT, html);
console.log(`✅  LiveOps dashboard written: ${OUT}`);
console.log(`    ${published.length} published guides · ${franchises.length} franchises · ${releases.length} releases · latest ${latestRelease ? latestRelease.tag : '—'}`);
console.log(`    Open it:  open "${OUT}"`);
