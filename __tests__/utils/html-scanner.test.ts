import { describe, it, expect } from 'vitest';
import { scanHtmlSafety } from '../../src/utils/html-scanner.js';

function html(script: string): string {
  return `<html><body><script>\n${script}\n</script></body></html>`;
}

describe('scanHtmlSafety', () => {
  describe('clean HTML', () => {
    it('returns safe: true with no issues for plain HTML', () => {
      const result = scanHtmlSafety('<html><body><p>Hello</p></body></html>');
      expect(result.safe).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('returns safe: true for HTML with no script tags', () => {
      const result = scanHtmlSafety('<html><head><style>body{}</style></head></html>');
      expect(result.safe).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('requestAnimationFrame', () => {
    it('flags unbounded rAF loop as warning', () => {
      const result = scanHtmlSafety(
        html('function loop() { requestAnimationFrame(loop); } loop();')
      );
      expect(result.safe).toBe(false);
      const issue = result.issues.find((i) => i.pattern === 'unbounded-raf');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
    });

    it('passes rAF with cancelAnimationFrame present', () => {
      const script = `
        let id;
        function loop() { id = requestAnimationFrame(loop); }
        loop();
        cancelAnimationFrame(id);
      `;
      const result = scanHtmlSafety(html(script));
      expect(result.issues.filter((i) => i.pattern === 'unbounded-raf')).toHaveLength(0);
    });

    it('passes rAF with document.hidden check', () => {
      const script = `
        function loop() {
          if (document.hidden) return;
          requestAnimationFrame(loop);
        }
      `;
      const result = scanHtmlSafety(html(script));
      expect(result.issues.filter((i) => i.pattern === 'unbounded-raf')).toHaveLength(0);
    });

    it('passes rAF with alpha threshold check', () => {
      const script = `
        function loop() {
          if (alpha < 0.01) return;
          requestAnimationFrame(loop);
        }
      `;
      const result = scanHtmlSafety(html(script));
      expect(result.issues.filter((i) => i.pattern === 'unbounded-raf')).toHaveLength(0);
    });
  });

  describe('setInterval', () => {
    it('flags setInterval without clearInterval as warning', () => {
      const result = scanHtmlSafety(html('setInterval(() => update(), 100);'));
      expect(result.safe).toBe(false);
      const issue = result.issues.find((i) => i.pattern === 'setinterval-no-clear');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
    });

    it('passes setInterval when clearInterval is present', () => {
      const script = `
        const id = setInterval(() => update(), 100);
        window.addEventListener('unload', () => clearInterval(id));
      `;
      const result = scanHtmlSafety(html(script));
      expect(result.issues.filter((i) => i.pattern === 'setinterval-no-clear')).toHaveLength(0);
    });
  });

  describe('infinite loops', () => {
    it('flags while(true) as critical', () => {
      const result = scanHtmlSafety(html('while (true) { doWork(); }'));
      expect(result.safe).toBe(false);
      const issue = result.issues.find((i) => i.pattern === 'infinite-loop');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('critical');
    });

    it('flags for(;;) as critical', () => {
      const result = scanHtmlSafety(html('for (;;) { doWork(); }'));
      const issue = result.issues.find((i) => i.pattern === 'infinite-loop');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('critical');
    });

    it('does not flag for loops with conditions', () => {
      const result = scanHtmlSafety(html('for (let i = 0; i < 10; i++) { doWork(); }'));
      expect(result.issues.filter((i) => i.pattern === 'infinite-loop')).toHaveLength(0);
    });
  });

  describe('Web Workers', () => {
    it('flags new Worker without terminate as warning', () => {
      const result = scanHtmlSafety(html("const w = new Worker('worker.js');"));
      expect(result.safe).toBe(false);
      const issue = result.issues.find((i) => i.pattern === 'worker-no-terminate');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
    });

    it('passes new Worker when terminate is present', () => {
      const script = `
        const w = new Worker('worker.js');
        w.onmessage = (e) => { w.terminate(); };
      `;
      const result = scanHtmlSafety(html(script));
      expect(result.issues.filter((i) => i.pattern === 'worker-no-terminate')).toHaveLength(0);
    });
  });

  describe('crash prototype patterns', () => {
    it('flags the unbounded rAF + setInterval combination that caused the crash', () => {
      const crashScript = `
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        let particles = [];

        for (let i = 0; i < 10000; i++) {
          particles.push({ x: Math.random() * 1000, y: Math.random() * 1000, vx: Math.random(), vy: Math.random() });
        }

        function animate() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            ctx.fillRect(p.x, p.y, 2, 2);
          }
          requestAnimationFrame(animate);
        }

        animate();
        setInterval(() => { particles.push({ x: 0, y: 0, vx: 1, vy: 1 }); }, 100);
      `;
      const result = scanHtmlSafety(html(crashScript));
      expect(result.safe).toBe(false);
      const patterns = result.issues.map((i) => i.pattern);
      expect(patterns).toContain('unbounded-raf');
      expect(patterns).toContain('setinterval-no-clear');
    });
  });

  describe('line numbers', () => {
    it('reports approximate line numbers for issues', () => {
      const script = `
const x = 1;
const y = 2;
setInterval(() => {}, 1000);
`;
      const result = scanHtmlSafety(html(script));
      const issue = result.issues.find((i) => i.pattern === 'setinterval-no-clear');
      expect(issue).toBeDefined();
      expect(issue!.line).toBeGreaterThan(1);
    });
  });

  describe('multiple script blocks', () => {
    it('scans each script block independently', () => {
      const page = `
        <html><body>
          <script>requestAnimationFrame(loop);</script>
          <script>setInterval(() => {}, 500);</script>
        </body></html>
      `;
      const result = scanHtmlSafety(page);
      const patterns = result.issues.map((i) => i.pattern);
      expect(patterns).toContain('unbounded-raf');
      expect(patterns).toContain('setinterval-no-clear');
    });
  });
});
