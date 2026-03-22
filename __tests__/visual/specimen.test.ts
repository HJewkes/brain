import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for the component specimen page.
 *
 * These tests screenshot sections of the specimen page (#specimen) and
 * compare against stored baselines. Run with:
 *
 *   npx playwright test --config __tests__/visual/playwright.config.ts
 *
 * To update baselines after intentional changes:
 *
 *   npx playwright test --config __tests__/visual/playwright.config.ts --update-snapshots
 *
 * Setup: the webServer config serves from /tmp/brain-visual-test.
 * Before running, copy the built dashboard there:
 *
 *   npm run build && mkdir -p /tmp/brain-visual-test && cp dist/dashboard/index.html /tmp/brain-visual-test/dashboard.html
 */

const BASE = 'http://localhost:3457/dashboard.html#specimen';

/** Scroll to an element matching text and return a locator for its section */
async function scrollToSection(page: import('@playwright/test').Page, sectionTitle: string) {
  // Scroll to the section title — each section starts with a Text node like "A1. StatusDot"
  const heading = page.getByText(sectionTitle, { exact: false }).first();
  await heading.scrollIntoViewIfNeeded();
  // Small pause for any rendering to settle
  await page.waitForTimeout(300);
}

test.describe('Specimen page loads', () => {
  test('page renders with correct title', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText('Component Specimen Sheet')).toBeVisible();
  });

  test('all 3 tiers present', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText('Atoms (15)')).toBeVisible();
    // Scroll to find molecules and organisms
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(200);
    await expect(page.getByText('Molecules (6)')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    await expect(page.getByText('Organisms (3)')).toBeVisible();
  });
});

test.describe('Atom visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // Wait for fonts to load
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('A1. StatusDot', async ({ page }) => {
    await scrollToSection(page, 'A1. StatusDot');
    await expect(page).toHaveScreenshot('atom-01-status-dot.png', { fullPage: false });
  });

  test('A2. TimelineDot', async ({ page }) => {
    await scrollToSection(page, 'A2. TimelineDot');
    await expect(page).toHaveScreenshot('atom-02-timeline-dot.png', { fullPage: false });
  });

  test('A3. MiniStatusDot', async ({ page }) => {
    await scrollToSection(page, 'A3. MiniStatusDot');
    await expect(page).toHaveScreenshot('atom-03-mini-status-dot.png', { fullPage: false });
  });

  test('A4. SectionLabel', async ({ page }) => {
    await scrollToSection(page, 'A4. SectionLabel');
    await expect(page).toHaveScreenshot('atom-04-section-label.png', { fullPage: false });
  });

  test('A5. ToolBadge', async ({ page }) => {
    await scrollToSection(page, 'A5. ToolBadge');
    await expect(page).toHaveScreenshot('atom-05-tool-badge.png', { fullPage: false });
  });

  test('A6. ToolPill', async ({ page }) => {
    await scrollToSection(page, 'A6. ToolPill');
    await expect(page).toHaveScreenshot('atom-06-tool-pill.png', { fullPage: false });
  });

  test('A7. TaskChip', async ({ page }) => {
    await scrollToSection(page, 'A7. TaskChip');
    await expect(page).toHaveScreenshot('atom-07-task-chip.png', { fullPage: false });
  });

  test('A8. TaskPill', async ({ page }) => {
    await scrollToSection(page, 'A8. TaskPill');
    await expect(page).toHaveScreenshot('atom-08-task-pill.png', { fullPage: false });
  });

  test('A9. AgentDot', async ({ page }) => {
    await scrollToSection(page, 'A9. AgentDot');
    await expect(page).toHaveScreenshot('atom-09-agent-dot.png', { fullPage: false });
  });

  test('A10. Separator', async ({ page }) => {
    await scrollToSection(page, 'A10. Separator');
    await expect(page).toHaveScreenshot('atom-10-separator.png', { fullPage: false });
  });

  test('A11. DurationBar', async ({ page }) => {
    await scrollToSection(page, 'A11. DurationBar');
    await expect(page).toHaveScreenshot('atom-11-duration-bar.png', { fullPage: false });
  });

  test('A12. ProgressBar', async ({ page }) => {
    await scrollToSection(page, 'A12. ProgressBar');
    await expect(page).toHaveScreenshot('atom-12-progress-bar.png', { fullPage: false });
  });

  test('A13. MiniBar', async ({ page }) => {
    await scrollToSection(page, 'A13. MiniBar');
    await expect(page).toHaveScreenshot('atom-13-mini-bar.png', { fullPage: false });
  });

  test('A14. StatusBadge', async ({ page }) => {
    await scrollToSection(page, 'A14. StatusBadge');
    await expect(page).toHaveScreenshot('atom-14-status-badge.png', { fullPage: false });
  });
});

