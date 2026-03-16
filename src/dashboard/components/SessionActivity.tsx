import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataRow,
} from '@titan-design/react-ui';

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
    <Card variant="elevated" elevation={2}>
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
