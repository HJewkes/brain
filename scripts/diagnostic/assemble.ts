/**
 * Diagnostic Results Assembler
 *
 * Reads structured JSON from test bench agents, computes aggregates,
 * and writes a markdown report with scorecard and per-prompt analysis.
 *
 * Usage: npx tsx scripts/diagnostic/assemble.ts --version v4 --previous v3 --results-dir docs/pm-module/diagnostic/v4
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

interface TestMetrics {
  total_calls: number;
  brain_cli_calls: number;
  non_brain_calls: number;
  file_reads: number;
  quality: number;
}

interface TestAnalysis {
  what_worked: string;
  friction_points: string;
  known_gaps_hit: string[];
  new_issues: Array<{ description: string; severity: string }>;
}

interface TestResult {
  id: string;
  version: string;
  category: string;
  prompt: string;
  commands: string[];
  metrics: TestMetrics;
  answer: string;
  analysis: TestAnalysis;
}

const CATEGORIES = [
  'Discovery', 'Navigation', 'Context Assembly', 'Planning',
  'Capabilities', 'Gap Exercisers', 'Write Ops', 'Agent Commands',
  'Cross-System', 'Filtering',
];

const CATEGORY_SHORT: Record<string, string> = {
  'Discovery': 'Discovery',
  'Navigation': 'Navigation',
  'Context Assembly': 'Context',
  'Planning': 'Planning',
  'Capabilities': 'Capabilities',
  'Gap Exercisers': 'Gap Exercise',
  'Write Ops': 'Write Ops',
  'Agent Commands': 'Agent Cmds',
  'Cross-System': 'Cross-System',
  'Filtering': 'Filtering',
};

function loadResults(dir: string): TestResult[] {
  const results: TestResult[] = [];
  const benchDir = join(dir, 'test-bench');

  if (!existsSync(benchDir)) return results;

  const files = readdirSync(benchDir)
    .filter(f => f.match(/^P-\d{2}\.json$/))
    .sort();

  for (const file of files) {
    try {
      const raw = readFileSync(join(benchDir, file), 'utf-8');
      const parsed = JSON.parse(raw);

      // Handle claude -p --output-format json wrapping
      if (!parsed.result) {
        console.error(`  WARN: Skipping ${file}: no result field (${parsed.subtype ?? 'unknown'})`);
        continue;
      }

      // Strip markdown code fences if the agent wrapped its JSON
      let resultStr = parsed.result;
      resultStr = resultStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');

      // Strip any prose before/after the JSON object
      const jsonStart = resultStr.indexOf('{');
      const jsonEnd = resultStr.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        console.error(`  WARN: Skipping ${file}: no JSON object found in result`);
        continue;
      }
      resultStr = resultStr.slice(jsonStart, jsonEnd + 1);

      const result = JSON.parse(resultStr);
      results.push(result);
    } catch (e) {
      console.error(`  WARN: Failed to parse ${file}: ${(e as Error).message}`);
    }
  }

  return results;
}

function brainPct(r: TestResult): number {
  if (r.metrics.total_calls === 0) return 0;
  return Math.round((r.metrics.brain_cli_calls / r.metrics.total_calls) * 100);
}

function buildScorecard(
  current: TestResult[],
  previous: TestResult[],
  version: string,
  prevVersion: string,
): string {
  const prevMap = new Map(previous.map(r => [r.id, r]));
  const lines: string[] = [];

  lines.push(`| Prompt | Category | ${prevVersion} Calls | ${version} Calls | ${prevVersion} Brain% | ${version} Brain% | ${prevVersion} Reads | ${version} Reads | ${prevVersion} Q | ${version} Q |`);
  lines.push('|--------|----------|----------|----------|-----------|-----------|----------|----------|------|------|');

  for (const r of current) {
    const prev = prevMap.get(r.id);
    const cat = CATEGORY_SHORT[r.category] ?? r.category;
    const prevCalls = prev ? String(prev.metrics.total_calls) : 'N/A';
    const prevBrain = prev ? `${brainPct(prev)}%` : 'N/A';
    const prevReads = prev ? String(prev.metrics.file_reads) : 'N/A';
    const prevQ = prev ? `${prev.metrics.quality}/5` : 'N/A';

    lines.push(
      `| ${r.id} | ${cat} | ${prevCalls} | **${r.metrics.total_calls}** | ${prevBrain} | **${brainPct(r)}%** | ${prevReads} | **${r.metrics.file_reads}** | ${prevQ} | **${r.metrics.quality}/5** |`,
    );
  }

  return lines.join('\n');
}

function buildAggregates(
  current: TestResult[],
  previous: TestResult[],
  version: string,
  prevVersion: string,
): string {
  const calc = (results: TestResult[]) => {
    if (results.length === 0) return null;
    const totalCalls = results.reduce((s, r) => s + r.metrics.total_calls, 0);
    const totalBrain = results.reduce((s, r) => s + r.metrics.brain_cli_calls, 0);
    const totalReads = results.reduce((s, r) => s + r.metrics.file_reads, 0);
    const totalNonBrain = results.reduce((s, r) => s + r.metrics.non_brain_calls, 0);
    const avgQuality = results.reduce((s, r) => s + r.metrics.quality, 0) / results.length;
    const at5 = results.filter(r => r.metrics.quality === 5).length;
    const at3orBelow = results.filter(r => r.metrics.quality <= 3).length;
    return {
      totalCalls,
      avgCalls: totalCalls / results.length,
      brainPct: totalCalls > 0 ? Math.round((totalBrain / totalCalls) * 100) : 0,
      totalReads,
      totalNonBrain,
      avgQuality,
      at5,
      at3orBelow,
      count: results.length,
    };
  };

  const cur = calc(current)!;
  const prev = calc(previous);

  const delta = (curVal: number, prevVal: number | undefined, suffix = '', invert = false) => {
    if (prevVal === undefined) return '—';
    const diff = curVal - prevVal;
    if (diff === 0) return 'flat';
    const sign = diff > 0 ? '+' : '';
    return `**${sign}${diff.toFixed(1)}${suffix}**`;
  };

  const pctDelta = (curVal: number, prevVal: number | undefined) => {
    if (prevVal === undefined || prevVal === 0) return '—';
    const pct = ((curVal - prevVal) / prevVal) * 100;
    const sign = pct > 0 ? '+' : '';
    return `**${sign}${pct.toFixed(1)}%**`;
  };

  if (!cur) {
    return `*No results for ${version} — all test agents failed or produced no output.*`;
  }

  const lines = [
    `| Metric | ${prevVersion} (${prev?.count ?? '?'}p) | ${version} (${cur.count}p) | Delta |`,
    '|--------|----------|----------|-------|',
    `| Total tool calls | ${prev?.totalCalls ?? '?'} | **${cur.totalCalls}** | ${pctDelta(cur.totalCalls, prev?.totalCalls)} |`,
    `| Avg calls per prompt | ${prev ? prev.avgCalls.toFixed(1) : '?'} | **${cur.avgCalls.toFixed(1)}** | ${delta(cur.avgCalls, prev?.avgCalls)} |`,
    `| Brain CLI % | ${prev ? prev.brainPct + '%' : '?'} | **${cur.brainPct}%** | ${delta(cur.brainPct, prev?.brainPct, 'pp')} |`,
    `| Direct file reads | ${prev?.totalReads ?? '?'} | **${cur.totalReads}** | ${delta(cur.totalReads, prev?.totalReads)} |`,
    `| Non-brain calls | ${prev?.totalNonBrain ?? '?'} | **${cur.totalNonBrain}** | ${delta(cur.totalNonBrain, prev?.totalNonBrain)} |`,
    `| Avg quality | ${prev ? (prev.avgQuality).toFixed(1) + '/5' : '?'} | **${cur.avgQuality.toFixed(1)}/5** | ${delta(cur.avgQuality, prev?.avgQuality)} |`,
    `| Prompts at 5/5 | ${prev ? prev.at5 + '/' + prev.count : '?'} | **${cur.at5}/${cur.count}** | ${delta(cur.at5, prev?.at5)} |`,
    `| Prompts at <=3/5 | ${prev ? prev.at3orBelow + '/' + prev.count : '?'} | **${cur.at3orBelow}/${cur.count}** | ${delta(cur.at3orBelow, prev?.at3orBelow)} |`,
  ];

  return lines.join('\n');
}

function buildPerPromptAnalysis(current: TestResult[], previous: TestResult[]): string {
  const prevMap = new Map(previous.map(r => [r.id, r]));
  const sections: string[] = [];

  let currentCategory = '';

  for (const r of current) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      sections.push(`\n### ${currentCategory}\n`);
    }

    const prev = prevMap.get(r.id);

    sections.push(`#### ${r.id}: "${r.prompt}"\n`);

    // Metrics table
    const lines = [
      '| Metric | Previous | Current |',
      '|--------|----------|---------|',
      `| Total calls | ${prev?.metrics.total_calls ?? 'N/A'} | **${r.metrics.total_calls}** |`,
      `| Brain CLI | ${prev?.metrics.brain_cli_calls ?? 'N/A'} | **${r.metrics.brain_cli_calls}** |`,
      `| Non-brain | ${prev?.metrics.non_brain_calls ?? 'N/A'} | **${r.metrics.non_brain_calls}** |`,
      `| File reads | ${prev?.metrics.file_reads ?? 'N/A'} | **${r.metrics.file_reads}** |`,
      `| Quality | ${prev ? prev.metrics.quality + '/5' : 'N/A'} | **${r.metrics.quality}/5** |`,
    ];
    sections.push(lines.join('\n'));

    // Command log
    if (r.commands.length > 0) {
      sections.push(`\n**Commands:** ${r.commands.map(c => '`' + c + '`').join(' → ')}\n`);
    }

    // Analysis
    if (r.analysis.what_worked) {
      sections.push(`**What worked:** ${r.analysis.what_worked}\n`);
    }
    if (r.analysis.friction_points) {
      sections.push(`**Friction:** ${r.analysis.friction_points}\n`);
    }
    if (r.analysis.known_gaps_hit.length > 0) {
      sections.push(`**Known gaps confirmed:** ${r.analysis.known_gaps_hit.join(', ')}\n`);
    }
    if (r.analysis.new_issues.length > 0) {
      sections.push('**New issues:**');
      for (const issue of r.analysis.new_issues) {
        sections.push(`- [${issue.severity}] ${issue.description}`);
      }
      sections.push('');
    }

    sections.push('---\n');
  }

  return sections.join('\n');
}

function buildCrossCutting(current: TestResult[]): string {
  const sections: string[] = [];

  // Quality distribution by category
  const byCategory = new Map<string, TestResult[]>();
  for (const r of current) {
    const cat = r.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(r);
  }

  sections.push('### Quality by Category\n');
  sections.push('| Category | Avg Quality | Avg Calls |');
  sections.push('|----------|-------------|-----------|');
  for (const [cat, results] of byCategory) {
    const avgQ = results.reduce((s, r) => s + r.metrics.quality, 0) / results.length;
    const avgC = results.reduce((s, r) => s + r.metrics.total_calls, 0) / results.length;
    sections.push(`| ${cat} | ${avgQ.toFixed(1)}/5 | ${avgC.toFixed(1)} |`);
  }

  // Most common gaps hit
  const gapCounts = new Map<string, number>();
  for (const r of current) {
    for (const gap of r.analysis.known_gaps_hit) {
      gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1);
    }
  }

  if (gapCounts.size > 0) {
    const sorted = [...gapCounts.entries()].sort((a, b) => b[1] - a[1]);
    sections.push('\n### Most Frequent Gaps Hit\n');
    sections.push('| Observation | Prompts Affected |');
    sections.push('|-------------|-----------------|');
    for (const [gap, count] of sorted.slice(0, 10)) {
      sections.push(`| ${gap} | ${count} |`);
    }
  }

  // New issues across all prompts
  const allIssues: Array<{ description: string; severity: string; source: string }> = [];
  for (const r of current) {
    for (const issue of r.analysis.new_issues) {
      allIssues.push({ ...issue, source: r.id });
    }
  }

  if (allIssues.length > 0) {
    sections.push('\n### New Issues Discovered\n');
    sections.push('| Source | Severity | Description |');
    sections.push('|--------|----------|-------------|');
    for (const issue of allIssues) {
      sections.push(`| ${issue.source} | ${issue.severity} | ${issue.description} |`);
    }
  }

  return sections.join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      previous: { type: 'string' },
      'results-dir': { type: 'string' },
    },
  });

  const version = values.version!;
  const previous = values.previous!;
  const resultsDir = values['results-dir']!;

  console.log(`  Loading ${version} results from ${resultsDir}/test-bench/`);
  const current = loadResults(resultsDir);
  console.log(`  Found ${current.length} results`);

  const prevDir = resultsDir.replace(version, previous);
  let previousResults: TestResult[] = [];
  if (existsSync(join(prevDir, 'test-bench'))) {
    console.log(`  Loading ${previous} results from ${prevDir}/test-bench/`);
    previousResults = loadResults(prevDir);
    console.log(`  Found ${previousResults.length} previous results`);
  } else {
    console.log(`  No previous results found at ${prevDir}`);
  }

  // Sort by prompt number
  current.sort((a, b) => a.id.localeCompare(b.id));
  previousResults.sort((a, b) => a.id.localeCompare(b.id));

  const today = new Date().toISOString().split('T')[0];

  const report = `# PM Module Test Bench Results — ${version.toUpperCase()}

**Date:** ${today}
**Agent model:** claude-sonnet-4-6
**Prompts run:** ${current.length} of 30

---

## Aggregate Metrics

${buildAggregates(current, previousResults, version, previous)}

---

## Full Scorecard

${buildScorecard(current, previousResults, version, previous)}

---

## Per-Prompt Analysis

${buildPerPromptAnalysis(current, previousResults)}

## Cross-Cutting Findings

${buildCrossCutting(current)}
`;

  const outPath = join(resultsDir, 'test-bench-results.md');
  writeFileSync(outPath, report);
  console.log(`  Wrote ${outPath}`);
}

main();
