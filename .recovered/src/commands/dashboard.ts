import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { collectAuditReport } from './audit.js';
import type { AuditReport } from './audit.js';

export interface StatusCache {
  agents?: Array<{
    name?: string;
    task?: string;
    branch?: string;
    status?: string;
  }>;
  sessions?: {
    eventCount?: number;
    frictionCount?: number;
    prsCreated?: number;
  };
  [key: string]: unknown;
}

function readStatusCache(): StatusCache {
  const cachePath = join(homedir(), '.claude', 'status-cache', 'brain-state.json');
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8')) as StatusCache;
  } catch {
    return {};
  }
}

function escapeScriptJson(json: string): string {
  return json.replace(/<\//g, '<\\/');
}

function resolveBuiltDashboard(): string | null {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const distPath = join(dirname(thisFile), 'dashboard', 'index.html');
    if (existsSync(distPath)) return distPath;
  } catch {
    // fileURLToPath can fail in some edge cases
  }
  return null;
}

function injectData(
  html: string,
  audit: AuditReport,
  status: StatusCache,
): string {
  const auditScript = `<script>window.__AUDIT__ = ${escapeScriptJson(JSON.stringify(audit))};</script>`;
  const statusScript = `<script>window.__STATUS__ = ${escapeScriptJson(JSON.stringify(status))};</script>`;
  const injection = `${auditScript}\n${statusScript}`;

  return html.replace(
    '<div id="root"></div>',
    `${injection}\n<div id="root"></div>`,
  );
}

export function generateDashboardHtml(
  audit: AuditReport,
  status: StatusCache,
): string {
  const builtPath = resolveBuiltDashboard();
  if (builtPath) {
    const template = readFileSync(builtPath, 'utf-8');
    return injectData(template, audit, status);
  }
  return generateFallbackHtml(audit, status);
}

function writeDashboard(html: string, outputPath?: string): string {
  if (outputPath) {
    writeFileSync(outputPath, html, 'utf-8');
    return outputPath;
  }
  const dir = join(tmpdir(), 'brain-dashboard');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `dashboard-${randomUUID().slice(0, 8)}.html`);
  writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

function openInBrowser(filePath: string): void {
  execFileSync('open', [filePath]);
}

export const dashboardCommand = new Command('dashboard')
  .description('Generate and open an HTML dashboard of brain system state')
  .option('--output <path>', 'Write HTML to a specific file instead of temp')
  .option('--no-open', 'Skip opening the browser')
  .action(async (opts, cmd) => {
    await withDb(({ db, config }) => {
      const audit = collectAuditReport(db, config);
      const status = readStatusCache();
      const html = generateDashboardHtml(audit, status);
      const filePath = writeDashboard(html, opts.output);

      if (opts.open) {
        openInBrowser(filePath);
      }

      process.stderr.write(`Dashboard written to ${filePath}\n`);
    }, parentResolveOpts(cmd));
  });

// ---------------------------------------------------------------------------
// Fallback: inline HTML template (used when React build is not available)
// ---------------------------------------------------------------------------

