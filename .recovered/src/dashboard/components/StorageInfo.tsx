import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataRow,
} from '@titan-design/react-ui';

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
    <Card variant="elevated" elevation={2}>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
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
