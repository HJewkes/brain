import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  assembleDispatch,
  assembleProjectContext,
  assembleWorkstreamContext,
  type ContextBundle,
  type ProjectContext,
  type WorkstreamContext,
} from '../engine/dispatch.js';
import { parseDisplayId } from '../ids.js';
import { getPmNotes } from '../data/queries.js';
import { search } from '../../../services/search.js';

function formatHuman(bundle: ContextBundle): string {
  const lines: string[] = [];

  const title = bundle.task.title ?? bundle.task.display_id;
  lines.push(`Task: ${bundle.task.display_id} - ${title}`);
  lines.push(
    `Status: ${bundle.task.status} | Priority: ${bundle.task.priority} | Category: ${bundle.task.category}`
  );

  if (bundle.workstream) {
    lines.push(`Workstream: ${bundle.workstream.displayId} - ${bundle.workstream.title}`);
  }
  lines.push('');

  if (bundle.body) {
    lines.push('--- Description ---');
    lines.push(bundle.body);
    lines.push('');
  }

  if (bundle.relatedNotes.length > 0) {
    lines.push('--- Related Notes ---');
    for (const note of bundle.relatedNotes) {
      const sourceLabel = note.source === 'semantic' ? ' [semantic]' : '';
      lines.push(`  [${note.score.toFixed(2)}]${sourceLabel} ${note.title}`);
      if (note.excerpt) {
        lines.push(`    ${note.excerpt.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  if (bundle.prompt) {
    lines.push('--- Prompt ---');
    lines.push(bundle.prompt);
    lines.push('');
  }

  if (bundle.dependencies.length > 0) {
    lines.push('--- Dependencies ---');
    for (const dep of bundle.dependencies) {
      const summary = dep.summary ? ` - ${dep.summary}` : '';
      lines.push(`  ${dep.displayId} [${dep.status}] ${dep.name}${summary}`);
    }
    lines.push('');
  }

  if (bundle.decisions.length > 0) {
    lines.push('--- Decisions ---');
    for (const dec of bundle.decisions) {
      lines.push(`  ${dec.displayId} [${dec.status}] ${dec.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatProjectHuman(ctx: ProjectContext): string {
  const lines: string[] = [];
  const p = ctx.project;
  lines.push(`Project: ${p.prefix} - ${p.name}`);
  lines.push(`Status: ${p.status}${p.phase ? ` | Phase: ${p.phase}` : ''}`);
  lines.push('');

  if (p.description) {
    lines.push('--- Description ---');
    lines.push(p.description);
    lines.push('');
  }

  if (ctx.workstreams.length > 0) {
    lines.push('--- Workstreams ---');
    for (const ws of ctx.workstreams) {
      const progress = ws.taskCount > 0 ? ` (${ws.doneCount}/${ws.taskCount} done)` : '';
      lines.push(`  ${ws.displayId} [${ws.status}] ${ws.title}${progress}`);
    }
    lines.push('');
  }

  const distEntries = Object.entries(ctx.statusDistribution);
  if (distEntries.length > 0) {
    lines.push('--- Task Distribution ---');
    for (const [status, count] of distEntries.sort()) {
      lines.push(`  ${status}: ${count}`);
    }
    lines.push('');
  }

  if (ctx.criticalTasks.length > 0) {
    lines.push('--- Critical Tasks ---');
    for (const t of ctx.criticalTasks) {
      lines.push(`  ${t.display_id} [${t.status}] ${t.title ?? t.display_id}`);
    }
    lines.push('');
  }

  if (ctx.recentDecisions.length > 0) {
    lines.push('--- Decisions ---');
    for (const dec of ctx.recentDecisions) {
      lines.push(`  ${dec.displayId} [${dec.status}] ${dec.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatWorkstreamHuman(ctx: WorkstreamContext): string {
  const lines: string[] = [];
  const ws = ctx.workstream;
  lines.push(`Workstream: ${ws.displayId} - ${ws.title}`);
  lines.push(`Project: ${ctx.project} | Status: ${ws.status}`);
  lines.push('');

  if (ws.description) {
    lines.push('--- Description ---');
    lines.push(ws.description);
    lines.push('');
  }

  if (ctx.tasks.length > 0) {
    lines.push('--- Tasks ---');
    for (const t of ctx.tasks) {
      lines.push(`  ${t.displayId} [${t.status}] ${t.title} (${t.priority})`);
    }
    lines.push('');
  }

  const distEntries = Object.entries(ctx.statusDistribution);
  if (distEntries.length > 0) {
    lines.push('--- Status Distribution ---');
    for (const [status, count] of distEntries.sort()) {
      lines.push(`  ${status}: ${count}`);
    }
    lines.push('');
  }

  if (ctx.eligibleTasks.length > 0) {
    lines.push('--- Eligible Tasks ---');
    for (const id of ctx.eligibleTasks) {
      lines.push(`  ${id}`);
    }
    lines.push('');
  }

  if (ctx.relatedNotes.length > 0) {
    lines.push('--- Related Notes ---');
    for (const note of ctx.relatedNotes) {
      lines.push(`  [${note.score.toFixed(2)}] ${note.title}`);
      if (note.excerpt) {
        lines.push(`    ${note.excerpt.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  if (ctx.recentDecisions.length > 0) {
    lines.push('--- Decisions ---');
    for (const dec of ctx.recentDecisions) {
      lines.push(`  ${dec.displayId} [${dec.status}] ${dec.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function didYouMeanSuggestion(
  db: Parameters<typeof getPmNotes>[0],
  displayId: string
): string | undefined {
  const parsed = parseDisplayId(displayId);
  if (!parsed) return undefined;

  if (parsed.task !== undefined) {
    const allTasks = getPmNotes(db, 'task');
    for (const note of allTasks) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.workstream === parsed.workstream && meta.number === parsed.task) {
        return meta.display_id as string;
      }
    }
  }

  if (parsed.workstream !== undefined && parsed.task === undefined) {
    const allWs = getPmNotes(db, 'workstream');
    for (const note of allWs) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.number === parsed.workstream) {
        return meta.display_id as string;
      }
    }
  }

  return undefined;
}

function availableProjects(db: Parameters<typeof getPmNotes>[0]): string[] {
  return getPmNotes(db, 'project')
    .map((n) => {
      if (!n.metadata) return undefined;
      const m = JSON.parse(n.metadata) as Record<string, unknown>;
      return m.prefix as string | undefined;
    })
    .filter((p): p is string => !!p);
}

export function createContextCommand(): Command {
  const cmd = new Command('context')
    .description('Assemble rich context for a project, workstream, or task')
    .argument('<id>', 'Display ID (project: PROJ, workstream: PROJ-01, task: PROJ-01.03)')
    .option('--decisions', 'Include decisions (default: true)')
    .option('--no-deps', 'Omit dependencies from context')
    .option('--since <timestamp>', 'Filter to activities/decisions after timestamp')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        let displayId = id.toUpperCase();
        const parsed = parseDisplayId(displayId);

        if (!parsed) {
          process.stderr.write(`Error [INVALID_INPUT]: Invalid display ID format "${id}"\n`);
          process.exitCode = 1;
          return;
        }

        if (parsed.task !== undefined) {
          const ctxOpts = { deps: opts.deps };
          let result = await assembleDispatch(svc.db, svc.embedder, svc.config, displayId, ctxOpts);
          if (!result.ok) {
            const suggestion = didYouMeanSuggestion(svc.db, displayId);
            if (suggestion) {
              process.stderr.write(`Corrected ${displayId} → ${suggestion}\n`);
              displayId = suggestion;
              result = await assembleDispatch(svc.db, svc.embedder, svc.config, displayId, ctxOpts);
            }
            if (!result.ok) {
              const projects = availableProjects(svc.db);
              let msg = formatError(result.error, !!opts.json);
              if (!opts.json && projects.length > 0) {
                msg += `\n  Available projects: ${projects.join(', ')}`;
              }
              process.stderr.write(msg + '\n');
              process.exitCode = 1;
              return;
            }
          }
          // Semantic fallback: when graph context has no edges, search by content
          const bundle = result.data;
          const hasGraphContext =
            bundle.dependencies.length > 0 ||
            bundle.decisions.length > 0 ||
            bundle.relatedNotes.length > 0;

          if (!hasGraphContext) {
            const query = [bundle.task.title, bundle.body]
              .filter(Boolean)
              .join(' ')
              .trim()
              .slice(0, 300);

            if (query) {
              try {
                const semanticResults = await search(
                  svc.db,
                  svc.embedder,
                  query,
                  { limit: 6, includePm: true },
                  svc.config.fusionWeights ?? { bm25: 0.4, vector: 0.6 }
                );
                const taskNoteId = getPmNotes(svc.db, 'task', { display_id: displayId })[0]?.id;
                bundle.relatedNotes = semanticResults
                  .filter((r) => r.noteId !== taskNoteId)
                  .slice(0, 5)
                  .map((r) => ({
                    title: r.heading ?? r.filePath,
                    excerpt: r.excerpt ?? '',
                    score: r.score,
                    source: 'semantic' as const,
                  }));
              } catch {
                // Semantic fallback failure is non-fatal
              }
            }
          }

          if (opts.json) {
            process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
          } else {
            process.stdout.write(formatHuman(bundle) + '\n');
          }
        } else if (parsed.workstream !== undefined) {
          let result = await assembleWorkstreamContext(svc.db, displayId, svc.embedder, svc.config);
          if (!result.ok) {
            const suggestion = didYouMeanSuggestion(svc.db, displayId);
            if (suggestion) {
              process.stderr.write(`Corrected ${displayId} → ${suggestion}\n`);
              displayId = suggestion;
              result = await assembleWorkstreamContext(svc.db, displayId, svc.embedder, svc.config);
            }
            if (!result.ok) {
              const projects = availableProjects(svc.db);
              let msg = formatError(result.error, !!opts.json);
              if (!opts.json && projects.length > 0) {
                msg += `\n  Available projects: ${projects.join(', ')}`;
              }
              process.stderr.write(msg + '\n');
              process.exitCode = 1;
              return;
            }
          }
          if (opts.json) {
            process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
          } else {
            process.stdout.write(formatWorkstreamHuman(result.data) + '\n');
          }
        } else {
          const result = assembleProjectContext(svc.db, displayId);
          if (!result.ok) {
            const projects = availableProjects(svc.db);
            let msg = formatError(result.error, !!opts.json);
            if (!opts.json && projects.length > 0) {
              msg += `\n  Available projects: ${projects.join(', ')}`;
            }
            process.stderr.write(msg + '\n');
            process.exitCode = 1;
            return;
          }
          if (opts.json) {
            process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
          } else {
            process.stdout.write(formatProjectHuman(result.data) + '\n');
          }
        }
      });
    });
  return cmd as unknown as Command;
}
