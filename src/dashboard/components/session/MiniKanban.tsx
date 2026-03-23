import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, component } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import type { TaskEvent } from '../../types.js';
import { widgetLabel, formatTimeShort } from './shared-styles.js';

interface Props {
  taskEvents: TaskEvent[];
  taskRefs: string[];
  startedAt: string;
}

interface TaskEntry {
  id: string;
  timestamp: string;
}

const MAX_PILLS = 5;

export function MiniKanban({ taskEvents, taskRefs, startedAt }: Props) {
  const currentTs = useCurrentTimestamp();

  const { added, active, done } = useMemo(
    () => computeKanbanState(taskEvents, taskRefs, currentTs || startedAt, startedAt),
    [taskEvents, taskRefs, currentTs, startedAt],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        TASKS AT {formatTimeShort(currentTs || startedAt)}
      </Text>
      <View style={styles.cols}>
        <KanbanColumn entries={added} label="Added" variant="added" />
        <KanbanColumn entries={active} label="Active" variant="active" />
        <KanbanColumn entries={done} label="Done" variant="done" />
      </View>
    </View>
  );
}

interface ColProps {
  entries: TaskEntry[];
  label: string;
  variant: 'added' | 'active' | 'done';
}

function KanbanColumn({ entries, label, variant }: ColProps) {
  const shown = entries.slice(0, MAX_PILLS);
  const overflow = entries.length - MAX_PILLS;
  const headerStyle = HEADER_STYLES[variant];
  const pillStyle = PILL_STYLES[variant];

  return (
    <View style={styles.col}>
      <View style={[styles.colHead, headerStyle.bg]}>
        <Text style={[styles.colHeadText, headerStyle.text]}>{label}</Text>
        <Text style={[styles.colCount, headerStyle.text]}>{entries.length}</Text>
      </View>
      <View style={styles.colBody}>
        {shown.map(e => (
          <Text key={e.id} style={[styles.pill, pillStyle]} numberOfLines={1}>
            {e.id}
          </Text>
        ))}
        {overflow > 0 && (
          <Text style={styles.morePill}>+{overflow} more</Text>
        )}
      </View>
    </View>
  );
}

function computeKanbanState(
  events: TaskEvent[],
  refs: string[],
  currentTs: string,
  startedAt: string,
): { added: TaskEntry[]; active: TaskEntry[]; done: TaskEntry[] } {
  const tsMs = new Date(currentTs).getTime();
  const state: Record<string, { state: string; timestamp: string }> = {};

  for (const ev of events) {
    if (new Date(ev.timestamp).getTime() > tsMs) continue;
    const next = ev.action === 'completed' ? 'done'
      : ev.action === 'started' ? 'active'
        : 'added';
    const prev = state[ev.taskId]?.state;
    const rank = (s: string) => (s === 'done' ? 2 : s === 'active' ? 1 : 0);
    if (!prev || rank(next) >= rank(prev)) {
      state[ev.taskId] = { state: next, timestamp: ev.timestamp };
    }
  }

  const allIds = new Set([...refs, ...events.map(e => e.taskId)]);
  const added: TaskEntry[] = [];
  const active: TaskEntry[] = [];
  const done: TaskEntry[] = [];

  for (const id of allIds) {
    const info = state[id];
    const entry = { id, timestamp: info?.timestamp ?? startedAt };
    if (!info || info.state === 'added') added.push(entry);
    else if (info.state === 'active') active.push(entry);
    else done.push(entry);
  }

  const newest = (a: TaskEntry, b: TaskEntry) => b.timestamp.localeCompare(a.timestamp);
  added.sort(newest);
  active.sort(newest);
  done.sort(newest);

  return { added, active, done };
}

const HEADER_STYLES = {
  added: {
    bg: { backgroundColor: component.kanbanHead.ready.bg },
    text: { color: component.kanbanHead.ready.fg },
  },
  active: {
    bg: { backgroundColor: component.kanbanHead.active.bg },
    text: { color: component.kanbanHead.active.fg },
  },
  done: {
    bg: { backgroundColor: component.kanbanHead.done.bg },
    text: { color: component.kanbanHead.done.fg },
  },
} as const;

const PILL_STYLES = {
  added: {
    backgroundColor: component.taskPill.ready.bg,
    color: component.taskPill.ready.fg,
    borderLeftWidth: 2,
    borderLeftColor: component.taskPill.ready.border,
  },
  active: {
    backgroundColor: component.taskPill.active.bg,
    color: component.taskPill.active.fg,
    borderLeftWidth: 2,
    borderLeftColor: component.taskPill.active.border,
  },
  done: {
    backgroundColor: component.taskPill.done.bg,
    color: component.taskPill.done.fg,
    borderLeftWidth: 2,
    borderLeftColor: component.taskPill.done.border,
  },
} as const;

const styles = StyleSheet.create({
  container: {},
  label: widgetLabel,
  cols: {
    flexDirection: 'row',
    gap: 4,
  },
  col: {
    flex: 1,
    minWidth: 0,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  colHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    paddingTop: 3,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  colHeadText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.32,
    lineHeight: 8,
  },
  colCount: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.85,
  },
  colBody: {
    padding: 5,
    gap: 3,
  },
  pill: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    fontWeight: '600',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    lineHeight: 13.5,
  },
  morePill: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    fontStyle: 'italic',
    color: C.textTertiary,
    opacity: 0.6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
});
