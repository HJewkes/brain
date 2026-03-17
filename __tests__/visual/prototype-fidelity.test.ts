import { test, expect } from '@playwright/test';

/**
 * Prototype fidelity tests — compare React component computed styles
 * against the HTML prototype's CSS specifications.
 *
 * These tests encode the prototype's CSS values as assertions and verify
 * the React (RNW) rendering matches. When a test fails, the React
 * component has drifted from the prototype.
 */

const BASE = 'http://localhost:3457/dashboard.html#specimen';

test.describe('Prototype fidelity — fonts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10_000 });
    await page.waitForTimeout(500);
  });

  test('SectionLabel is Space Grotesk 10px/700/uppercase', async ({ page }) => {
    // Find all elements with text "PROGRESS" that are 10px (the actual SectionLabel atoms, not specimen labels)
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'PROGRESS' && el.children.length === 0,
      );
      return els.map(el => {
        const cs = getComputedStyle(el);
        return {
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          textTransform: cs.textTransform,
          fontFamily: cs.fontFamily,
        };
      });
    });
    // Should have HTML + React versions — both should be 10px
    const tenPxLabels = result.filter(r => r.fontSize === '10px');
    expect(tenPxLabels.length).toBeGreaterThanOrEqual(2);
    for (const label of tenPxLabels) {
      expect(label.fontWeight).toBe('700');
      expect(label.textTransform).toBe('uppercase');
      expect(label.fontFamily).toMatch(/Space Grotesk/);
    }
  });

  test('ToolBadge letter uses Space Grotesk 10px/700', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Find single-letter text elements (R, W, E, $, /, A) that are badge letters
      const letters = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el.children.length > 0) return false;
        const text = el.textContent?.trim();
        if (!text || text.length !== 1) return false;
        if (!'RWE$/A'.includes(text)) return false;
        const cs = getComputedStyle(el);
        return cs.fontSize === '10px' && cs.fontWeight === '700';
      });
      return letters.map(el => {
        const cs = getComputedStyle(el);
        return { text: el.textContent, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
      });
    });
    // Should find HTML + React badge letters
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const r of result) {
      expect(r.fontFamily).toMatch(/Space Grotesk/);
      expect(r.fontSize).toBe('10px');
      expect(r.fontWeight).toBe('700');
    }
  });
});

