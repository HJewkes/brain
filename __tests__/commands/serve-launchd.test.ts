import { describe, it, expect } from 'vitest';
import {
  buildWatchPlist,
  buildAutoloopPlist,
  watchPlistPath,
  autoloopPlistPath,
} from '../../src/commands/serve-launchd.js';

describe('serve-launchd plist builders', () => {
  describe('buildWatchPlist', () => {
    it('includes WatchPaths pointing to notesDir', () => {
      const plist = buildWatchPlist('/home/user/brain');
      expect(plist).toContain('<key>WatchPaths</key>');
      expect(plist).toContain('<string>/home/user/brain</string>');
    });

    it('uses the index-watch label', () => {
      const plist = buildWatchPlist('/notes');
      expect(plist).toContain('com.brain.index-watch');
    });

    it('runs the index command with flags', () => {
      const plist = buildWatchPlist('/notes');
      expect(plist).toContain('<string>index</string>');
      expect(plist).toContain('<string>--inbox</string>');
      expect(plist).toContain('<string>--extract</string>');
      expect(plist).toContain('<string>--quiet</string>');
    });

    it('includes a throttle interval', () => {
      const plist = buildWatchPlist('/notes');
      expect(plist).toContain('<key>ThrottleInterval</key>');
      expect(plist).toContain('<integer>30</integer>');
    });

    it('includes log paths', () => {
      const plist = buildWatchPlist('/notes');
      expect(plist).toContain('brain-index-watch.log');
      expect(plist).toContain('brain-index-watch.err');
    });
  });

  describe('buildAutoloopPlist', () => {
    it('uses default schedule of 3am', () => {
      const plist = buildAutoloopPlist();
      expect(plist).toContain('<key>StartCalendarInterval</key>');
      expect(plist).toContain('<key>Hour</key>');
      expect(plist).toContain('<integer>3</integer>');
      expect(plist).toContain('<key>Minute</key>');
      expect(plist).toContain('<integer>0</integer>');
    });

    it('accepts custom schedule', () => {
      const plist = buildAutoloopPlist({ hour: 14, minute: 30 });
      expect(plist).toContain('<integer>14</integer>');
      expect(plist).toContain('<integer>30</integer>');
    });

    it('uses the autoloop label', () => {
      const plist = buildAutoloopPlist();
      expect(plist).toContain('com.brain.autoloop');
    });

    it('runs the autoloop consolidate command', () => {
      const plist = buildAutoloopPlist();
      expect(plist).toContain('<string>autoloop</string>');
      expect(plist).toContain('<string>consolidate</string>');
    });

    it('includes log paths', () => {
      const plist = buildAutoloopPlist();
      expect(plist).toContain('brain-autoloop.log');
      expect(plist).toContain('brain-autoloop.err');
    });
  });

  describe('plist paths', () => {
    it('watchPlistPath contains the label', () => {
      expect(watchPlistPath()).toContain('com.brain.index-watch.plist');
    });

    it('autoloopPlistPath contains the label', () => {
      expect(autoloopPlistPath()).toContain('com.brain.autoloop.plist');
    });

    it('paths are in LaunchAgents directory', () => {
      expect(watchPlistPath()).toContain('LaunchAgents');
      expect(autoloopPlistPath()).toContain('LaunchAgents');
    });
  });
});
