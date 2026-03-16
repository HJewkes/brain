import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import { widgetLabel } from './shared-styles.js';

interface Props {
  startedAt: string;
}

export function TimeIndicator({ startedAt }: Props) {
  const currentTs = useCurrentTimestamp();

  const { wallClock, elapsed } = useMemo(() => {
    const d = new Date(currentTs || startedAt);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getTime() - new Date(startedAt).getTime();
    const mins = Math.floor(ms / 60_000);
    return {
      wallClock: `${h}:${m}:${s}`,
      elapsed: mins < 60 ? `${mins}m into session` : `${Math.floor(mins / 60)}h ${mins % 60}m into session`,
    };
  }, [currentTs, startedAt]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>VIEWING</Text>
      <Text style={styles.time}>{wallClock}</Text>
      <Text style={styles.offset}>{elapsed}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: widgetLabel,
  time: {
    fontFamily: 'Space Grotesk',
    fontSize: 22,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.4,
    lineHeight: 22,
    marginBottom: 2,
  },
  offset: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    color: C.textTertiary,
  },
});
