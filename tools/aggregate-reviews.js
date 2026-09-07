/* STARLIT PIP — Reviews aggregator (runs in GitHub Actions, NOT in browsers).
   ---------------------------------------------------------------------------
   Published reviews live in git (`data/reviews.json`) and are served as a
   static file by GitHub Pages. Browsers have ZERO write access to them.

   New submissions land as individual entries in a KEYLESS MantleDB inbox
   namespace (a "mailbox slot": anyone may drop a letter in, nobody needs a
   key). This script — running on a schedule with the auto-provided
   GITHUB_TOKEN, which never appears in any file — drains the inbox,
   strictly validates each submission, appends the valid ones to the
   published file, and deletes the processed inbox entries.

   SECURITY PROPERTIES:
     - No secret exists anywhere in this pipeline: not in the repo, not in
       the browser, not in Actions secrets. There is nothing to leak.
     - A malicious visitor can at worst pollute the PENDING queue (spam /
       delete pending items). They can NEVER modify or delete a PUBLISHED
       review: that requires a git push, which only this workflow (and repo
       collaborators) can perform.
     - Every published review passes structural validation here, independent
       of any client-side checks.
     - Rendering stays XSS-safe: text is emitted as JSON strings and the
       frontend inserts it via textContent only.

   Usage (workflow): node tools/aggregate-reviews.js
   Env overrides (for testing): INBOX_BASE, INBOX_NAMESPACE, DATA_FILE. */
'use strict';
const fs = require('fs');
const path = require('path');

const INBOX_BASE = (process.env.INBOX_BASE || 'https://mantledb.sh/v2').replace(/\/$/, '');
const INBOX_NS = process.env.INBOX_NAMESPACE || 'starlit-pip-inbox';
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'reviews.json');
const MAX_PER_RUN = 60;    // inbox entries processed per run (spam flood only delays, never kills)
const MAX_PUBLISHED = 200; // cap on published reviews (keeps the static file small)
const MAX_NAME = 40, MAX_TEXT = 600;

function inboxUrl(p) { return INBOX_BASE + '/' + encodeURIComponent(INBOX_NS) + '/' + p; }

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  return { status: res.status, data };
}

function sanitizeOne(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !/^r_[A-Za-z0-9_.-]{1,64}$/.test(r.id)) return null;
  const name = String(r.name == null ? '' : r.name).trim().slice(0, MAX_NAME);
  const text = String(r.text == null ? '' : r.text).trim().slice(0, MAX_TEXT);
  const rating = Number(r.rating);
  const createdAt = Number(r.createdAt);
  if (!name || !text) return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > Date.now() + 86400000) return null;
  return { id: r.id, name, rating, text, createdAt: Math.floor(createdAt) };
}

function loadPublished() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const doc = JSON.parse(raw);
    const arr = Array.isArray(doc && doc.reviews) ? doc.reviews : [];
    return arr.map(sanitizeOne).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) { return []; }
}

(async () => {
  // 1. Inbox listing (keyless by design).
  const lr = await fetch(INBOX_BASE + '/list/' + encodeURIComponent(INBOX_NS), { headers: { Accept: 'application/json' } });
  if (lr.status === 401 || lr.status === 403) {
    console.error('INBOX-CLAIMED: the inbox namespace now requires a key (it was claimed by someone else). ' +
      'Submissions are blocked. Runbook: pick a new INBOX_NAMESPACE, update js/reviews-config.js and this workflow, redeploy.');
    process.exit(2);
  }
  if (!lr.ok) { console.error('INBOX-LIST-FAILED: HTTP ' + lr.status); process.exit(1); }
  const ldoc = await lr.json().catch(() => ({}));
  const paths = ((ldoc && ldoc.entries) || []).map(e => e && e.path).filter(p => typeof p === 'string' && p.startsWith('inbox/')).slice(0, MAX_PER_RUN);
  console.log('INBOX-PENDING: ' + paths.length);

  const published = loadPublished();
  const known = new Set(published.map(r => r.id));
  const fresh = [];
  let dupes = 0, invalid = 0, processed = [];

  for (const p of paths) {
    try {
      const r = await getJson(inboxUrl(p));
      if (r.status !== 200) { continue; } // vanished mid-run; next run retries
      const clean = sanitizeOne(r.data);
      if (!clean) { invalid++; processed.push(p); continue; }
      if (known.has(clean.id)) { dupes++; processed.push(p); continue; }
      known.add(clean.id);
      fresh.push(clean);
      processed.push(p);
    } catch (e) { console.error('ENTRY-ERROR ' + p + ': ' + String(e).slice(0, 120)); }
  }

  let changed = false;
  if (fresh.length) {
    const next = published.concat(fresh).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PUBLISHED);
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ reviews: next }, null, 2) + '\n');
    changed = true;
  }
  console.log('PUBLISHED-NEW: ' + fresh.length + ' DUPES: ' + dupes + ' INVALID: ' + invalid + ' CHANGED-FILE: ' + changed);

  // 2. Drain processed inbox entries (keyless DELETE on an unclaimed namespace).
  let drained = 0, drainFail = 0;
  for (const p of processed) {
    try {
      const d = await fetch(inboxUrl(p), { method: 'DELETE' });
      if (d.ok) drained++; else drainFail++;
    } catch (e) { drainFail++; }
  }
  console.log('DRAINED: ' + drained + ' DRAIN-FAILED: ' + drainFail);
  console.log(changed ? 'AGGREGATE-CHANGED' : 'AGGREGATE-NOCHANGE');
})().catch(e => { console.error('AGGREGATE-FATAL: ' + String(e).slice(0, 300)); process.exit(1); });
