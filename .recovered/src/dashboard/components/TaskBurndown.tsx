import React from 'react';
import { Text } from 'react-native';
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
      <CardContent className="pt-0">
        <Progress
          value={pct}
          label={`${done} / ${total} tasks`}
          showValue
          color="primary"
          size="lg"
        />

        {entries.length > 0 ? (
          <Table className="mt-3">
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
        ) : (
          <Text className="text-sm text-text-tertiary mt-3">
            No task data
          </Text>
        )}
      </CardContent>
    </Card>
  );
}
