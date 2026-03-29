import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const LABEL = 'com.brain.serve';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function buildPlist(port: number): string {
  const node = process.execPath;
  const cli = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'dist', 'cli.js');

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

export function installLaunchd(port: number): void {
  const dest = plistPath();
  const dir = dirname(dest);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(dest, buildPlist(port), 'utf-8');
  execSync(`launchctl load -w ${dest}`, { stdio: 'inherit' });
  process.stderr.write(`Installed: ${dest}\nService loaded (port ${port})\n`);
}

export function uninstallLaunchd(): void {
  const dest = plistPath();
  if (!existsSync(dest)) {
    process.stderr.write(`Not installed: ${dest}\n`);
    return;
  }
  try {
    execSync(`launchctl unload ${dest}`, { stdio: 'inherit' });
  } catch {
    // may already be unloaded
  }
  unlinkSync(dest);
  process.stderr.write(`Uninstalled: ${dest}\n`);
}