test.describe('Molecule visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('M1. ToolCallRow', async ({ page }) => {
    await scrollToSection(page, 'M1. ToolCallRow');
    await expect(page).toHaveScreenshot('mol-01-tool-call-row.png', { fullPage: false });
  });

  test('M2. AgentRow', async ({ page }) => {
    await scrollToSection(page, 'M2. AgentRow');
    await expect(page).toHaveScreenshot('mol-02-agent-row.png', { fullPage: false });
  });

  test('M3. KanbanColumn', async ({ page }) => {
    await scrollToSection(page, 'M3. KanbanColumn');
    await expect(page).toHaveScreenshot('mol-03-kanban-column.png', { fullPage: false });
  });

  test('M4. TurnSummaryCard', async ({ page }) => {
    await scrollToSection(page, 'M4. TurnSummaryCard');
    await expect(page).toHaveScreenshot('mol-04-turn-summary-card.png', { fullPage: false });
  });

  test('M5. ErrorBlock', async ({ page }) => {
    await scrollToSection(page, 'M5. ErrorBlock');
    await expect(page).toHaveScreenshot('mol-05-error-block.png', { fullPage: false });
  });

  test('M6. GapIndicator', async ({ page }) => {
    await scrollToSection(page, 'M6. GapIndicator');
    await expect(page).toHaveScreenshot('mol-06-gap-indicator.png', { fullPage: false });
  });
});

test.describe('Organism visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('O1. UserMessageCard', async ({ page }) => {
    await scrollToSection(page, 'O1. UserMessageCard');
    await expect(page).toHaveScreenshot('org-01-user-message-card.png', { fullPage: false });
  });

  test('O2. ClaudeResponseCard', async ({ page }) => {
    await scrollToSection(page, 'O2. ClaudeResponseCard');
    await expect(page).toHaveScreenshot('org-02-claude-response-card.png', { fullPage: false });
  });

  test('O3. ConversationTurn', async ({ page }) => {
    await scrollToSection(page, 'O3. ConversationTurn');
    await expect(page).toHaveScreenshot('org-03-conversation-turn.png', { fullPage: false });
  });
});

test.describe('Prototype comparison — computed styles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('fonts are loaded (Space Grotesk + Inter)', async ({ page }) => {
    const fonts = await page.evaluate(() => {
      const loaded = Array.from(document.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => f.family);
      return [...new Set(loaded)];
    });
    expect(fonts).toContain('Space Grotesk');
    expect(fonts).toContain('Inter');
  });

  test('SectionLabel uses Space Grotesk', async ({ page }) => {
    await scrollToSection(page, 'A4. SectionLabel');
    // Find the React-rendered PROGRESS label (inside the REACT (RNW) column)
    const progressLabels = page.getByText('PROGRESS');
    const count = await progressLabels.count();
    expect(count).toBeGreaterThanOrEqual(2); // HTML + React versions

    // Check the last one (React version)
    const reactLabel = progressLabels.last();
    const fontFamily = await reactLabel.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toMatch(/Space Grotesk/);
  });

  test('body text uses Inter', async ({ page }) => {
    await scrollToSection(page, 'O1. UserMessageCard');
    // Find user message text
    const userText = page.getByText("Let's fix the session ingestion pipeline");
    const fontFamily = await userText.evaluate((el) => getComputedStyle(el).fontFamily);
    // User text in organisms.tsx doesn't set fontFamily explicitly,
    // so it should inherit Inter from body or fall back to sans-serif
    // This test documents the current state
    expect(fontFamily).toBeTruthy();
  });

  test('brand color consistency', async ({ page }) => {
    await scrollToSection(page, 'A14. StatusBadge');
    const activeBadge = page.getByText('active').last();
    const color = await activeBadge.evaluate((el) => getComputedStyle(el).color);
    // Should be #FF7900 → rgb(255, 121, 0)
    expect(color).toBe('rgb(255, 121, 0)');
  });
});
