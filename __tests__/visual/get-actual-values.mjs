import { chromium } from '@playwright/test';

(async () => {
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'dark' });
const page = await context.newPage();

await page.goto('http://localhost:3457/dashboard.html#specimen');
await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10000 });
await page.waitForTimeout(1000);

const atomCount = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('*'))
    .filter(el => /^Atoms \(\d+\)$/.test(el.textContent?.trim() ?? '') && el.children.length <= 3)
    .map(el => el.textContent?.trim());
});
console.log('Atom section headers:', atomCount);

const statusBadgeResult = await page.evaluate(() => {
  const badges = Array.from(document.querySelectorAll('*')).filter(el => {
    const cs = getComputedStyle(el);
    return cs.borderRadius === '20px' && el.textContent?.includes('complete');
  });
  return badges.length;
});
console.log('StatusBadge border-radius=20px count:', statusBadgeResult);

const completeRadius = await page.evaluate(() => {
  const completeEls = Array.from(document.querySelectorAll('*')).filter(el => 
    el.textContent?.trim()?.toLowerCase() === 'complete' && el.children.length === 0
  );
  return completeEls.slice(0, 8).map(el => {
    let t = el;
    for (let i = 0; i < 8; i++) {
      const cs = getComputedStyle(t);
      if (cs.borderRadius && cs.borderRadius !== '0px') {
        return { depth: i, borderRadius: cs.borderRadius, tag: t.tagName };
      }
      if (!t.parentElement) break;
      t = t.parentElement;
    }
    return { depth: -1, borderRadius: getComputedStyle(el).borderRadius };
  });
});
console.log('Complete elements border-radius:', JSON.stringify(completeRadius));

await page.goto('http://localhost:3457/dashboard.html#specimen-global');
await page.waitForFunction(() => document.fonts.ready.then(() => true), null, { timeout: 10000 });
await page.waitForTimeout(1000);

const priorityColors = await page.evaluate(() => {
  const priorities = ['Critical', 'High', 'Medium', 'Low'];
  return priorities.map(p => {
    const els = Array.from(document.querySelectorAll('*')).filter(
      el => el.textContent?.trim() === p && el.children.length === 0
    );
    const el = els[0];
    return { priority: p, color: el ? getComputedStyle(el).color : null };
  });
});
console.log('Priority badge colors:', JSON.stringify(priorityColors));

const colHeaderColors = await page.evaluate(() => {
  const colLabels = ['Blocked', 'Ready', 'In Progress', 'PR / Review', 'Done'];
  return colLabels.map(label => {
    const textEls = Array.from(document.querySelectorAll('*')).filter(
      el => el.textContent?.trim() === label && el.children.length === 0
    );
    for (const textEl of textEls) {
      let target = textEl;
      for (let i = 0; i < 8; i++) {
        const cs = getComputedStyle(target);
        if (cs.borderTopWidth === '2px') {
          return { label, color: cs.borderTopColor };
        }
        if (!target.parentElement) break;
        target = target.parentElement;
      }
    }
    return { label, color: null };
  });
});
console.log('Column header colors:', JSON.stringify(colHeaderColors));

await browser.close();
})();