function generateFallbackHtml(audit: AuditReport, status: StatusCache): string {
  const auditJson = JSON.stringify(audit);
  const statusJson = JSON.stringify(status);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Brain Dashboard</title>
<style>${cssVars()}${cssBase()}</style>
</head>
<body>
<script>window.__AUDIT__ = ${escapeScriptJson(auditJson)};</script>
<script>window.__STATUS__ = ${escapeScriptJson(statusJson)};</script>

<div class="dashboard">
  <div class="header">
    <h1>Brain Dashboard</h1>
    <div class="meta">
      <span id="hdr-timestamp"></span> &middot;
      <span id="hdr-dbpath"></span> &middot;
      schema <span id="hdr-schema"></span>
    </div>
  </div>

  <div class="metrics-row">
    <div class="card">
      <div class="metric-label">Total Notes</div>
      <div class="metric-value" id="metric-notes">-</div>
      <div class="metric-detail" id="detail-notes"></div>
    </div>
    <div class="card">
      <div class="metric-label">Memories</div>
      <div class="metric-value" id="metric-memories">-</div>
      <div class="metric-detail" id="detail-memories"></div>
    </div>
    <div class="card">
      <div class="metric-label">Sessions</div>
      <div class="metric-value" id="metric-sessions">-</div>
      <div class="metric-detail" id="detail-sessions"></div>
    </div>
    <div class="card">
      <div class="metric-label">Agents</div>
      <div class="metric-value" id="metric-agents">-</div>
      <div class="metric-detail" id="detail-agents"></div>
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="section-title">Notes by Module</div>
      <div id="notes-by-module"></div>
    </div>
    <div class="card">
      <div class="section-title">Notes by Type</div>
      <div id="notes-by-type"></div>
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="section-title">Task Burndown</div>
      <div id="task-burndown"></div>
      <div id="task-status-table"></div>
    </div>
    <div class="card">
      <div class="section-title">Agent Status</div>
      <div id="agents-list"></div>
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="section-title">Session Activity</div>
      <div id="session-activity"></div>
    </div>
    <div class="card">
      <div class="section-title">Search Health</div>
      <div id="search-health"></div>
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="section-title">Storage</div>
      <div id="storage-info"></div>
    </div>
    <div class="card">
      <div class="section-title">Relations</div>
      <div id="relations-summary"></div>
    </div>
  </div>
</div>

${renderScript()}
</body>
</html>`;
}

function cssVars(): string {
  return `
:root {
  --color-brand-primary: #FF7900;
  --color-brand-primary-light: #FF9630;
  --color-brand-primary-dark: #D0620C;
  --color-brand-primary-subtle: rgba(255, 121, 0, 0.12);
  --color-brand-secondary: #406D87;
  --color-brand-secondary-light: #678498;
  --color-brand-secondary-subtle: rgba(64, 109, 135, 0.12);
  --color-brand-primary-rgb: 255, 121, 0;
  --color-brand-secondary-rgb: 64, 109, 135;

  --color-status-success: #14B8A6;
  --color-status-success-light: #43C6B7;
  --color-status-success-subtle: rgba(20, 184, 166, 0.12);
  --color-status-error: #D14343;
  --color-status-error-light: #DA6868;
  --color-status-error-subtle: rgba(209, 67, 67, 0.12);
  --color-status-warning: #FFB020;
  --color-status-warning-light: #FFBF4C;
  --color-status-warning-subtle: rgba(255, 176, 32, 0.12);
  --color-status-info: #2196F3;
  --color-status-info-light: #64B6F7;
  --color-status-info-subtle: rgba(33, 150, 243, 0.12);

  --color-on-brand-primary: #FFFFFF;
  --color-on-status-success: #FFFFFF;
  --color-on-status-error: #FFFFFF;
  --color-on-status-warning: #FFFFFF;

  --color-data-1: #1965B0;
  --color-data-2: #4EB265;
  --color-data-3: #F7F056;
  --color-data-4: #DC050C;
  --color-data-5: #882E72;
  --color-data-6: #F4A736;
  --color-data-7: #7BAFDE;
  --color-data-8: #90C987;
  --color-data-9: #CAACCB;
  --color-data-10: #EE8026;

  --color-text-primary: #F3F4F6;
  --color-text-secondary: #9CA3AF;
  --color-text-tertiary: #6B7280;
  --color-text-disabled: rgba(255, 255, 255, 0.38);
  --color-text-link: #828DF8;

  --color-surface-base: #161616;
  --color-surface-elevated: #191919;
  --color-surface-raised: #1C1C1C;
  --color-surface-overlay: #191919;

  --color-background-base: #101010;
  --color-background-default: #161616;
  --color-background-subtle: #1C1C1C;

  --color-border-default: #1F1F1F;
  --color-border-subtle: #1C1C1C;
  --color-border-strong: #2C2C2C;

  --color-interactive-hover: rgba(255, 255, 255, 0.04);
  --color-interactive-selected: rgba(255, 255, 255, 0.08);
  --color-divider: #1F1F1F;

  --font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-family-body: 'Nunito Sans', -apple-system, sans-serif;
  --font-family-heading: 'Space Grotesk', -apple-system, sans-serif;
  --font-family-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;

  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
}`;
}

function cssBase(): string {
  return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Nunito+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font-family-sans);
  background: var(--color-background-base);
  color: var(--color-text-primary);
  padding: 24px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  position: relative;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(ellipse 140% 100% at 15% 5%, rgba(var(--color-brand-primary-rgb), 0.06) 0%, transparent 45%),
    radial-gradient(ellipse 120% 80% at 85% 95%, rgba(var(--color-brand-secondary-rgb), 0.04) 0%, transparent 45%);
}
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
  position: relative;
  z-index: 1;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 16px 20px;
  background: var(--color-surface-elevated);
  border-radius: 8px;
  border: 1px solid var(--color-border-strong);
}
.header h1 {
  font-family: var(--font-family-heading);
  font-size: 1.5rem;
  color: var(--color-brand-primary);
  font-weight: 700;
}
.header .meta {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}
.metrics-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.card {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  padding: 16px 20px;
}
.metric-label {
  font-family: var(--font-family-body);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}
.metric-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.metric-detail {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
}
.section-title {
  font-family: var(--font-family-heading);
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-brand-secondary-light);
  margin-bottom: 12px;
  letter-spacing: 0.01em;
}
.bar {
  display: flex;
  height: 24px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-surface-elevated);
}
.bar > div { min-width: 2px; transition: width 0.3s; }
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: middle;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 0.85rem;
}
th {
  text-align: left;
  color: var(--color-text-tertiary);
  font-weight: 500;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border-default);
}
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.progress-track {
  height: 20px;
  background: var(--color-surface-elevated);
  border-radius: 6px;
  overflow: hidden;
  position: relative;
}
.progress-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.3s;
}
.progress-label {
  position: absolute;
  top: 0;
  left: 8px;
  line-height: 20px;
  font-size: 0.75rem;
  color: var(--color-text-primary);
  font-weight: 600;
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-active { background: var(--color-status-success-subtle); color: var(--color-status-success); }
.badge-completed { background: var(--color-status-info-subtle); color: var(--color-status-info); }
.badge-pending { background: var(--color-status-warning-subtle); color: var(--color-status-warning); }
.badge-error { background: var(--color-status-error-subtle); color: var(--color-status-error); }
.health-ok { color: var(--color-status-success); }
.health-warn { color: var(--color-status-warning); }
.health-err { color: var(--color-status-error); }
@media (max-width: 800px) {
  .metrics-row { grid-template-columns: repeat(2, 1fr); }
  .two-col { grid-template-columns: 1fr; }
}`;
}

