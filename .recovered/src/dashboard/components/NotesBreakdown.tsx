import React from 'react';
import { View, Text } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@titan-design/react-ui';

const DATA_COLORS = [
  'var(--color-data-1)',
  'var(--color-data-2)',
  'var(--color-data-3)',
  'var(--color-data-4)',
  'var(--color-data-5)',
  'var(--color-data-6)',
  'var(--color-data-7)',
  'var(--color-data-8)',
  'var(--color-data-9)',
  'var(--color-data-10)',
];

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
      <CardContent className="pt-0">
        {/* Stacked bar */}
        {total > 0 && (
          <View className="mb-3">
            <View className="flex-row h-6 rounded-md overflow-hidden bg-surface-elevated">
              {entries.map(([key, val], i) => {
                const pct = (val / total) * 100;
                return (
                  <View
                    key={key}
                    style={{
                      width: `${pct}%`,
                      backgroundColor: DATA_COLORS[i % DATA_COLORS.length],
                      minWidth: 2,
                    }}
                  />
                );
              })}
            </View>
            <View className="flex-row flex-wrap gap-3 mt-2">
              {entries.map(([key, val], i) => (
                <View key={key} className="flex-row items-center gap-1">
                  <View
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{
                      backgroundColor: DATA_COLORS[i % DATA_COLORS.length],
                    }}
                  />
                  <Text className="text-xs text-text-secondary">
                    {key}: {val.toLocaleString()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Table */}
        {entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow isHoverable={false}>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell align="right">Count</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([key, val]) => (
                <TableRow key={key}>
                  <TableCell>{key}</TableCell>
                  <TableCell align="right">{val.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text className="text-sm text-text-tertiary">None</Text>
        )}
      </CardContent>
    </Card>
  );
}
