import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { isJsonFormat } from './format.js';
import type { SnapshotTier } from '../services/context-snapshot.js';
import {
  generateSnapshot,
  formatSnapshotText,
  formatSnapshotMarkdown,
  formatSnapshotXml,
} from '../services/context-snapshot.js';

const VALID_TIERS: SnapshotTier[] = ['compact', 'standard', 'full'];

export const profileCommand = new Command('profile')
  .description('Generate a context profile from stable memories for agent system prompts')
  .option('--container <tag>', 'Filter memories by container tag')
  .option('--limit <n>', 'Max memories to include', '50')
  .option('--tier <tier>', 'Snapshot tier: compact (~500tok), standard (~2K), full (~8K)')
  .option('--json', 'Output as JSON')
  .option('--format <format>', 'Output format: text, markdown, xml', 'text')
  .action(async (opts, cmd) => {
    await withDb(({ db }) => {
      const tier = opts.tier as SnapshotTier | undefined;

      if (tier && !VALID_TIERS.includes(tier)) {
        process.stderr.write(`Invalid tier "${tier}". Valid: ${VALID_TIERS.join(', ')}\n`);
        process.exitCode = 1;
        return;
      }

      if (tier) {
        const snapshot = generateSnapshot(db, tier, opts.container);

        if (isJsonFormat(opts, cmd)) {
          process.stdout.write(
            JSON.stringify({
              tier: snapshot.tier,
              memories: snapshot.memories.map((m) => ({
                fact: m.memory,
                category: m.category,
                container: m.containerTag,
                source: m.sourceNoteId,
                since: m.validAt,
              })),
              stats: snapshot.stats,
            }) + '\n'
          );
          return;
        }

        const format = opts.format ?? 'text';
        if (format === 'xml') {
          process.stdout.write(formatSnapshotXml(snapshot));
        } else if (format === 'markdown') {
          process.stdout.write(formatSnapshotMarkdown(snapshot));
        } else {
          process.stdout.write(formatSnapshotText(snapshot));
        }
        return;
      }

      // Legacy path: no tier specified
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
