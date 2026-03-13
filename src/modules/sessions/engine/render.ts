import type { SessionContextBundle } from './context-bundle.js';
import { formatDuration } from '../utils.js';

export type RenderFormat = 'markdown' | 'xml' | 'json';

export function renderSessionContext(bundle: SessionContextBundle, format: RenderFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(bundle, null, 2);
    case 'xml':
      return renderXml(bundle);
    case 'markdown':
    default:
      return renderMarkdown(bundle);
  }
}

function renderMarkdown(bundle: SessionContextBundle): string {
  const { session } = bundle;
  const lines: string[] = [];

  lines.push(`# Session ${session.display_id}`);
  lines.push('');
  if (session.summary) lines.push(`> ${session.summary}`);
  lines.push('');

  lines.push('## Session Info');
  lines.push(`- **Status**: ${session.status}`);
  lines.push(`- **Started**: ${session.started_at}`);
  if (session.branch) lines.push(`- **Branch**: ${session.branch}`);
  if (session.duration_minutes != null) {
    lines.push(`- **Duration**: ${formatDuration(session.duration_minutes * 60000)}`);
  }
  lines.push('');

  if (bundle.taskStatus.length > 0) {
    lines.push('## Task Status');
    for (const t of bundle.taskStatus) {
      lines.push(`- ${t.taskId}: ${t.status}`);
    }
    lines.push('');
  }

  if (bundle.openItems.length > 0) {
    lines.push('## Open Items');
    for (const item of bundle.openItems) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  if (bundle.activeFiles.length > 0) {
    lines.push('## Active Files');
    for (const f of bundle.activeFiles) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  if (bundle.overview) {
    lines.push('## Overview');
    lines.push(bundle.overview);
    lines.push('');
  }

  if (bundle.microSummaries.length > 0) {
    lines.push('## Session Snapshots');
    for (const s of bundle.microSummaries) {
      lines.push(s);
      lines.push('---');
    }
    lines.push('');
  }

  if (bundle.truncated) {
    lines.push('*[Context truncated to fit token budget]*');
  }

  return lines.join('\n');
}

function renderXml(bundle: SessionContextBundle): string {
  const { session } = bundle;
  const lines: string[] = [];

  lines.push('<session_context>');
  lines.push(
    `  <session id="${session.display_id}" uuid="${session.session_id}" status="${session.status}">`
  );
  if (session.summary) lines.push(`    <summary>${escapeXml(session.summary)}</summary>`);
  lines.push(`    <started_at>${session.started_at}</started_at>`);
  if (session.branch) lines.push(`    <branch>${escapeXml(session.branch)}</branch>`);
  if (session.duration_minutes != null) {
    lines.push(`    <duration_minutes>${session.duration_minutes}</duration_minutes>`);
  }
  lines.push('  </session>');

  if (bundle.taskStatus.length > 0) {
    lines.push('  <tasks>');
    for (const t of bundle.taskStatus) {
      lines.push(`    <task id="${escapeXml(t.taskId)}" status="${escapeXml(t.status)}" />`);
    }
    lines.push('  </tasks>');
  }

  if (bundle.openItems.length > 0) {
    lines.push('  <open_items>');
    for (const item of bundle.openItems) {
      lines.push(`    <item>${escapeXml(item)}</item>`);
    }
    lines.push('  </open_items>');
  }

  if (bundle.activeFiles.length > 0) {
    lines.push('  <active_files>');
    for (const f of bundle.activeFiles) {
      lines.push(`    <file>${escapeXml(f)}</file>`);
    }
    lines.push('  </active_files>');
  }

  if (bundle.overview) {
    lines.push(`  <overview>${escapeXml(bundle.overview)}</overview>`);
  }

  if (bundle.microSummaries.length > 0) {
    lines.push('  <micro_summaries>');
    for (const s of bundle.microSummaries) {
      lines.push(`    <snapshot>${escapeXml(s)}</snapshot>`);
    }
    lines.push('  </micro_summaries>');
  }

  lines.push('</session_context>');
  return lines.join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
