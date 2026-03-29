import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import { listSessions } from '../data/session-ops.js';
import { getActiveProject } from '../../pm/data/queries.js';
import { listTasks } from '../../pm/data/task-ops.js';
import { computeEligible } from '../../pm/engine/dependency.js';
import { getTask } from '../../pm/data/task-ops.js';

export interface BriefingSection {
  heading: string;
  items: string[];
}

export interface SessionBriefing {
  project: string | null;
  sections: BriefingSection[];
  suggestedFocus: string[];
}

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

export function generateSessionBriefing(
  db: BrainDB,
  _config: BrainConfig,
  _projectDir: string
): SessionBriefing {
  const project = getActiveProject(db);
  const sections: BriefingSection[] = [];
  const suggestedFocus: string[] = [];

  if (!project) {
    return {
      project: null,
      sections: [],
      suggestedFocus: ['Run "brain pm onboard" to set up a project'],
    };
  }

  // 1. In-progress tasks (stale/active work)
  const allTasksResult = listTasks(db, project);
  const allTasks = allTasksResult.ok ? allTasksResult.data : [];

  const inProgress = allTasks.filter((t) => t.status === 'in-progress');
  const claimed = allTasks.filter((t) => t.status === 'claimed');
  const staleWork = [...inProgress, ...claimed];

  if (staleWork.length > 0) {
    sections.push({
      heading: 'Active Work',
      items: staleWork.map((t) => `${t.display_id} [${t.priority}] ${t.title} (${t.status})`),
    });
    for (const t of staleWork.slice(0, 3)) {
      suggestedFocus.push(`Continue ${t.display_id}: ${t.title}`);
    }
  }

  // 2. Eligible tasks (sorted by priority)
  const eligibleIds = computeEligible(db, project);
  const eligible = eligibleIds
    .flatMap((id) => {
      const r = getTask(db, id);
      return r.ok ? [r.data] : [];
    })
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));

  if (eligible.length > 0) {
    sections.push({
      heading: 'Eligible Tasks',
      items: eligible.slice(0, 8).map((t) => `${t.display_id} [${t.priority}] ${t.title}`),
    });
    if (suggestedFocus.length === 0) {
      for (const t of eligible.slice(0, 3)) {
        suggestedFocus.push(`Pick up ${t.display_id}: ${t.title}`);
      }
    }
  }

  // 3. Blocked tasks
  const blocked = allTasks.filter(
    (t) => t.virtualStates?.includes('+BLOCKED') && t.status !== 'done'
  );
  if (blocked.length > 0) {
    sections.push({
      heading: 'Blocked',
      items: blocked.slice(0, 5).map((t) => `${t.display_id}: ${t.title}`),
    });
  }

  // 4. Recent sessions — last session gets detailed handoff, older ones get summary
  const recentSessions = listSessions(db, { project, since: daysAgo(7) }).slice(0, 5);
  if (recentSessions.length > 0) {
    const lastSession = recentSessions[0];

    // Detailed handoff from most recent session
    const handoffItems: string[] = [];
    if (lastSession.summary) {
      handoffItems.push(`Summary: ${lastSession.summary}`);
    }
    if (lastSession.tasks_worked?.length) {
      handoffItems.push(`Tasks worked: ${lastSession.tasks_worked.join(', ')}`);
    }
    if (lastSession.tasks_completed?.length) {
      handoffItems.push(`Tasks completed: ${lastSession.tasks_completed.join(', ')}`);
    }
    if (lastSession.branch) {
      handoffItems.push(`Branch: ${lastSession.branch}`);
    }
    if (lastSession.commits?.length) {
      handoffItems.push(`Commits: ${lastSession.commits.length}`);
    }
    if (handoffItems.length > 0) {
      sections.push({
        heading: `Last Session (${lastSession.display_id} ${lastSession.started_at.slice(0, 10)})`,
        items: handoffItems,
      });
    }

    // Older sessions as one-liners
    const olderSessions = recentSessions.slice(1);
    if (olderSessions.length > 0) {
      sections.push({
        heading: 'Earlier Sessions',
        items: olderSessions.map((s) => {
          const summary = s.summary ? ` — ${s.summary}` : '';
          const tasks = s.tasks_completed?.length
            ? ` (completed: ${s.tasks_completed.join(', ')})`
            : '';
          return `${s.display_id} ${s.started_at.slice(0, 10)}${summary}${tasks}`;
        }),
      });
    }
  }

  // 5. Progress summary
  const doneCount = allTasks.filter((t) => t.status === 'done').length;
  const totalCount = allTasks.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  sections.push({
    heading: 'Progress',
    items: [`${doneCount}/${totalCount} tasks done (${pct}%)`],
  });

  return { project, sections, suggestedFocus };
}

export function renderBriefingXml(briefing: SessionBriefing): string {
  const lines: string[] = [];

  lines.push(
    'This project uses brain PM for project tracking. Use `brain pm status`, `brain pm next`, `brain session list`, and `brain dashboard` instead of git log for project context.'
  );
  lines.push('');
  lines.push(`<session-briefing project="${briefing.project ?? 'none'}">`);

  for (const section of briefing.sections) {
    lines.push(`  <${toTag(section.heading)}>`);
    for (const item of section.items) {
      lines.push(`    <item>${item}</item>`);
    }
    lines.push(`  </${toTag(section.heading)}>`);
  }

  if (briefing.suggestedFocus.length > 0) {
    lines.push('  <suggested_focus>');
    for (const focus of briefing.suggestedFocus) {
      lines.push(`    <item>${focus}</item>`);
    }
    lines.push('  </suggested_focus>');
  }

  lines.push('</session-briefing>');
  return lines.join('\n');
}

export function renderBriefingMarkdown(briefing: SessionBriefing): string {
  const lines: string[] = [];
  lines.push(`# Session Briefing — ${briefing.project ?? 'No Project'}`);
  lines.push('');

  for (const section of briefing.sections) {
    lines.push(`## ${section.heading}`);
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (briefing.suggestedFocus.length > 0) {
    lines.push('## Suggested Focus');
    for (const focus of briefing.suggestedFocus) {
      lines.push(`- ${focus}`);
    }
  }

  return lines.join('\n');
}

function toTag(heading: string): string {
  return heading.toLowerCase().replace(/\s+/g, '_');
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString();
}
