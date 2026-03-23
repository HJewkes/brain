import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './shared/Card.js';
import { C, palette } from './shared/colors.js';
import type { AuditReport } from '../types.js';

function CardContent({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.cardContent, style]}>{children}</View>;
}

function Metric({ label, value, delta }: { label: string; value: string | number; delta?: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
      {delta && <Text style={s.metricDelta}>{delta}</Text>}
    </View>
  );
}

function MetricGroup({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.metricGroup, style]}>{children}</View>;
}

const s = StyleSheet.create({
  cardContent: { padding: 16 },
  metric: { alignItems: 'center', gap: 4 },
  metricLabel: { fontSize: 11, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue: { fontSize: 28, fontWeight: '700', color: C.textPrimary },
  metricDelta: { fontSize: 11, color: palette.teal.base, fontWeight: '600' },
  metricGroup: { flexDirection: 'row', justifyContent: 'space-around', gap: 16 },
});

interface MetricsRowProps {
  audit: AuditReport;
}

function fmtN(n: number | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

export function MetricsRow({ audit }: MetricsRowProps) {
  const memActive = audit.memories?.active ?? 0;
  const memTotal = audit.memories?.total ?? 0;
  const taskTotal = audit.tasks?.total ?? 0;

  return (
    <Card>
      <CardContent>
        <MetricGroup>
          <Metric
            value={fmtN(audit.notes?.total)}
            label="Total Notes"
          />
          <Metric
            value={fmtN(memActive)}
            label={`${memActive} active / ${memTotal} total memories`}
          />
          <Metric
            value={fmtN(taskTotal)}
            label={`${fmtN(audit.tasks?.byStatus?.done ?? 0)} done`}
          />
          <Metric
            value={fmtN(audit.notes?.staleCount ?? 0)}
            label="Stale notes"
          />
        </MetricGroup>
      </CardContent>
    </Card>
  );
}
