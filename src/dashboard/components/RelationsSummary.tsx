import React from 'react';
import { Text } from 'react-native';
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
import { C } from './shared/colors.js';

interface RelationsSummaryProps {
  relations?: {
    total: number;
    byType: Record<string, number>;
  };
}

export function RelationsSummary({ relations }: RelationsSummaryProps) {
  const entries = Object.entries(relations?.byType ?? {}).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <Card variant="elevated" elevation={2}>
      <CardHeader>
        <CardTitle>Relations</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        {entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow isHoverable={false}>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell align="right">Count</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([type, count]) => (
                <TableRow key={type}>
                  <TableCell>{type}</TableCell>
                  <TableCell align="right">
                    {count.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text style={{ fontSize: 14, color: C.textTertiary }}>No relations</Text>
        )}
      </CardContent>
    </Card>
  );
}
