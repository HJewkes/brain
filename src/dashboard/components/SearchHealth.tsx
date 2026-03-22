import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@titan-design/react-ui';
import { C } from './shared/colors.js';

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
    <Card variant="elevated" elevation={2}>
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
