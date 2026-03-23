import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './shared/Card.js';
import { C } from './shared/colors.js';

function CardHeader({ children }: { children: React.ReactNode }) {
  return <View style={s.cardHeader}>{children}</View>;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

function CardContent({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.cardContent, style]}>{children}</View>;
}

interface SearchHealthProps {
  search?: {
    ftsEntries: number;
    trigramEntries: number;
    vectorRows: number;
  };
}

function fmtN(n: number | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

function HealthRow({ label, count }: { label: string; count: number }) {
  const ok = count > 0;
  return (
    <View style={s.row}>
      <View style={s.rowLeft}>
        <Text style={[s.indicator, { color: ok ? C.success : C.error }]}>
          {ok ? '\u2713' : '\u2717'}
        </Text>
        <Text style={s.label}>{label}</Text>
      </View>
      <Text style={s.count}>{fmtN(count)}</Text>
    </View>
  );
}

export function SearchHealth({ search }: SearchHealthProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Health</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        <HealthRow label="FTS entries" count={search?.ftsEntries ?? 0} />
        <HealthRow
          label="Trigram entries"
          count={search?.trigramEntries ?? 0}
        />
        <HealthRow label="Vector rows" count={search?.vectorRows ?? 0} />
      </CardContent>
    </Card>
  );
}

const s = StyleSheet.create({
  cardHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardContent: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.surface3,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  indicator: { fontSize: 14 },
  label: { fontSize: 14, color: C.textSecondary },
  count: { fontSize: 14, fontWeight: '500', color: C.textPrimary },
});
