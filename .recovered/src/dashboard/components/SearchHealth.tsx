import React from 'react';
import { View, Text } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@titan-design/react-ui';

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
    <View className="flex-row items-center justify-between py-2 border-b border-divider">
      <View className="flex-row items-center gap-2">
        <Text
          className={ok ? 'text-status-success' : 'text-status-error'}
          style={{ fontSize: 14 }}
        >
          {ok ? '\u2713' : '\u2717'}
        </Text>
        <Text className="text-sm text-text-secondary">{label}</Text>
      </View>
      <Text className="text-sm font-medium text-text-primary">
        {fmtN(count)}
      </Text>
    </View>
  );
}

export function SearchHealth({ search }: SearchHealthProps) {
  return (
    <Card variant="elevated" elevation={2}>
      <CardHeader>
        <CardTitle>Search Health</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
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
