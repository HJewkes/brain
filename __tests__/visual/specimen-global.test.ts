import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for the global component specimen page.
 *
 * These tests screenshot sections of the global specimen page (#specimen-global)
 * and compare against stored baselines. Run with:
 *
 *   npx playwright test --config __tests__/visual/playwright.config.ts __tests__/visual/specimen-global.test.ts
 *
 * To update baselines after intentional changes:
 *
 *   npx playwright test --config __tests__/visual/playwright.config.ts __tests__/visual/specimen-global.test.ts --update-snapshots
 *
 * Setup: the webServer config serves from /tmp/brain-visual-test.
 * Before running, copy the built dashboard there:
 *
 *   npm run build && mkdir -p /tmp/brain-visual-test && cp dist/dashboard/index.html /tmp/brain-visual-test/dashboard.html
 */

const BASE = 'http://localhost:3457/dashboard.html#specimen-global';

/** Scroll to an element matching text and return a locator for its section */
async function scrollToSection(page: import('@playwright/test').Page, sectionTitle: string) {
  const heading = page.getByText(sectionTitle, { exact: false }).first();
  await heading.scrollIntoViewIfNeeded();
  // Small pause for any rendering to settle
  await page.waitForTimeout(300);
}

test.describe('Global specimen page loads', () => {
  test('page renders with correct title', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText('Global Component Specimen Sheet')).toBeVisible();
  });

  test('all 5 tiers present', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText('Shared Components (4)')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 3));
    await page.waitForTimeout(200);
    await expect(page.getByText('Kanban Components (3)')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
    await page.waitForTimeout(200);
    await expect(page.getByText('Agent Components (3)')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.7));
    await page.waitForTimeout(200);
    await expect(page.getByText('Session List Components (3)')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    await expect(page.getByText('Task Detail Components (5)')).toBeVisible();
    await expect(page.getByText('Chart Components (4)')).toBeVisible();
  });
});

test.describe('Shared component visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // Wait for fonts to load
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('S1. StatCard', async ({ page }) => {
    await scrollToSection(page, 'S1. StatCard');
    await expect(page).toHaveScreenshot('global-s1-stat-card.png', { fullPage: false });
  });

  test('S2. StageBadge', async ({ page }) => {
    await scrollToSection(page, 'S2. StageBadge');
    await expect(page).toHaveScreenshot('global-s2-stage-badge.png', { fullPage: false });
  });

  test('S3. TokenGauge', async ({ page }) => {
    await scrollToSection(page, 'S3. TokenGauge');
    await expect(page).toHaveScreenshot('global-s3-token-gauge.png', { fullPage: false });
  });

  test('S4. ActivitySparkline', async ({ page }) => {
    await scrollToSection(page, 'S4. ActivitySparkline');
    await expect(page).toHaveScreenshot('global-s4-activity-sparkline.png', { fullPage: false });
  });
});

test.describe('Kanban component visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('K1. Priority Stripe Pattern', async ({ page }) => {
    await scrollToSection(page, 'K1. Priority Stripe Pattern');
    await expect(page).toHaveScreenshot('global-k1-priority-stripe.png', { fullPage: false });
  });

  test('K2. KanbanCard Badges', async ({ page }) => {
    await scrollToSection(page, 'K2. KanbanCard Badges');
    await expect(page).toHaveScreenshot('global-k2-kanban-badges.png', { fullPage: false });
  });

  test('K3. Column Headers', async ({ page }) => {
    await scrollToSection(page, 'K3. Column Headers');
    await expect(page).toHaveScreenshot('global-k3-column-headers.png', { fullPage: false });
  });
});

test.describe('Agent component visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('A1. Agent Avatar', async ({ page }) => {
    await scrollToSection(page, 'A1. Agent Avatar');
    await expect(page).toHaveScreenshot('global-a1-agent-avatar.png', { fullPage: false });
  });

  test('A2. Agent Status Cards', async ({ page }) => {
    await scrollToSection(page, 'A2. Agent Status Cards');
    await expect(page).toHaveScreenshot('global-a2-agent-status-cards.png', { fullPage: false });
  });

  test('A3. Topology Node Layout', async ({ page }) => {
    await scrollToSection(page, 'A3. Topology Node Layout');
    await expect(page).toHaveScreenshot('global-a3-topology-node.png', { fullPage: false });
  });
});

test.describe('Session list component visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('SL1. Session Row', async ({ page }) => {
    await scrollToSection(page, 'SL1. Session Row');
    await expect(page).toHaveScreenshot('global-sl1-session-row.png', { fullPage: false });
  });

  test('SL2. Event Dots', async ({ page }) => {
    await scrollToSection(page, 'SL2. Event Dots');
    await expect(page).toHaveScreenshot('global-sl2-event-dots.png', { fullPage: false });
  });

  test('SL3. Status Filter Buttons', async ({ page }) => {
    await scrollToSection(page, 'SL3. Status Filter Buttons');
    await expect(page).toHaveScreenshot('global-sl3-filter-buttons.png', { fullPage: false });
  });
});

test.describe('Task detail component visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('TD1. Info Rows', async ({ page }) => {
    await scrollToSection(page, 'TD1. Info Rows');
    await expect(page).toHaveScreenshot('global-td1-info-rows.png', { fullPage: false });
  });

  test('TD2. Priority & Column Badges', async ({ page }) => {
    await scrollToSection(page, 'TD2. Priority & Column Badges');
    await expect(page).toHaveScreenshot('global-td2-priority-column-badges.png', {
      fullPage: false,
    });
  });

  test('TD3. Dependency Tree Nodes', async ({ page }) => {
    await scrollToSection(page, 'TD3. Dependency Tree Nodes');
    await expect(page).toHaveScreenshot('global-td3-dependency-tree.png', { fullPage: false });
  });

  test('TD4. Stage Timeline', async ({ page }) => {
    await scrollToSection(page, 'TD4. Stage Timeline');
    await expect(page).toHaveScreenshot('global-td4-stage-timeline.png', { fullPage: false });
  });

  test('TD5. Section Headers', async ({ page }) => {
    await scrollToSection(page, 'TD5. Section Headers');
    await expect(page).toHaveScreenshot('global-td5-section-headers.png', { fullPage: false });
  });
});

