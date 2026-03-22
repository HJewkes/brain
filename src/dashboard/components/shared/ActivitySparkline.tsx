import React from 'react';
import { View, StyleSheet } from 'react-native';
import { C, TOOL_COLORS } from './colors.js';

export interface SparkEvent {
  type: string;
  magnitude?: number;
}

interface Props {
  events: SparkEvent[];
}

export function ActivitySparkline({ events }: Props) {
  if (events.length === 0) return <View style={styles.container} />;

  const maxMag = Math.max(...events.map(e => e.magnitude ?? 1), 1);

  return (
    <View style={styles.container}>
      {events.map((e, i) => {
        const mag = e.magnitude ?? 1;
        const heightPct = 0.3 + (mag / maxMag) * 0.7;
        const color = TOOL_COLORS[e.type] ?? C.textTertiary;
        return (
          <View
            key={i}
            style={[
              styles.bar,
              { height: `${Math.round(heightPct * 100)}%` as unknown as number, backgroundColor: color },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 20,
  },
  bar: {
    flex: 1,
    borderRadius: 2,
    minHeight: 2,
  },
});
