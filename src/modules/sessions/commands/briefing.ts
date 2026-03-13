import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import {
  generateSessionBriefing,
  renderBriefingXml,
  renderBriefingMarkdown,
} from '../engine/session-briefing.js';

export function createSessionBriefingCommand(): Command {
  return new Command('briefing')
    .description('Generate a contextual session startup briefing')
    .option('--format <fmt>', 'Output format: xml, markdown, json', 'markdown')
    .option('--json', 'Output JSON (shorthand for --format json)')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const format = opts.json ? 'json' : (opts.format ?? 'markdown');
        const briefing = generateSessionBriefing(svc.db, svc.config, process.cwd());

        if (format === 'json') {
          process.stdout.write(JSON.stringify(briefing, null, 2) + '\n');
        } else if (format === 'xml') {
          process.stdout.write(renderBriefingXml(briefing) + '\n');
        } else {
          process.stdout.write(renderBriefingMarkdown(briefing) + '\n');
        }
      });
    });
}
