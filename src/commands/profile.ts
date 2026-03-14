import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { isJsonFormat } from './format.js';

export const profileCommand = new Command('profile')
  .description('Generate a context profile from stable memories for agent system prompts')
  .option('--container <tag>', 'Filter memories by container tag')
  .option('--limit <n>', 'Max memories to include', '50')
  .option('--json', 'Output as JSON')
  .option('--format <format>', 'Output format: text, markdown, xml', 'text')
  .action(async (opts, cmd) => {
    await withDb(({ db }) => {
      db.forgetExpiredMemories();

      const memories = db.getLatestMemories(opts.container);
      const limit = parseInt(opts.limit, 10);
      const limited = memories.slice(0, limit);

      const noteCount = db.getNoteCount();
      const memoryCount = db.getMemoryCount();

      if (isJsonFormat(opts, cmd)) {
        process.stdout.write(
          JSON.stringify({
            memories: limited.map((m) => ({
              fact: m.memory,
              container: m.containerTag,
              source: m.sourceNoteId,
              since: m.validAt,
            })),
            stats: { totalNotes: noteCount, totalMemories: memoryCount },
          }) + '\n'
        );
        return;
      }

      const format = opts.format ?? 'text';

      if (format === 'xml') {
        const lines = ['<context>'];
        lines.push(`  <stats notes="${noteCount}" memories="${memoryCount}" />`);
        lines.push('  <memories>');
        for (const m of limited) {
          lines.push(
            `    <memory container="${m.containerTag}" source="${m.sourceNoteId}">${m.memory}</memory>`
          );
        }
        lines.push('  </memories>');
        lines.push('</context>');
        process.stdout.write(lines.join('\n') + '\n');
        return;
      }

      if (format === 'markdown') {
        const lines = [`# Context Profile`, ''];
        lines.push(`Knowledge base: ${noteCount} notes, ${memoryCount} active memories`, '');
        if (limited.length > 0) {
          lines.push('## Known Facts', '');
          for (const m of limited) {
            const tag = m.containerTag !== 'default' ? ` (${m.containerTag})` : '';
            lines.push(`- ${m.memory}${tag}`);
          }
        }
        process.stdout.write(lines.join('\n') + '\n');
        return;
      }

      // Default: plain text
      const lines = [`Context: ${noteCount} notes, ${memoryCount} memories`, ''];
      if (limited.length > 0) {
        lines.push('Known facts:');
        for (const m of limited) {
          const tag = m.containerTag !== 'default' ? ` [${m.containerTag}]` : '';
          lines.push(`- ${m.memory}${tag}`);
        }
      }
      process.stdout.write(lines.join('\n') + '\n');
    }, parentResolveOpts(cmd));
  });
