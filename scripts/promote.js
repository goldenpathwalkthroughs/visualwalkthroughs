#!/usr/bin/env node
/**
 * promote.js — deploy dist/ to Cloudflare Pages production
 *
 * Called by the pipeline after QA passes on a preview deploy.
 * Deploys the current dist/ to the production branch, then tags
 * the git commit so rollback always has a target.
 *
 * Usage:
 *   node scripts/promote.js
 *   node scripts/promote.js --tag v2026-06-06-wind-waker-hd
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN   (Pages:Edit permission)
 *   CLOUDFLARE_ACCOUNT_ID
 *
 * Exit 0 = production deploy succeeded
 * Exit 1 = failure (production untouched if deploy did not start)
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }
const tagArg = arg('--tag');

// ── Guards ────────────────────────────────────────────────────────────────────
if (!existsSync(join(ROOT, 'dist'))) {
  console.error('❌  No dist/ directory found. Run npm run build first.');
  process.exit(1);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !accountId) {
  console.error('❌  CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.');
  process.exit(1);
}

// ── Deploy to production ──────────────────────────────────────────────────────
console.log('\n── Promoting to production ──────────────────────────');

try {
  // No --branch flag = Cloudflare Pages deploys to the production branch
  execSync('npx wrangler pages deploy dist --project-name=visualwalkthroughs', {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env },
  });
} catch {
  console.error('\n❌  Wrangler deploy failed. Production is untouched — last good deploy still live.');
  process.exit(1);
}

console.log('\n  ✅  Production deploy complete');

// ── Tag the release ───────────────────────────────────────────────────────────
const date = new Date().toISOString().slice(0, 10);
const tag = tagArg || `release-${date}`;

try {
  execSync(`git tag -f ${tag}`, { cwd: ROOT, stdio: 'pipe' });
  execSync(`git push origin ${tag} --force`, { cwd: ROOT, stdio: 'pipe' });
  console.log(`  ✅  Tagged release: ${tag}`);
} catch (e) {
  // Tag failure is non-fatal — production is already live
  console.log(`  ⚠   Could not tag release (${e.message}) — rollback target may be missing`);
}

console.log('\n══════════════════════════════════════════');
console.log(`✅  Promoted — production is live`);
console.log(`    Tag: ${tag}`);
console.log('══════════════════════════════════════════\n');
