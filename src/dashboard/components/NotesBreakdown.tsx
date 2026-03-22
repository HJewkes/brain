import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@titan-design/react-ui';
import { C, palette } from './shared/colors.js';

const DATA_COLORS = palette.dataColors;

interface NotesBreakdownProps {
  title: string;
  data: Record<string, number>;
}

export function NotesBreakdown({ title, data }: NotesBreakdownProps) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <Card variant="elevated" elevation={2}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        {/* Horizontal bars */}
        {entries.length > 0 ? (
          <View style={s.bars}>
            {entries.map(([key, val], i) => {
              const pct = total > 0 ? (val / entries[0][1]) * 100 : 0;
              return (
                <View key={key} style={s.barRow}>
                  <Text style={s.barLabel}>{key}</Text>
                  <View style={s.barTrack}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: DATA_COLORS[i % DATA_COLORS.length], borderRadius: 3 } as React.CSSProperties} />
                  </View>
                  <Text style={s.barValue}>{val.toLocaleString()}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={{ fontSize: 14, color: C.textTertiary }}>None</Text>
        )}
      </CardContent>
    </Card>
  );
}

const s = StyleSheet.create({
  bars: { gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { fontSize: 12, color: C.textSecondary, width: 90, textAlign: 'right' as const },
  barTrack: { flex: 1, height: 8, backgroundColor: C.surface2, borderRadius: 4, overflow: 'hidden' },
  barValue: { fontSize: 12, color: C.textTertiary, width: 50, fontFamily: 'monospace' },
});
