import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import { bisect } from './bisect.js';
import type { ToolCategory } from './precompute.js';
import { sectionH3 } from './shared-styles.js';

interface Props {
  toolTimestamps: Record<ToolCategory, number[]>;
  toolTotals: Record<ToolCategory, number>;
  startedAt: string;
}

const TOOL_COLORS: Record<ToolCategory, string> = {
  Read: '#1965B0',
  Write: '#14B8A6',
  Bash: '#F4A736',
  Agent: '#FF7900',
};

const CATEGORIES: ToolCategory[] = ['Read', 'Write', 'Bash', 'Agent'];

export function ToolBreakdownWidget({ toolTimestamps, toolTotals, startedAt }: Props) {
  const currentTs = useCurrentTimestamp();

  const counts = useMemo(() => {
    const tsMs = new Date(currentTs || startedAt).getTime();
    return Object.fromEntries(
      CATEGORIES.map(cat => [cat, bisect(toolTimestamps[cat], tsMs)]),
    ) as Record<ToolCategory, number>;
  }, [currentTs, toolTimestamps, startedAt]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>TOOL BREAKDOWN</Text>
      {CATEGORIES.map(cat => {
        const total = toolTotals[cat];
        const current = counts[cat];
        const pct = total ? (current / total) * 100 : 0;
        const color = TOOL_COLORS[cat];
        return (
          <View key={cat} style={styles.row}>
            <Text style={styles.rowLabel}>{cat}</Text>
            <View style={styles.track}>
              <View style={[styles.bg, { backgroundColor: color }]} />
              <View style={[styles.fill, { width: `${pct}%` as unknown as number, backgroundColor: color }]} />
            </View>
            <Text style={styles.count}>{current}/{total}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: sectionH3,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  rowLabel: {
    fontFamily: 'Space Grotesk',
    fontSize: 11,
    fontWeight: '500',
    color: C.textSecondary,
    width: 38,
    flexShrink: 0,
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  bg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.15,
    borderRadius: 3,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 3,
  },
  count: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    color: C.textTertiary,
    width: 42,
    textAlign: 'right',
    flexShrink: 0,
  },
});
