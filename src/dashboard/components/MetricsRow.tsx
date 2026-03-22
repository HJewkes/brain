import React from 'react';
import { View } from 'react-native';
import { Card, CardContent, Metric, MetricGroup } from '@titan-design/react-ui';
import type { AuditReport } from '../types';

interface MetricsRowProps {
  audit: AuditReport;
}

function fmtN(n: number | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

function tierSummary(byTier: Record<string, number>): string {
  return Object.entries(byTier)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');
}

export function MetricsRow({ audit }: MetricsRowProps) {
  const memActive = audit.memories?.active ?? 0;
  const memTotal = audit.memories?.total ?? 0;
  const taskTotal = audit.tasks?.total ?? 0;
  const taskDone = Object.values(audit.tasks?.byStatus ?? {}).reduce((s, v) => s + v, 0) - taskTotal;

  return (
    <Card variant="elevated" elevation={1}>
      <CardContent>
        <MetricGroup>
          <Metric
            value={fmtN(audit.notes?.total)}
            label="Total Notes"
            size="lg"
          />
          <Metric
            value={fmtN(memActive)}
            label={`${memActive} active / ${memTotal} total memories`}
            size="lg"
          />
          <Metric
            value={fmtN(taskTotal)}
            label={`${fmtN(audit.tasks?.byStatus?.done ?? 0)} done`}
            size="lg"
          />
          <Metric
            value={fmtN(audit.notes?.staleCount ?? 0)}
            label="Stale notes"
            size="lg"
          />
        </MetricGroup>
      </CardContent>
    </Card>
  );
}
