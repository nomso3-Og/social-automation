#!/usr/bin/env node
// Regenerates index.html from the repo's actual state on every cron run, so
// the GitHub Pages site is a live view of the pipeline rather than a drawing
// of it. Everything on the page is read from disk at build time: queue
// depths, what's awaiting approval, what has already gone out.
//
// Runs last in the workflow, after every other step has updated state, and
// the page is committed alongside that state.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
  } catch {
    return fallback;
  }
}

async function listJson(dir) {
  try {
    return (await readdir(path.join(ROOT, dir))).filter(f => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function ago(ts) {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---- measure how often this actually runs ----------------------------------
//
// The cron asks for every 15 minutes. GitHub throttles scheduled workflows on
// free-tier repos and in practice delivers far fewer, so the configured value
// is not a fact about the system. Recording each build and reporting the
// measured median means the page states what actually happens rather than what
// was requested, and it self-corrects if GitHub's behaviour changes.
// Only CI runs are recorded. Rebuilding locally to preview the page would
// otherwise inject a gap that never happened and drag the median around.
const HISTORY_CAP = 60;
const isCI = process.env.GITHUB_ACTIONS === 'true';
const history = await readJson('state/run-history.json', { runs: [] });
const runs = isCI
  ? [...history.runs, new Date().toISOString()].slice(-HISTORY_CAP)
  : history.runs;
if (isCI) {
  await writeFile(
    path.join(ROOT, 'state/run-history.json'),
    JSON.stringify({ runs }, null, 2) + '\n'
  );
}

function medianGapMinutes(isoList) {
  if (isoList.length < 3) return null;
  const t = isoList.map(s => new Date(s).getTime()).sort((a, b) => a - b);
  const gaps = t.slice(1).map((v, i) => (v - t[i]) / 60000).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

const medGap = medianGapMinutes(runs);
const cadenceLabel = !medGap
  ? 'measuring'
  : medGap < 90
    ? `~${Math.round(medGap)} min apart`
    : `~${(medGap / 60).toFixed(1)}h apart`;

// ---- gather real state -----------------------------------------------------

const topicFiles = (await listJson('topics')).filter(f => f !== 'README.md');
const used = new Set((await readJson('state/topics-used.json', { used: [] })).used);
const briefsLeft = topicFiles.filter(f => !used.has(f));

const pendingFiles = await listJson('pending-posts');
const pending = [];
for (const f of pendingFiles) {
  const d = await readJson(`pending-posts/${f}`);
  if (d) pending.push({ file: f, ...d });
}

const postedFiles = await listJson('pending-posts/posted');
const posted = [];
for (const f of postedFiles) {
  const d = await readJson(`pending-posts/posted/${f}`);
  if (d) posted.push({ file: f, ...d });
}
posted.sort((a, b) => new Date(b.postedAt ?? 0) - new Date(a.postedAt ?? 0));

const contentGen = await readJson('state/content-gen.json', {});
const topicsConfig = await readJson('config/content-topics.json', {});
const labWatch = await readJson('config/lab-watch.json', { repos: [] });
const actions = await readJson('config/actions.config.json', {});

let homelabCount = 0;
try {
  homelabCount = (await readdir(path.join(ROOT, 'homelabs'))).filter(
    f => f.toLowerCase().endsWith('.md') && f !== 'README.md'
  ).length;
} catch {}

const cadenceH = topicsConfig.cadenceHours ?? 48;
const nextDue = contentGen.lastGeneratedAt
  ? new Date(contentGen.lastGeneratedAt + cadenceH * 3600e3)
  : null;
const dueLabel = !nextDue
  ? 'on next run'
  : nextDue <= new Date()
    ? 'due now'
    : `in ${Math.max(1, Math.round((nextDue - Date.now()) / 3600e3))}h`;

// How long the queue lasts at the current cadence. The raw count doesn't say
// much on its own: four briefs is a week and a bit at 48h, and over a month at
// 240h. check-brief-stock.mjs opens an issue on the same number.
const runwayDays = (briefsLeft.length * cadenceH) / 24;
const briefRunway = briefsLeft.length
  ? ` &middot; ~${runwayDays < 10 ? runwayDays.toFixed(1) : Math.round(runwayDays)}d left`
  : '';

const connected = Object.entries(actions)
  .filter(([k]) => !k.startsWith('_'))
  .map(([k, v]) => ({ name: k, live: v.post && v.post !== 'REPLACE_ME' }));

// ---- render ----------------------------------------------------------------

const stage = (num, name, script, desc, state, gated) => `
  <div class="node${gated ? ' gated' : ''}">
    <div class="node-h">
      <span class="node-n">${num}</span>
      <span class="node-t">${esc(name)}</span>
      ${gated ? '<span class="pill gate">needs you</span>' : '<span class="pill auto">automatic</span>'}
    </div>
    <div class="node-s">${esc(script)}</div>
    <div class="node-d">${esc(desc)}</div>
    <div class="node-state">${state}</div>
  </div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Posting pipeline — live status</title>
<style>
  :root {
    --bg:#0E1217; --panel:#161C24; --panel2:#1B222C; --border:#26313C;
    --text:#E8EBEF; --muted:#8B96A3; --dim:#5E6874;
    --auto:#4CAF7D; --gate:#F0A93A; --info:#5B8DEF; --off:#E5484D;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:-apple-system,"Segoe UI",ui-sans-serif,Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.55;padding:0 0 72px}
  a{color:var(--info)}
  .wrap{max-width:1000px;margin:0 auto;padding:0 20px}
  .bar{border-bottom:1px solid var(--border);padding:16px 0;margin-bottom:30px}
  .bar-r{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-family:var(--mono);font-size:11.5px;color:var(--muted);letter-spacing:.03em}
  .chip{border:1px solid var(--border);border-radius:4px;padding:3px 9px;text-transform:uppercase;white-space:nowrap}
  .chip.on{color:var(--auto);border-color:var(--auto)}
  .chip.off{color:var(--dim)}
  h1{font-size:25px;font-weight:650;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14.5px;margin-top:8px;max-width:62ch}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:26px}
  .stat{background:var(--panel);padding:14px 12px}
  .stat-n{font-family:var(--mono);font-weight:650;font-size:21px;font-variant-numeric:tabular-nums}
  .stat-l{font-size:11px;color:var(--muted);margin-top:3px}
  @media(max-width:600px){.stats{grid-template-columns:repeat(2,1fr)}}
  h2{font-size:16px;font-weight:650;margin:44px 0 4px}
  .h2n{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-top:44px}
  .h2n + h2{margin-top:2px}
  .note{color:var(--muted);font-size:13.5px;margin-bottom:16px;max-width:64ch}
  .flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
  .node{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--auto);border-radius:9px;padding:14px 15px}
  .node.gated{border-left-color:var(--gate)}
  .node-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .node-n{font-family:var(--mono);font-size:10.5px;color:var(--dim)}
  .node-t{font-weight:640;font-size:14px}
  .pill{font-family:var(--mono);font-size:9.5px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:20px;margin-left:auto;white-space:nowrap}
  .pill.auto{background:rgba(76,175,125,.12);color:var(--auto)}
  .pill.gate{background:rgba(240,169,58,.12);color:var(--gate)}
  .node-s{font-family:var(--mono);font-size:10.5px;color:var(--dim);margin-top:4px}
  .node-d{font-size:12.5px;color:var(--muted);margin-top:7px;line-height:1.45}
  .node-state{font-family:var(--mono);font-size:11.5px;margin-top:10px;padding-top:9px;border-top:1px solid var(--border);color:var(--text)}
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:6px 18px}
  .row{padding:12px 0;border-bottom:1px solid var(--border);font-size:13.5px}
  .row:last-child{border-bottom:none}
  .row-t{font-weight:600}
  .row-m{color:var(--muted);font-size:12px;font-family:var(--mono);margin-top:3px}
  .empty{color:var(--dim);font-size:13.5px;padding:14px 0;font-style:italic}
  .foot{margin-top:52px;padding-top:18px;border-top:1px solid var(--border);font-size:12px;color:var(--dim);font-family:var(--mono)}
</style>
</head>
<body>
<div class="wrap">

  <div class="bar"><div class="bar-r">
    <span class="chip">nomso3-og/social-automation</span>
    <span class="chip">runs ${esc(cadenceLabel)}</span>
    ${connected.map(c => `<span class="chip ${c.live ? 'on' : 'off'}">${c.live ? '●' : '○'} ${esc(c.name)}</span>`).join('\n    ')}
  </div></div>

  <h1>How my LinkedIn posts get made</h1>
  <p class="sub">A GitHub Actions job wakes up on a schedule, gathers material,
  writes a draft, and then stops and asks me. Nothing reaches LinkedIn until I
  reply <code>approve</code>. This page is regenerated by that same job, so the
  numbers below are the live state of the queue.</p>
  <p class="sub" style="margin-top:10px">The job asks to run every 15 minutes.
  GitHub throttles scheduled jobs on free repos, so measured across the last
  ${runs.length} runs it actually lands <strong>${esc(cadenceLabel)}</strong>.
  That figure is measured, not configured.</p>

  <div class="stats">
    <div class="stat"><div class="stat-n">${briefsLeft.length}</div><div class="stat-l">research briefs queued${briefRunway}</div></div>
    <div class="stat"><div class="stat-n">${pending.length}</div><div class="stat-l">awaiting my approval</div></div>
    <div class="stat"><div class="stat-n">${posted.length}</div><div class="stat-l">published</div></div>
    <div class="stat"><div class="stat-n">${esc(dueLabel)}</div><div class="stat-l">next draft</div></div>
  </div>

  <div class="h2n">Stage 1</div>
  <h2>Where material comes from</h2>
  <p class="note">Three independent sources. Each produces a draft; none of them can publish.</p>
  <div class="flow">
    ${stage('01', 'Research briefs', 'research-content.mjs',
      'Takes the next researched brief and writes a post from its key points. Sources are attached to the draft.',
      `<strong>${briefsLeft.length}</strong> queued &middot; next ${esc(dueLabel)}`, false)}
    ${stage('02', 'Project write-ups', 'homelab-watcher.mjs',
      'I drop a Markdown write-up of something I built into homelabs/. It becomes a portfolio post.',
      `<strong>${homelabCount}</strong> write-up${homelabCount === 1 ? '' : 's'} ingested`, false)}
    ${stage('03', 'Repo commits', 'lab-watcher.mjs',
      'Watches repos for commits worth posting about. Declines routine work rather than inventing an angle for it.',
      labWatch.repos?.length
        ? `watching <strong>${labWatch.repos.length}</strong> repo(s)`
        : 'idle &middot; no repos watched', false)}
  </div>

  <div class="h2n">Stage 2</div>
  <h2>The part where it asks me</h2>
  <p class="note">Every draft stops here. I get an email, reply with one word, and that decides it.</p>
  <div class="flow">
    ${stage('04', 'Ask for approval', 'request-approval.mjs',
      'Opens a GitHub issue with the draft and assigns it to me, which is what triggers the notification.',
      pending.length ? `<strong>${pending.length}</strong> waiting on me` : 'nothing waiting', true)}
    ${stage('05', 'Read my reply', 'check-approvals.mjs',
      'Reads my emailed reply. Only comments from my own account count, so nobody else can approve a post.',
      'checks on every run', true)}
  </div>

  <div class="h2n">Stage 3</div>
  <h2>Publishing</h2>
  <div class="flow">
    ${stage('06', 'Publish', 'send-content.mjs',
      'Posts approved drafts to LinkedIn, then files them away with a timestamp so there is a record.',
      `<strong>${posted.length}</strong> published to date`, false)}
    ${stage('07', 'Save state', 'git commit',
      'Commits the updated queue back to the repo so the next run picks up where this one left off.',
      'every run', false)}
  </div>

  <div class="h2n">Right now</div>
  <h2>Waiting on me</h2>
  <div class="panel">
    ${
      pending.length
        ? pending
            .map(
              p => `<div class="row"><div class="row-t">${esc(p.topic ?? p.source ?? p.file)}</div>
        <div class="row-m">${esc(p.platform ?? 'linkedin')}${p.issueNumber ? ` &middot; issue #${p.issueNumber}` : ''}${p.sources?.length ? ` &middot; ${p.sources.length} source(s)` : ''}${p.styleFlags?.length ? ` &middot; ${p.styleFlags.length} style flag(s)` : ''}</div></div>`
            )
            .join('\n    ')
        : '<div class="empty">Nothing queued. Next draft ' + esc(dueLabel) + '.</div>'
    }
  </div>

  <h2 style="margin-top:34px">Recently published</h2>
  <div class="panel">
    ${
      posted.length
        ? posted
            .slice(0, 8)
            .map(
              p => `<div class="row"><div class="row-t">${esc(p.topic ?? p.source ?? p.file)}</div>
        <div class="row-m">${esc(ago(p.postedAt))}${p.briefFile ? ` &middot; from ${esc(p.briefFile)}` : ''}</div></div>`
            )
            .join('\n    ')
        : '<div class="empty">Nothing published yet.</div>'
    }
  </div>

  <div class="foot">
    Regenerated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC by the same job that runs the pipeline.
  </div>

</div>
</body>
</html>
`;

await writeFile(path.join(ROOT, 'index.html'), html);
console.log(
  `Dashboard rebuilt: ${briefsLeft.length} briefs queued, ${pending.length} awaiting approval, ${posted.length} published`
);
