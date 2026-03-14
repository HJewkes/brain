import { Command } from '@commander-js/extra-typings';
import { resolve } from 'node:path';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import { scanProject } from '../scanner.js';
import { generateNotes } from '../note-generator.js';

// ---------------------------------------------------------------------------
// Previous hash loading
// ---------------------------------------------------------------------------

export function loadPreviousHashes(outputDir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  if (!existsSync(outputDir)) return hashes;

  const files = readdirSync(outputDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const content = readFileSync(resolve(outputDir, file), 'utf-8');
    const { data } = matter(content);
    const modulePath = data['module-path'] as string | undefined;
    const exportsHash = data['exports-hash'] as string | undefined;
    if (modulePath && exportsHash) {
      hashes.set(modulePath, exportsHash);
    }
  }

  return hashes;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

interface IndexSummary {
  filesScanned: number;
  modulesFound: number;
  created: string[];
  updated: string[];
  unchanged: string[];
}

function printTextSummary(dir: string, summary: IndexSummary): void {
  process.stderr.write(`Scanning ${dir}...\n`);
  process.stderr.write(`  Files scanned: ${summary.filesScanned}\n`);
  process.stderr.write(`  Modules found: ${summary.modulesFound}\n`);
  process.stderr.write(`  Notes created: ${summary.created.length}\n`);
  process.stderr.write(`  Notes updated: ${summary.updated.length}\n`);
  process.stderr.write(`  Notes unchanged: ${summary.unchanged.length}\n`);
}

function printJsonSummary(summary: IndexSummary): void {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createCodebaseIndexCommand(): Command {
  const cmd = new Command('index').description('Scan and index codebase architecture');

  cmd
    .argument('[dir]', 'Directory to scan', process.cwd())
    .option('--project <name>', 'Project name for notes', 'default')
    .option('--include <patterns...>', 'Include glob patterns')
    .option('--exclude <patterns...>', 'Exclude glob patterns')
    .option('--dry-run', 'Show what would be generated without writing')
    .option('--force', 'Regenerate all notes, ignore hashes')
    .option('--json', 'Output JSON')
    .action(async (dir: string, opts) => {
      const projectName = (opts as { project: string }).project;
      const projectDir = resolve(dir);
      const outputDir = resolve(projectDir, '.brain', 'notes', 'modules', 'codebase', projectName);

      const force = (opts as { force?: true }).force;
      const dryRun = (opts as { dryRun?: true }).dryRun;
      const json = (opts as { json?: true }).json;
      const include = (opts as { include?: string[] }).include;
      const exclude = (opts as { exclude?: string[] }).exclude;

      const previousHashes = force ? new Map<string, string>() : loadPreviousHashes(outputDir);

      const scanResult = await scanProject(projectDir, {
        include,
        exclude,
        previousHashes,
      });

      const noteResult = generateNotes(scanResult, {
        projectName,
        outputDir,
        dryRun,
        forceAll: force,
      });

      const summary: IndexSummary = {
        filesScanned: scanResult.stats.filesScanned,
        modulesFound: scanResult.stats.modulesFound,
        created: noteResult.created,
        updated: noteResult.updated,
        unchanged: noteResult.unchanged,
      };

      if (json) {
        printJsonSummary(summary);
      } else {
        printTextSummary(projectDir, summary);
      }
    });

  return cmd;
}