function renderScript(): string {
  return `
<script>
const A = window.__AUDIT__;
const S = window.__STATUS__;
const COLORS = [
  '#1965B0','#4EB265','#F7F056','#DC050C','#882E72',
  '#F4A736','#7BAFDE','#90C987','#CAACCB','#EE8026'
];

function $(id) { return document.getElementById(id); }
function fmtN(n) { return (n ?? 0).toLocaleString('en-US'); }

function renderBar(containerId, data) {
  const el = $(containerId);
  if (!el) return;
  const entries = Object.entries(data).sort((a,b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (total === 0) { el.innerHTML = '<div class="bar"></div>'; return; }

  let barHtml = '<div class="bar">';
  entries.forEach(([key, val], i) => {
    const pct = ((val / total) * 100).toFixed(1);
    const color = COLORS[i % COLORS.length];
    barHtml += '<div style="width:' + pct + '%;background:' + color + ';" title="' + key + ': ' + val + '"></div>';
  });
  barHtml += '</div><div class="legend">';
  entries.forEach(([key, val], i) => {
    const color = COLORS[i % COLORS.length];
    barHtml += '<span><span class="legend-dot" style="background:' + color + '"></span>' + key + ': ' + fmtN(val) + '</span>';
  });
  barHtml += '</div>';
  el.innerHTML = barHtml;
}

function renderTable(containerId, data) {
  const el = $(containerId);
  if (!el) return;
  const entries = Object.entries(data).sort((a,b) => b[1] - a[1]);
  if (entries.length === 0) { el.innerHTML = '<p style="color:var(--color-text-tertiary)">None</p>'; return; }
  let html = '<table><tr><th>Type</th><th>Count</th></tr>';
  entries.forEach(([k, v]) => { html += '<tr><td>' + k + '</td><td>' + fmtN(v) + '</td></tr>'; });
  html += '</table>';
  el.innerHTML = html;
}

function badgeClass(status) {
  if (!status) return 'badge-pending';
  const s = status.toLowerCase();
  if (s === 'active' || s === 'running') return 'badge-active';
  if (s === 'completed' || s === 'done') return 'badge-completed';
  if (s === 'error' || s === 'failed') return 'badge-error';
  return 'badge-pending';
}

function renderAgents() {
  const el = $('agents-list');
  if (!el) return;
  const agents = S.agents || [];
  if (agents.length === 0) {
    el.innerHTML = '<p style="color:var(--color-text-tertiary)">No agent data in status cache</p>';
    return;
  }
  let html = '';
  agents.forEach(a => {
    html += '<div class="card" style="margin-bottom:8px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<strong>' + (a.name || 'unnamed') + '</strong>';
    html += '<span class="badge ' + badgeClass(a.status) + '">' + (a.status || 'unknown') + '</span>';
    html += '</div>';
    if (a.task) html += '<div class="metric-detail">Task: ' + a.task + '</div>';
    if (a.branch) html += '<div class="metric-detail">Branch: ' + a.branch + '</div>';
    html += '</div>';
  });
  el.innerHTML = html;
}

function renderTaskBurndown() {
  const el = $('task-burndown');
  if (!el) return;
  const tasks = A.pm || {};
  const total = tasks.tasks || 0;
  const byStatus = tasks.tasksByStatus || {};
  const done = (byStatus.done || 0) + (byStatus.completed || 0) + (byStatus.verified || 0);
  const pct = total > 0 ? ((done / total) * 100).toFixed(0) : 0;

  let html = '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%;background:var(--color-brand-primary);"></div>';
  html += '<span class="progress-label">' + done + ' / ' + total + ' (' + pct + '%)</span></div>';
  html += '<div style="margin-top:8px;">';
  renderTable('task-status-table', byStatus);
  html += '</div>';
  el.innerHTML = html;
}

function renderSessionActivity() {
  const el = $('session-activity');
  if (!el) return;
  const sess = S.sessions || {};
  const auditSess = A.sessions || {};
  let html = '<table>';
  html += '<tr><td>Total sessions</td><td>' + fmtN(auditSess.total) + '</td></tr>';
  html += '<tr><td>Events tracked</td><td>' + fmtN(sess.eventCount ?? auditSess.events) + '</td></tr>';
  html += '<tr><td>Friction events</td><td>' + fmtN(sess.frictionCount ?? 0) + '</td></tr>';
  html += '<tr><td>PRs created</td><td>' + fmtN(sess.prsCreated ?? 0) + '</td></tr>';
  html += '</table>';
  el.innerHTML = html;
}

function healthIcon(count, label) {
  if (count > 0) return '<span class="health-ok">&#10003;</span> ' + label + ': ' + fmtN(count);
  return '<span class="health-err">&#10007;</span> ' + label + ': 0';
}

function renderSearchHealth() {
  const el = $('search-health');
  if (!el) return;
  const s = A.search || {};
  let html = '<table>';
  html += '<tr><td>' + healthIcon(s.ftsEntries, 'FTS entries') + '</td></tr>';
  html += '<tr><td>' + healthIcon(s.trigramEntries, 'Trigram entries') + '</td></tr>';
  html += '<tr><td>' + healthIcon(s.vectorRows, 'Vector rows') + '</td></tr>';
  html += '</table>';
  el.innerHTML = html;
}

function renderStorage() {
  const el = $('storage-info');
  if (!el) return;
  const db = A.database || {};
  const ch = A.chunks || {};
  const inbox = A.inbox || {};
  let html = '<table>';
  html += '<tr><td>DB size</td><td>' + formatBytes(db.sizeBytes || 0) + '</td></tr>';
  html += '<tr><td>Chunks</td><td>' + fmtN(ch.total) + ' (' + fmtN(ch.embedded) + ' embedded)</td></tr>';
  html += '<tr><td>Inbox</td><td>' + fmtN(inbox.pending) + ' pending / ' + fmtN(inbox.total) + ' total</td></tr>';
  html += '<tr><td>Feeds</td><td>' + fmtN(inbox.feeds) + '</td></tr>';
  html += '</table>';
  el.innerHTML = html;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

function renderRelations() {
  const el = $('relations-summary');
  if (!el) return;
  renderTable('relations-summary', A.relations?.byType || {});
}

function init() {
  $('hdr-timestamp').textContent = new Date(A.timestamp).toLocaleString();
  $('hdr-dbpath').textContent = A.database?.path || '?';
  $('hdr-schema').textContent = 'v' + (A.database?.schemaVersion || '?');

  $('metric-notes').textContent = fmtN(A.notes?.total);
  $('detail-notes').textContent = Object.entries(A.notes?.byTier || {}).map(([k,v]) => k + ': ' + v).join(' | ');

  const memActive = A.memories?.active ?? 0;
  const memTotal = A.memories?.total ?? 0;
  $('metric-memories').textContent = fmtN(memActive);
  $('detail-memories').textContent = memActive + ' active / ' + memTotal + ' total';

  $('metric-sessions').textContent = fmtN(A.sessions?.total);
  $('detail-sessions').textContent = fmtN(A.sessions?.events) + ' events';

  const agTotal = A.agents?.total ?? 0;
  const agActive = A.agents?.active ?? 0;
  $('metric-agents').textContent = fmtN(agActive);
  $('detail-agents').textContent = agActive + ' active / ' + agTotal + ' total';

  renderBar('notes-by-module', A.notes?.byModule || {});
  renderTable('notes-by-type', A.notes?.byType || {});
  renderTaskBurndown();
  renderAgents();
  renderSessionActivity();
  renderSearchHealth();
  renderStorage();
  renderRelations();
}

document.addEventListener('DOMContentLoaded', init);
</script>`;
}
