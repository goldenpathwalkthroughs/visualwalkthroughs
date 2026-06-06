#!/usr/bin/env node
/**
 * rollback.js — revert production to the previous good Cloudflare Pages deployment
 *
 * Uses the Cloudflare Pages API to find the last successful production deploy
 * before the current one and retries it, making it live immediately.
 * No rebuild required — Cloudflare serves the old immutable bundle.
 *
 * Usage:
 *   node scripts/rollback.js
 *   node scripts/rollback.js --deployment-id abc123   (force a specific deployment)
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN   (Pages:Edit permission)
 *   CLOUDFLARE_ACCOUNT_ID
 *
 * Exit 0 = rollback succeeded
 * Exit 1 = failure
 */

const PROJECT = 'visualwalkthroughs';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }
const forcedDeploymentId = arg('--deployment-id');

// ── Env ───────────────────────────────────────────────────────────────────────
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.error('❌  CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.');
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${PROJECT}`;
const HEADERS = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function cfFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...options });
  const body = await res.json();
  if (!body.success) {
    const msg = body.errors?.[0]?.message || JSON.stringify(body.errors);
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return body.result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log(' VisualWalkthroughs — Rollback');
console.log('══════════════════════════════════════════\n');

// 1. List recent deployments
console.log('── Fetching deployment history ──────────────────────');
const deployments = await cfFetch('/deployments?per_page=10');

if (!deployments || deployments.length === 0) {
  console.error('❌  No deployments found for this project.');
  process.exit(1);
}

// 2. Find the deployment to roll back to
let targetId;
let targetNote;

if (forcedDeploymentId) {
  targetId = forcedDeploymentId;
  targetNote = `(forced: ${targetId})`;
} else {
  // Sort by created_on descending; skip the first (current) successful production deploy
  const prodDeploys = deployments
    .filter(d => d.environment === 'production' && d.latest_stage?.status === 'success')
    .sort((a, b) => new Date(b.created_on) - new Date(a.created_on));

  if (prodDeploys.length < 2) {
    console.error('❌  Not enough successful production deployments to roll back.');
    console.error('    Found:', prodDeploys.length, '(need at least 2)');
    process.exit(1);
  }

  const current = prodDeploys[0];
  const previous = prodDeploys[1];
  targetId = previous.id;
  targetNote = `Previous deploy from ${previous.created_on.slice(0, 16)} (${previous.id.slice(0, 8)}…)`;

  console.log(`  Current:  ${current.id.slice(0, 8)}… (${current.created_on.slice(0, 16)})`);
  console.log(`  Rolling back to: ${previous.id.slice(0, 8)}… (${previous.created_on.slice(0, 16)})`);
}

// 3. Retry (re-promote) the target deployment
console.log(`\n── Promoting previous deployment ────────────────────`);
console.log(`  Target: ${targetNote}`);

await cfFetch(`/deployments/${targetId}/retry`, { method: 'POST' });

console.log('\n  ✅  Rollback deployment triggered');
console.log('  ℹ   Allow ~30 seconds for Cloudflare to propagate the change.');

// 4. Brief smoke check — poll until the new deployment is live or timeout
console.log('\n── Waiting for propagation ──────────────────────────');
const siteUrl = 'https://visualwalkthroughs.pages.dev/';
const deadline = Date.now() + 60_000; // 60s
let ok = false;

while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res = await fetch(siteUrl, { method: 'HEAD' });
    if (res.ok) { ok = true; break; }
  } catch { /* retry */ }
  process.stdout.write('.');
}

if (ok) {
  console.log(`\n  ✅  ${siteUrl} responding — rollback live`);
} else {
  console.log(`\n  ⚠   ${siteUrl} still not responding after 60s — check Cloudflare dashboard`);
}

console.log('\n══════════════════════════════════════════');
console.log(ok ? '✅  Rollback complete' : '⚠   Rollback triggered — verify manually');
console.log('══════════════════════════════════════════\n');

if (!ok) process.exit(1);
