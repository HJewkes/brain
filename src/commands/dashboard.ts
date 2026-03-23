import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { collectAuditReport, collectDashboardData } from './audit.js';
import type { AuditReport, DashboardData } from './audit.js';

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
    const thisDir = dirname(thisFile);

    // When running from dist/cli.js → dist/dashboard/index.html
    const distPath = join(thisDir, 'dashboard', 'index.html');
    if (existsSync(distPath)) return distPath;

    // When running from src/commands/dashboard.ts via tsx → dist/dashboard/index.html
    const rootDistPath = join(thisDir, '..', '..', 'dist', 'dashboard', 'index.html');
    if (existsSync(rootDistPath)) return rootDistPath;
  } catch {
    // fileURLToPath can fail in some edge cases
  }
  return null;
}

function injectData(
  html: string,
  audit: AuditReport,
  status: StatusCache,
  dashboard?: DashboardData,
  apiBase?: string
): string {
  const auditScript = `<script>window.__AUDIT__ = ${escapeScriptJson(JSON.stringify(audit))};</script>`;
  const statusScript = `<script>window.__STATUS__ = ${escapeScriptJson(JSON.stringify(status))};</script>`;
  const dashScript = dashboard
    ? `<script>window.__DASHBOARD__ = ${escapeScriptJson(JSON.stringify(dashboard))};</script>`
    : '';
  const apiScript = apiBase
    ? `<script>window.__BRAIN_API__ = ${escapeScriptJson(JSON.stringify(apiBase))};</script>`
    : '';
  const injection = `${apiScript}\n${auditScript}\n${statusScript}\n${dashScript}`;

  return html.replace('<div id="root"></div>', `${injection}\n<div id="root"></div>`);
}

export function generateDashboardHtml(
  audit: AuditReport,
  status: StatusCache,
  dashboard?: DashboardData,
  apiBase?: string
): string {
  const builtPath = resolveBuiltDashboard();
  if (!builtPath) {
    throw new Error("Dashboard not built. Run 'npm run build:dashboard' first.");
  }
  const template = readFileSync(builtPath, 'utf-8');
  return injectData(template, audit, status, dashboard, apiBase);
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

const LIVE_API_PORT = 7800;
const LIVE_API_BASE = `http://localhost:${LIVE_API_PORT}`;

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${LIVE_API_BASE}/api/status`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startServerBackground(): void {
  const args = process.argv.slice(1);
  // Find the cli entry point relative to this file
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  // In dist: dist/cli.js. In src (tsx): need to find the root cli
  const distCli = join(thisDir, '..', 'cli.js');
  const cliPath = existsSync(distCli) ? distCli : args[0];

  const child = spawn(process.execPath, [cliPath, 'serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function ensureServerRunning(): Promise<void> {
  if (await isServerRunning()) return;
  process.stderr.write('Starting brain serve in background…\n');
  startServerBackground();
  // Wait up to 3s for it to come up
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning()) return;
  }
  process.stderr.write('Warning: server did not start in time; live mode may not work\n');
}

export const dashboardCommand = new Command('dashboard')
  .description('Generate and open an HTML dashboard of brain system state')
  .option('--output <path>', 'Write HTML to a specific file instead of temp')
  .option('--no-open', 'Skip opening the browser')
  .option('--live', 'Connect to brain serve for real-time data (starts server if needed)')
  .action(async (opts, cmd) => {
    const live = (opts as { live?: boolean }).live ?? false;

    if (live) {
      await ensureServerRunning();
    }

    await withDb(({ db, config }) => {
      const audit = collectAuditReport(db, config);
      const status = readStatusCache();
      const dashboard = collectDashboardData(db, config);
      const apiBase = live ? LIVE_API_BASE : undefined;
      const html = generateDashboardHtml(audit, status, dashboard, apiBase);
      const filePath = writeDashboard(html, opts.output);

      const isAgent = !!(process.env.AGENT_NAME || process.env.BRAIN_AGENT_ID);
      const shouldOpen = isAgent ? false : opts.open;

      if (shouldOpen) {
        openInBrowser(filePath);
      }

      process.stderr.write(`Dashboard written to ${filePath}\n`);
    }, parentResolveOpts(cmd));
  });
