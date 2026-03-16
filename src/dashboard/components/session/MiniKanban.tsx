import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import type { TaskEvent } from '../../types.js';

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

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

const HEADER_STYLES = {
  added: {
    bg: { backgroundColor: 'rgba(212,165,32,0.12)' },
    text: { color: '#D4A520' },
  },
  active: {
    bg: { backgroundColor: 'rgba(255,121,0,0.12)' },
    text: { color: C.brand },
  },
  done: {
    bg: { backgroundColor: 'rgba(20,184,166,0.10)' },
    text: { color: C.success },
  },
} as const;

const PILL_STYLES = {
  added: {
    backgroundColor: 'rgba(212,165,32,0.15)',
    color: '#D4A520',
    borderLeftWidth: 2,
    borderLeftColor: '#D4A520',
  },
  active: {
    backgroundColor: 'rgba(255,121,0,0.15)',
    color: C.brand,
    borderLeftWidth: 2,
    borderLeftColor: C.brand,
  },
  done: {
    backgroundColor: 'rgba(20,184,166,0.12)',
    color: C.success,
    borderLeftWidth: 2,
    borderLeftColor: C.success,
  },
} as const;

const styles = StyleSheet.create({
  container: {},
  label: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    fontWeight: '700',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 6,
  },
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
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  colHeadText: {
    fontFamily: 'Space Grotesk',
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  colCount: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.85,
  },
  colBody: {
    padding: 5,
    gap: 3,
  },
  pill: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    fontWeight: '600',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    lineHeight: 14,
  },
  morePill: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    fontStyle: 'italic',
    color: C.textTertiary,
    opacity: 0.6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
});
