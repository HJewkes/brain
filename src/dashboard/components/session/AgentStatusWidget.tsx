import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, component } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import { bisect } from './bisect.js';
import type { AgentEntry } from './precompute.js';
import { widgetLabel, formatTimeShort } from './shared-styles.js';

interface Props {
  agentTimeline: AgentEntry[];
  allToolTs: number[];
  startedAt: string;
}

type Status = 'live' | 'idle' | 'done';

const ACTIVE_WINDOW = 30_000;
const MAX_ENTRIES = 6;

export function AgentStatusWidget({ agentTimeline, allToolTs, startedAt }: Props) {
  const currentTs = useCurrentTimestamp();

  const entries = useMemo(() => {
    const tsMs = new Date(currentTs || startedAt).getTime();
    return computeAgentStatus(agentTimeline, allToolTs, tsMs);
  }, [currentTs, agentTimeline, allToolTs, startedAt]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        AGENTS AT {formatTimeShort(currentTs || startedAt)}
      </Text>
      {entries.length === 0 && (
        <Text style={styles.empty}>No agents</Text>
      )}
      {entries.map(e => (
        <View key={e.agentId} style={styles.row}>
          <View style={[styles.dot, DOT_STYLES[e.status]]} />
          <Text
            style={[styles.name, NAME_STYLES[e.status]]}
            numberOfLines={1}
          >
            {e.label}
          </Text>
          <Text style={styles.dur}>{e.durText}</Text>
        </View>
      ))}
    </View>
  );
}

interface DisplayEntry {
  agentId: string;
  label: string;
  status: Status;
  durText: string;
}

function computeAgentStatus(
  timeline: AgentEntry[],
  allToolTs: number[],
  tsMs: number,
): DisplayEntry[] {
  const visible = timeline.filter(a => a.spawnTs <= tsMs);
  const entries: DisplayEntry[] = visible.map(a => {
    if (a.isMain) {
      const status = isMainActive(allToolTs, tsMs) ? 'live' : 'idle';
      return { agentId: a.agentId, label: a.label, status, durText: status };
    }
    const done = tsMs >= a.completeTs;
    if (done) {
      const ago = Math.round((tsMs - a.completeTs) / 60_000);
      return {
        agentId: a.agentId,
        label: a.label,
        status: 'done' as Status,
        durText: `done ${ago}m ago`,
      };
    }
    const active = Math.round((tsMs - a.spawnTs) / 60_000);
    return {
      agentId: a.agentId,
      label: a.label,
      status: 'live' as Status,
      durText: `${active}m active`,
    };
  });

  entries.sort((a, b) => {
    const rank = (s: Status) => (s === 'live' ? 0 : s === 'idle' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  return entries.slice(0, MAX_ENTRIES);
}

function isMainActive(allToolTs: number[], tsMs: number): boolean {
  const idx = bisect(allToolTs, tsMs);
  const nearPrev = idx > 0 && (tsMs - allToolTs[idx - 1]) <= ACTIVE_WINDOW;
  const nearNext = idx < allToolTs.length && (allToolTs[idx] - tsMs) <= ACTIVE_WINDOW;
  return nearPrev || nearNext;
}

const DOT_STYLES: Record<Status, object> = {
  live: { backgroundColor: component.agentDot.live.bg, shadowColor: component.agentDot.live.glow },
  idle: { backgroundColor: component.agentDot.idle.bg, shadowColor: component.agentDot.idle.glow },
  done: { backgroundColor: C.textTertiary },
};

const NAME_STYLES: Record<Status, object> = {
  live: { color: C.textPrimary },
  idle: { color: C.warning },
  done: { color: C.textTertiary },
};

const styles = StyleSheet.create({
  container: {},
  label: widgetLabel,
  empty: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 10,
    fontStyle: 'italic',
    color: C.textTertiary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  name: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },
  dur: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textTertiary,
  },
});