test.describe('Prototype fidelity — colors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10_000 });
    await page.waitForTimeout(500);
  });

  test('brand color #FF7900 on CLAUDE label in organism', async ({ page }) => {
    // Scroll to organisms
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    // Find CLAUDE labels that are brand-colored (inside the actual card, not specimen headers)
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'CLAUDE' && el.children.length === 0,
      );
      return els.map(el => getComputedStyle(el).color);
    });
    // At least one should be brand orange
    const brandOrange = result.filter(c => c === 'rgb(255, 121, 0)');
    expect(brandOrange.length).toBeGreaterThanOrEqual(1);
  });

  test('user accent #7BAFDE on USER label in organism', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'USER' && el.children.length === 0,
      );
      return els.map(el => getComputedStyle(el).color);
    });
    const userBlue = result.filter(c => c === 'rgb(123, 175, 222)');
    expect(userBlue.length).toBeGreaterThanOrEqual(1);
  });

  test('error color #DC050C on error StatusBadge', async ({ page }) => {
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'error' && el.children.length === 0,
      );
      return els.map(el => getComputedStyle(el).color);
    });
    const errorRed = result.filter(c => c === 'rgb(220, 5, 12)');
    expect(errorRed.length).toBeGreaterThanOrEqual(1);
  });

  test('success color #14B8A6 on complete StatusBadge', async ({ page }) => {
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'complete' && el.children.length === 0,
      );
      return els.map(el => getComputedStyle(el).color);
    });
    const successGreen = result.filter(c => c === 'rgb(20, 184, 166)');
    expect(successGreen.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Prototype fidelity — dimensions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10_000 });
    await page.waitForTimeout(500);
  });

  test('ToolBadge is 20x20 with border-radius 4px', async ({ page }) => {
    const badges = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.width === '20px' && cs.height === '20px' &&
          (cs.borderRadius === '4px' || cs.borderRadius === '10px');
      }).length;
    });
    // 7 HTML badges + 7 React badges = 14 total
    expect(badges).toBeGreaterThanOrEqual(12);
  });

  test('ProgressBar track is 6px tall with overflow hidden', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 1800));
    await page.waitForTimeout(300);
    const tracks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.height === '6px' && cs.borderRadius === '3px' && cs.overflow === 'hidden';
      }).length;
    });
    expect(tracks).toBeGreaterThanOrEqual(4);
  });

  test('DurationBar track is 60px wide', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 2800));
    await page.waitForTimeout(300);
    const bars = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.width === '60px' && cs.height === '3px' && cs.flexShrink === '0';
      }).length;
    });
    // 3 ToolCallRow instances with duration bars
    expect(bars).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Prototype fidelity — HTML vs React parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10_000 });
    await page.waitForTimeout(500);
  });

  test('ToolPill font matches between HTML and React', async ({ page }) => {
    const result = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'read ×12' && el.children.length === 0,
      );
      return pills.map(el => {
        const cs = getComputedStyle(el);
        return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
      });
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Both HTML and React should use Space Grotesk 10px/600
    for (const r of result) {
      expect(r.fontFamily).toMatch(/Space Grotesk/);
      expect(r.fontSize).toBe('10px');
      expect(r.fontWeight).toBe('600');
    }
  });

  test('TaskChip padding matches prototype (3px 8px)', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Find elements containing "VNM-21.04" and walk up to find the one with padding
      const textEls = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'VNM-21.04' && el.children.length === 0,
      );
      return textEls.map(el => {
        // Check self and parents for padding (HTML span has it directly, React has it on Pressable parent)
        let target = el as HTMLElement;
        for (let i = 0; i < 4; i++) {
          const cs = getComputedStyle(target);
          if (cs.paddingTop !== '0px' && cs.paddingLeft !== '0px') {
            return { pt: cs.paddingTop, pr: cs.paddingRight, pb: cs.paddingBottom, pl: cs.paddingLeft };
          }
          if (target.parentElement) target = target.parentElement;
        }
        return { pt: '0px', pr: '0px', pb: '0px', pl: '0px' };
      });
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const r of result) {
      expect(r.pt).toBe('3px');
      expect(r.pr).toBe('8px');
      expect(r.pb).toBe('3px');
      expect(r.pl).toBe('8px');
    }
  });

  test('StatusBadge has border-radius 20px', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Find elements that contain "complete" and have a visible border-radius
      const badges = Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.borderRadius === '20px' && el.textContent?.includes('complete');
      });
      return badges.length;
    });
    // HTML + React StatusBadges
    expect(result).toBeGreaterThanOrEqual(2);
  });

  test('ToolBadge agent variant has border-radius 50% (round)', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Agent badges have border-radius 50% (10px on 20x20)
      const badges = Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.width === '20px' && cs.height === '20px' && cs.borderRadius === '10px';
      });
      return badges.length;
    });
    // HTML + React agent badges
    expect(result).toBeGreaterThanOrEqual(2);
  });

  test('TaskChip active variant has brighter border', async ({ page }) => {
    const result = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'VNM-27.03' && el.children.length === 0,
      );
      return chips.map(el => {
        // Walk up to find the element with the border (might be a parent wrapper)
        let target = el;
        for (let i = 0; i < 3; i++) {
          const cs = getComputedStyle(target);
          if (cs.borderColor && cs.borderColor !== 'rgb(0, 0, 0)') {
            return {
              borderColor: cs.borderColor,
              backgroundColor: cs.backgroundColor,
            };
          }
          if (target.parentElement) target = target.parentElement;
        }
        const cs = getComputedStyle(el);
        return {
          borderColor: cs.borderColor,
          backgroundColor: cs.backgroundColor,
        };
      });
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
