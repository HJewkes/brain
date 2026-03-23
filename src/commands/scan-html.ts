import { readFileSync } from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import { scanHtmlSafety } from '../utils/html-scanner.js';
import type { ScanIssue } from '../utils/html-scanner.js';

function severityLabel(severity: ScanIssue['severity']): string {
  switch (severity) {
    case 'critical':
      return 'CRITICAL';
    case 'warning':
      return 'WARNING';
    case 'info':
      return 'INFO';
  }
}

export const scanHtmlCommand = new Command('scan-html')
  .description('Scan an HTML file for runaway browser patterns before opening')
  .argument('<file>', 'Path to HTML file to scan')
  .option('--json', 'Output as JSON')
  .action((file, opts) => {
    const content = readFileSync(file, 'utf8');
    const result = scanHtmlSafety(content);

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.safe) process.exitCode = 1;
      return;
    }

    if (result.issues.length === 0) {
      process.stdout.write(`✓ ${file} — no issues detected\n`);
      return;
    }

    for (const issue of result.issues) {
      process.stdout.write(
        `[${severityLabel(issue.severity)}] line ${issue.line}: ${issue.message}\n  → ${issue.suggestion}\n`
      );
    }

    if (!result.safe) {
      process.stderr.write(`\n${file} has safety issues. Review before opening in a browser.\n`);
      process.exitCode = 1;
    }
  });
