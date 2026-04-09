import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const LABEL = 'com.brain.serve';
const LABEL_WATCH = 'com.brain.index-watch';
const LABEL_AUTOLOOP = 'com.brain.autoloop';

function launchAgentsDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents');
}

function plistPath(): string {
  return join(launchAgentsDir(), `${LABEL}.plist`);
}

export function watchPlistPath(): string {
  return join(launchAgentsDir(), `${LABEL_WATCH}.plist`);
}

export function autoloopPlistPath(): string {
  return join(launchAgentsDir(), `${LABEL_AUTOLOOP}.plist`);
}

function resolveCliPath(): string {
  return join(dirname(new URL(import.meta.url).pathname), '..', '..', 'dist', 'cli.js');
}

function buildServePlist(port: number): string {
  const node = process.execPath;
  const cli = resolveCliPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>serve</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'brain-serve.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'brain-serve.err')}</string>
</dict>
</plist>`;
}

export function buildWatchPlist(notesDir: string): string {
  const node = process.execPath;
  const cli = resolveCliPath();
  const logDir = join(homedir(), 'Library', 'Logs');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_WATCH}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>index</string>
    <string>--inbox</string>
    <string>--extract</string>
    <string>--quiet</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>${notesDir}</string>
  </array>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'brain-index-watch.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'brain-index-watch.err')}</string>
</dict>
</plist>`;
}

export interface AutoloopSchedule {
  hour: number;
  minute: number;
}

export function buildAutoloopPlist(schedule: AutoloopSchedule = { hour: 3, minute: 0 }): string {
  const node = process.execPath;
  const cli = resolveCliPath();
  const logDir = join(homedir(), 'Library', 'Logs');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_AUTOLOOP}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>autoloop</string>
    <string>consolidate</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${schedule.hour}</integer>
    <key>Minute</key>
    <integer>${schedule.minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'brain-autoloop.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'brain-autoloop.err')}</string>
</dict>
</plist>`;
}

function loadPlist(dest: string): void {
  try {
    execSync(`launchctl load -w "${dest}"`, { stdio: 'inherit' });
  } catch {
    process.stderr.write(`Warning: launchctl load failed for ${dest}\n`);
  }
}

function unloadPlist(dest: string): void {
  try {
    execSync(`launchctl unload "${dest}"`, { stdio: 'ignore' });
  } catch {
    // may already be unloaded
  }
}

function installPlist(dest: string, content: string): void {
  const dir = dirname(dest);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(dest)) unloadPlist(dest);
  writeFileSync(dest, content, 'utf-8');
  loadPlist(dest);
}

function removePlist(dest: string, label: string): boolean {
  if (!existsSync(dest)) return false;
  unloadPlist(dest);
  unlinkSync(dest);
  process.stderr.write(`Uninstalled: ${label}\n`);
  return true;
}

export function installLaunchd(port: number): void {
  const dest = plistPath();
  installPlist(dest, buildServePlist(port));
  process.stderr.write(`Installed: ${dest}\nService loaded (port ${port})\n`);
}

export function uninstallLaunchd(): void {
  const dest = plistPath();
  if (!removePlist(dest, LABEL)) {
    process.stderr.write(`Not installed: ${dest}\n`);
  }
}

export function installSystemPlists(notesDir: string, schedule?: AutoloopSchedule): void {
  const watchDest = watchPlistPath();
  installPlist(watchDest, buildWatchPlist(notesDir));
  process.stderr.write(`Installed WatchPaths plist: ${watchDest}\n`);

  const autoloopDest = autoloopPlistPath();
  installPlist(autoloopDest, buildAutoloopPlist(schedule));
  process.stderr.write(`Installed autoloop plist: ${autoloopDest}\n`);
}

export function uninstallSystemPlists(): void {
  let removed = false;
  if (removePlist(watchPlistPath(), LABEL_WATCH)) removed = true;
  if (removePlist(autoloopPlistPath(), LABEL_AUTOLOOP)) removed = true;
  if (!removed) {
    process.stderr.write('No system plists installed.\n');
  }
}
