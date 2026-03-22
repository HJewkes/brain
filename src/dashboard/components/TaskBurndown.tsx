import React from 'react';
import { View, Text } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Progress,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@titan-design/react-ui';
import { C } from './shared/colors.js';

interface TaskBurndownProps {
  pm?: {
    projects: number;
    tasks: number;
    tasksByStatus: Record<string, number>;
  };
}

export function TaskBurndown({ pm }: TaskBurndownProps) {
  const total = pm?.tasks ?? 0;
  const byStatus = pm?.tasksByStatus ?? {};
  const done =
    (byStatus.done ?? 0) +
    (byStatus.completed ?? 0) +
    (byStatus.verified ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const entries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);

  return (
    <Card variant="elevated" elevation={2}>
      <CardHeader>
        <CardTitle>Task Burndown</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        <Progress
          value={pct}
          label={`${done} / ${total} tasks`}
          showValue
          color="primary"
          size="lg"
        />

        {entries.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            <Table>
              <TableHeader>
                <TableRow isHoverable={false}>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Count</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(([status, count]) => (
                  <TableRow key={status}>
                    <TableCell>{status}</TableCell>
                    <TableCell align="right">
                      {count.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </View>
        ) : (
          <Text style={{ fontSize: 14, color: C.textTertiary, marginTop: 12 }}>
            No task data
          </Text>
        )}
      </CardContent>
    </Card>
  );
}
