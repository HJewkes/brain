import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './colors.js';
import { sp } from '../../tokens.js';

export interface HorizBarRow {
  label: string;
  /** Value used to compute bar width (0–maxValue). */
  value: number;
  /** Text displayed at the right end. */
  display: string;
  /** Optional annotation shown after the display value. */
  annotation?: string;
  /** Highlight the bar in the warning color. */
  warn?: boolean;
  /** Override the fill color. */
  color?: string;
}

export interface HorizBarListProps {
  rows: HorizBarRow[];
  maxValue?: number;
  labelWidth?: number;
  barHeight?: number;
  emptyText?: string;
}

export function HorizBarList({
  rows,
  maxValue,
  labelWidth = 84,
  barHeight = 10,
  emptyText = 'No data',
}: HorizBarListProps) {
  if (rows.length === 0 || rows.every(r => r.value === 0)) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }

  const max = maxValue ?? Math.max(...rows.map(r => r.value), 1);

  return (
    <View style={styles.wrap}>
      {rows.map((row, i) => {
        const pct = (row.value / max) * 100;
        const fillColor = row.warn ? C.warning : (row.color ?? C.brand);
        return (
          <View key={`${row.label}-${i}`} style={styles.row}>
            <Text style={[styles.label, { width: labelWidth }]} numberOfLines={1}>
              {row.label}
            </Text>
            <View style={[styles.barBg, { height: barHeight, borderRadius: barHeight / 2 }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${pct}%` as unknown as number,
                    height: barHeight,
                    borderRadius: barHeight / 2,
                    backgroundColor: fillColor,
                  },
                ]}
              />
            </View>
            <Text style={[styles.display, row.warn && styles.warnText]}>{row.display}</Text>
            {row.annotation != null && row.annotation !== '' ? (
              <Text style={styles.annotation}>{row.annotation}</Text>
            ) : (
              <View style={styles.annotationSpacer} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 14, color: C.textTertiary },
  wrap: { gap: sp[5] },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp[5] },
  label: { fontSize: 12, color: C.textSecondary },
  barBg: {
    flex: 1,
    backgroundColor: C.surface3,
    overflow: 'hidden',
  },
  barFill: { height: '100%' as unknown as number },
  display: { fontSize: 12, color: C.textPrimary, fontWeight: '600', minWidth: 52, textAlign: 'right' },
  warnText: { color: C.error },
  annotation: { fontSize: 11, color: C.error, minWidth: 36, textAlign: 'right' },
  annotationSpacer: { minWidth: 36 },
});
