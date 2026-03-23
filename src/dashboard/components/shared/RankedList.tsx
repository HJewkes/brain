import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, component } from './colors.js';

export interface RankedListItem {
  label: string;
  value: number;
  sublabel?: string;
  color?: string;
  badge?: string;
  badgeHighlight?: boolean;
}

export interface RankedListProps {
  items: RankedListItem[];
  maxValue?: number;
  emptyText?: string;
  /** Show a proportional bar behind each row */
  showBars?: boolean;
}

export function RankedList({
  items,
  maxValue,
  emptyText = 'No items',
  showBars = false,
}: RankedListProps) {
  if (items.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  const max = maxValue ?? Math.max(...items.map(i => i.value), 1);

  return (
    <View>
      {items.map((item, idx) => (
        <View key={`${item.label}-${idx}`} style={styles.row}>
          <Text style={[styles.value, item.color != null ? { color: item.color } : null]}>
            {item.value}x
          </Text>
          <View style={styles.labelWrap}>
            <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
            {item.sublabel != null && (
              <Text style={styles.sublabel}>{item.sublabel}</Text>
            )}
            {showBars && (
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    item.color != null ? { backgroundColor: item.color } : null,
                    { width: `${Math.round((item.value / max) * 100)}%` as any },
                  ]}
                />
              </View>
            )}
          </View>
          {item.badge != null && (
            <View style={[styles.badge, item.badgeHighlight && styles.badgeHighlight]}>
              <Text style={[styles.badgeText, item.badgeHighlight && styles.badgeTextHighlight]}>
                {item.badge}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: 14, color: C.textTertiary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  value: {
    fontSize: 14,
    fontWeight: '700',
    color: C.error,
    minWidth: 32,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  labelWrap: { flex: 1 },
  label: { fontSize: 13, color: C.textPrimary },
  sublabel: { fontSize: 10, color: C.textTertiary },
  barTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', backgroundColor: C.brand, borderRadius: 2 },
  badge: {
    backgroundColor: C.surface3,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeHighlight: { backgroundColor: component.statCard.negativeDeltaBg },
  badgeText: { fontSize: 11, color: C.textSecondary },
  badgeTextHighlight: { color: C.error, fontWeight: '600' },
});
