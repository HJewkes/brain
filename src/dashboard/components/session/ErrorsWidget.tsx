import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import { bisect } from './bisect.js';
import { sectionH3 } from './shared-styles.js';

interface Props {
  errorTimestamps: number[];
  startedAt: string;
}

const ERROR_COLOR = '#DC050C';

export function ErrorsWidget({ errorTimestamps, startedAt }: Props) {
  const currentTs = useCurrentTimestamp();

  const { current, total, pct } = useMemo(() => {
    const tsMs = new Date(currentTs || startedAt).getTime();
    const c = bisect(errorTimestamps, tsMs);
    const t = errorTimestamps.length;
    return { current: c, total: t, pct: t ? (c / t) * 100 : 0 };
  }, [currentTs, errorTimestamps, startedAt]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>ERRORS</Text>
      <View style={styles.row}>
        <View style={styles.track}>
          <View style={styles.bg} />
          <View style={[styles.fill, { width: `${pct}%` as unknown as number }]} />
        </View>
        <Text style={styles.count}>{current}/{total}</Text>
      </View>
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
    backgroundColor: ERROR_COLOR,
    opacity: 0.15,
    borderRadius: 3,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: ERROR_COLOR,
    borderRadius: 3,
  },
  count: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    color: '#F87171',
    width: 42,
    textAlign: 'right',
    flexShrink: 0,
  },
});