test.describe('Chart component visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('CH1. Burndown Chart', async ({ page }) => {
    await scrollToSection(page, 'CH1. Burndown Chart');
    await expect(page).toHaveScreenshot('global-ch1-burndown-chart.png', { fullPage: false });
  });

  test('CH2. Velocity Chart', async ({ page }) => {
    await scrollToSection(page, 'CH2. Velocity Chart');
    await expect(page).toHaveScreenshot('global-ch2-velocity-chart.png', { fullPage: false });
  });

  test('CH3. Horizontal Bar Chart', async ({ page }) => {
    await scrollToSection(page, 'CH3. Horizontal Bar Chart');
    await expect(page).toHaveScreenshot('global-ch3-bar-chart.png', { fullPage: false });
  });

  test('CH4. Sparkline Variants', async ({ page }) => {
    await scrollToSection(page, 'CH4. Sparkline Variants');
    await expect(page).toHaveScreenshot('global-ch4-sparkline-variants.png', { fullPage: false });
  });
});

test.describe('Global specimen — computed style checks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  });

  test('StatCard uses Inter for labels', async ({ page }) => {
    await scrollToSection(page, 'S1. StatCard');
    // StatCard labels use Inter (uppercase, letter-spacing style — not Space Grotesk)
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        (el) => el.textContent?.trim() === 'Throughput' && el.children.length === 0
      );
      return els.map((el) => getComputedStyle(el).fontFamily);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const fontFamily of result) {
      expect(fontFamily).toMatch(/Inter/);
    }
  });

  test('priority badge colors are correct', async ({ page }) => {
    await scrollToSection(page, 'K2. KanbanCard Badges');
    const result = await page.evaluate(() => {
      // Find badge text elements for priority levels
      const priorities = ['Critical', 'High', 'Medium', 'Low'];
      return priorities.map((p) => {
        const els = Array.from(document.querySelectorAll('*')).filter(
          (el) => el.textContent?.trim() === p && el.children.length === 0
        );
        const el = els[0];
        return el ? getComputedStyle(el).color : null;
      });
    });
    // critical: #FF3B30 → rgb(255, 59, 48)
    expect(result[0]).toBe('rgb(255, 59, 48)');
    // high: #D14343 (C.error) → rgb(209, 67, 67)
    expect(result[1]).toBe('rgb(209, 67, 67)');
    // medium: #FFB020 (C.warning) → rgb(255, 176, 32)
    expect(result[2]).toBe('rgb(255, 176, 32)');
    // low: #2196F3 (C.info) → rgb(33, 150, 243)
    expect(result[3]).toBe('rgb(33, 150, 243)');
  });

  test('column header accent colors match semantic-colors', async ({ page }) => {
    await scrollToSection(page, 'K3. Column Headers');
    const result = await page.evaluate(() => {
      // Find column header containers by looking for text elements that have
      // a 2px border-top ancestor (the header accent stripe). Use filter to
      // handle duplicates (e.g., "Done" appears as a variant label elsewhere).
      const colLabels = ['Blocked', 'Ready', 'In Progress', 'PR / Review', 'Done'];
      return colLabels.map((label) => {
        const textEls = Array.from(document.querySelectorAll('*')).filter(
          (el) => el.textContent?.trim() === label && el.children.length === 0
        );
        // Find the one that has a 2px border-top ancestor
        for (const textEl of textEls) {
          let target = textEl as HTMLElement;
          for (let i = 0; i < 8; i++) {
            const cs = getComputedStyle(target);
            if (cs.borderTopWidth === '2px') {
              return cs.borderTopColor;
            }
            if (!target.parentElement) break;
            target = target.parentElement;
          }
        }
        return null;
      });
    });
    // blocked → C.error (#D14343)
    expect(result[0]).toBe('rgb(209, 67, 67)');
    // ready → C.warning (#FFB020)
    expect(result[1]).toBe('rgb(255, 176, 32)');
    // inprogress → C.brand (#FF7900)
    expect(result[2]).toBe('rgb(255, 121, 0)');
    // review → C.info (#2196F3)
    expect(result[3]).toBe('rgb(33, 150, 243)');
    // done → C.success (#14B8A6)
    expect(result[4]).toBe('rgb(20, 184, 166)');
  });

  test('avatar sizes are correct (20, 26, 32, 40px)', async ({ page }) => {
    await scrollToSection(page, 'A1. Agent Avatar');
    const result = await page.evaluate(() => {
      // Find avatar containers by checking for circular colored divs at each expected size
      const sizes = [20, 26, 32, 40];
      return sizes.map((size) => {
        const matches = Array.from(document.querySelectorAll('*')).filter((el) => {
          const cs = getComputedStyle(el);
          return (
            cs.width === `${size}px` &&
            cs.height === `${size}px` &&
            (cs.borderRadius === `${size / 2}px` || cs.borderRadius === '10px') &&
            cs.alignItems === 'center'
          );
        });
        return matches.length > 0;
      });
    });
    // All four avatar sizes should be present
    for (const found of result) {
      expect(found).toBe(true);
    }
  });
});
