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

interface SessionActivityProps {
  sessions?: {
    eventCount?: number;
    frictionCount?: number;
    prsCreated?: number;
  };
  auditSessions?: {
    total: number;
    events: number;
    chunks: number;
  };
}

function fmtN(n: number | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

export function SessionActivity({
  sessions = {},
  auditSessions,
}: SessionActivityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Activity</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        <DataRow
          label="Total sessions"
          value={fmtN(auditSessions?.total)}
        />
        <DataRow
          label="Events tracked"
          value={fmtN(sessions.eventCount ?? auditSessions?.events)}
        />
        <DataRow
          label="Friction events"
          value={fmtN(sessions.frictionCount)}
        />
        <DataRow
          label="PRs created"
          value={fmtN(sessions.prsCreated)}
        />
      </CardContent>
    </Card>
  );
}
