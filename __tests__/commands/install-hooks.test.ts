import { describe, it, expect } from 'vitest';
import { generateLaunchdPlist, generateSystemdService, generateSystemdTimer } from '../../src/commands/install-hooks.js';

describe('install-hooks generators', () => {
  describe('generateLaunchdPlist', () => {
    it('generates valid plist with correct interval', () => {
      const plist = generateLaunchdPlist('/usr/local/bin/brain', 360, '/home/user/brain');
      expect(plist).toContain('<key>StartInterval</key>');
      expect(plist).toContain('<integer>21600</integer>'); // 360 * 60
      expect(plist).toContain('com.brain.index');
      expect(plist).toContain('/usr/local/bin/brain');
    });

    it('includes log path', () => {
      const plist = generateLaunchdPlist('/usr/local/bin/brain', 360, '/home/user/brain');
      expect(plist).toContain('.brain-hook.log');
    });

    it('includes program arguments for index command', () => {
      const plist = generateLaunchdPlist('/usr/local/bin/brain', 60, '/notes');
      expect(plist).toContain('<string>index</string>');
      expect(plist).toContain('<string>--inbox</string>');
      expect(plist).toContain('<string>--extract</string>');
      expect(plist).toContain('<string>--quiet</string>');
    });

    it('uses correct interval for different values', () => {
      const plist = generateLaunchdPlist('/usr/local/bin/brain', 60, '/notes');
      expect(plist).toContain('<integer>3600</integer>'); // 60 * 60
    });

    it('sets RunAtLoad to true', () => {
      const plist = generateLaunchdPlist('/usr/local/bin/brain', 360, '/notes');
      expect(plist).toContain('<key>RunAtLoad</key>');
      expect(plist).toContain('<true/>');
    });
  });

  describe('generateSystemdService', () => {
    it('generates valid service unit', () => {
      const service = generateSystemdService('/usr/local/bin/brain');
      expect(service).toContain('[Service]');
      expect(service).toContain('ExecStart=');
      expect(service).toContain('/usr/local/bin/brain');
    });

    it('runs as oneshot type', () => {
      const service = generateSystemdService('/usr/local/bin/brain');
      expect(service).toContain('Type=oneshot');
    });

    it('includes index command with flags', () => {
      const service = generateSystemdService('/usr/local/bin/brain');
      expect(service).toContain('index --inbox --extract --quiet');
    });
  });

  describe('generateSystemdTimer', () => {
    it('generates timer with correct interval', () => {
      const timer = generateSystemdTimer(360);
      expect(timer).toContain('[Timer]');
      expect(timer).toContain('OnUnitActiveSec=360min');
    });

    it('includes boot delay', () => {
      const timer = generateSystemdTimer(360);
      expect(timer).toContain('OnBootSec=10min');
    });

    it('is persistent', () => {
      const timer = generateSystemdTimer(360);
      expect(timer).toContain('Persistent=true');
    });

    it('targets timers', () => {
      const timer = generateSystemdTimer(360);
      expect(timer).toContain('[Install]');
      expect(timer).toContain('WantedBy=timers.target');
    });
  });
});
