import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/snapshots/{testFilePath}/{arg}{ext}',
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    browserName: 'chromium',
    viewport: { width: 1200, height: 900 },
    colorScheme: 'dark',
  },
  webServer: {
    command: 'python3 -m http.server 3457 --directory /tmp/brain-visual-test',
    port: 3457,
    reuseExistingServer: true,
  },
});
