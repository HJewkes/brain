import { Command } from '@commander-js/extra-typings';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { loadConfig, resolveInstance, parentResolveOpts } from '../services/config.js';

const PLIST_LABEL = 'com.brain.index';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const SYSTEMD_DIR = join(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_SERVICE = 'brain-index.service';
const SYSTEMD_TIMER = 'brain-index.timer';

export function generateLaunchdPlist(
  brainBin: string,
  intervalMinutes: number,
  notesDir: string
): string {
  const intervalSeconds = intervalMinutes * 60;
  const logPath = join(notesDir, '.brain-hook.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${brainBin}</string>
    <string>index</string>
    <string>--inbox</string>
    <string>--extract</string>
    <string>--quiet</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;
}

export function generateSystemdService(brainBin: string): string {
  return `[Unit]
Description=Brain index and extract

[Service]
Type=oneshot
ExecStart=${brainBin} index --inbox --extract --quiet
`;
}

export function generateSystemdTimer(intervalMinutes: number): string {
  return `[Unit]
Description=Brain scheduled indexing

[Timer]
OnBootSec=10min
OnUnitActiveSec=${intervalMinutes}min
Persistent=true

[Install]
WantedBy=timers.target
`;
}

function findBrainBin(): string {
  try {
    return execSync('which brain', { encoding: 'utf-8' }).trim();
  } catch {
    return 'npx brain';
  }
}

function installLaunchd(intervalMinutes: number, notesDir: string): void {
  const brainBin = findBrainBin();
  const plist = generateLaunchdPlist(brainBin, intervalMinutes, notesDir);

  if (existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      /* may not be loaded */
    }
  }

  writeFileSync(PLIST_PATH, plist, 'utf-8');
  try {
    execSync(`launchctl load "${PLIST_PATH}"`);
  } catch {
    process.stderr.write(`Error: launchctl load failed. Check ${PLIST_PATH} manually.\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`Installed launchd agent: ${PLIST_PATH}\n`);
  process.stderr.write(`Brain will index every ${intervalMinutes} minutes.\n`);
}

function installSystemd(intervalMinutes: number): void {
  const brainBin = findBrainBin();
  const servicePath = join(SYSTEMD_DIR, SYSTEMD_SERVICE);
  const timerPath = join(SYSTEMD_DIR, SYSTEMD_TIMER);

  mkdirSync(SYSTEMD_DIR, { recursive: true });

  writeFileSync(servicePath, generateSystemdService(brainBin), 'utf-8');
  writeFileSync(timerPath, generateSystemdTimer(intervalMinutes), 'utf-8');

  try {
    execSync('systemctl --user daemon-reload');
    execSync(`systemctl --user enable --now ${SYSTEMD_TIMER}`);
  } catch {
    process.stderr.write(
      'Error: systemctl commands failed. Check systemd configuration manually.\n'
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`Installed systemd timer: ${timerPath}\n`);
  process.stderr.write(`Brain will index every ${intervalMinutes} minutes.\n`);
}

function uninstallLaunchd(): void {
  if (!existsSync(PLIST_PATH)) {
    process.stderr.write('No launchd agent installed.\n');
    return;
  }
  try {
    execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' });
  } catch {
    /* may not be loaded */
  }
  unlinkSync(PLIST_PATH);
  process.stderr.write('Uninstalled launchd agent.\n');
}

function uninstallSystemd(): void {
  const timerPath = join(SYSTEMD_DIR, SYSTEMD_TIMER);
  const servicePath = join(SYSTEMD_DIR, SYSTEMD_SERVICE);

  if (!existsSync(timerPath)) {
    process.stderr.write('No systemd timer installed.\n');
    return;
  }

  try {
    execSync(`systemctl --user disable --now ${SYSTEMD_TIMER}`, {
      stdio: 'ignore',
    });
  } catch {
    /* may not be active */
  }

  if (existsSync(timerPath)) unlinkSync(timerPath);
  if (existsSync(servicePath)) unlinkSync(servicePath);
  process.stderr.write('Uninstalled systemd timer.\n');
}

function getStatus(notesDir: string): {
  installed: boolean;
  platform: string;
  logSize: number | null;
} {
  const os = platform();
  if (os === 'darwin') {
    const logPath = join(notesDir, '.brain-hook.log');
    let logSize: number | null = null;
    try {
      logSize = statSync(logPath).size;
    } catch {
      /* no log yet */
    }
    return {
      installed: existsSync(PLIST_PATH),
      platform: 'macOS (launchd)',
      logSize,
    };
  }
  if (os === 'linux') {
    const timerPath = join(SYSTEMD_DIR, SYSTEMD_TIMER);
    return {
      installed: existsSync(timerPath),
      platform: 'Linux (systemd)',
      logSize: null,
    };
  }
  return { installed: false, platform: os, logSize: null };
}

export const installHooksCommand = new Command('install-hooks')
  .description('Set up scheduled processing (launchd/systemd)')
  .option('--interval <minutes>', 'processing interval in minutes', '360')
  .option('--uninstall', 'remove scheduled processing')
  .option('--status', 'show current hook status')
  .option('--json', 'output as JSON')
  .action((opts, cmd) => {
    const instance = resolveInstance(parentResolveOpts(cmd));
    const config = loadConfig(instance);
    const os = platform();

    if (opts.status || opts.json) {
      const status = getStatus(config.notesDir);
      if (opts.json) {
        process.stdout.write(JSON.stringify(status) + '\n');
      } else {
        process.stderr.write(
          `Scheduled processing: ${status.installed ? 'active' : 'not installed'}\n`
        );
        process.stderr.write(`  Platform: ${status.platform}\n`);
        if (status.logSize !== null) {
          const kb = (status.logSize / 1024).toFixed(1);
          process.stderr.write(`  Log: ${join(config.notesDir, '.brain-hook.log')} (${kb} KB)\n`);
        }
      }
      return;
    }

    if (opts.uninstall) {
      if (os === 'darwin') {
        uninstallLaunchd();
      } else if (os === 'linux') {
        uninstallSystemd();
      } else {
        process.stderr.write(`Unsupported platform: ${os}\n`);
        process.exitCode = 1;
      }
      return;
    }

    const interval = parseInt(opts.interval, 10);
    if (isNaN(interval) || interval < 1) {
      process.stderr.write('Error: interval must be a positive number of minutes\n');
      process.exitCode = 1;
      return;
    }

    if (os === 'darwin') {
      installLaunchd(interval, config.notesDir);
    } else if (os === 'linux') {
      installSystemd(interval);
    } else {
      process.stderr.write(
        `Unsupported platform: ${os}. Scheduled processing requires macOS or Linux.\n`
      );
      process.exitCode = 1;
    }
  });
