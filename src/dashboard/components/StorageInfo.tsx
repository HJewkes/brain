import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './shared/Card.js';
import { C, palette } from './shared/colors.js';

function CardHeader({ children }: { children: React.ReactNode }) {
  return <View style={s.cardHeader}>{children}</View>;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

function CardContent({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.cardContent, style]}>{children}</View>;
}

function DataRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={s.dataRow}>
      <Text style={s.dataRowLabel}>{label}</Text>
      <Text style={s.dataRowValue}>{String(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  cardHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardContent: { padding: 16 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.surface3 },
  dataRowLabel: { fontSize: 13, color: C.textSecondary },
  dataRowValue: { fontSize: 13, color: C.textPrimary, fontWeight: '500' },
});

interface StorageInfoProps {
  database?: { sizeBytes: number };
  chunks?: { total: number; embedded: number };
  inbox?: { total: number; pending: number; feeds: number };
}

function fmtN(n: number | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function StorageInfo({
  database,
  chunks,
  inbox,
}: StorageInfoProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        <DataRow
          label="DB size"
          value={formatBytes(database?.sizeBytes ?? 0)}
        />
        <DataRow
          label="Chunks"
          value={`${fmtN(chunks?.total)} (${fmtN(chunks?.embedded)} embedded)`}
        />
        <DataRow
          label="Inbox"
          value={`${fmtN(inbox?.pending)} pending / ${fmtN(inbox?.total)} total`}
        />
        <DataRow label="Feeds" value={fmtN(inbox?.feeds)} />
      </CardContent>
    </Card>
  );
}
