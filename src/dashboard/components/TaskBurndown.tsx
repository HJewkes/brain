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

function Progress({ value, max = 100, color = C.brand }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${pct}%` as unknown as number, backgroundColor: color }]} />
    </View>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return <View style={s.table}>{children}</View>;
}

function TableHeader({ children }: { children: React.ReactNode }) {
  return <View style={s.tableHeader}>{children}</View>;
}

function TableBody({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
}

function TableRow({ children }: { children: React.ReactNode }) {
  return <View style={s.tableRow}>{children}</View>;
}

function TableHeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.tableCell}>
      <Text style={s.tableHeaderText}>{children}</Text>
    </View>
  );
}

function TableCell({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.tableCell}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text style={s.tableCellText}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

const s = StyleSheet.create({
  cardHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardContent: { padding: 16 },
  progressTrack: { height: 6, backgroundColor: palette.surface3, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%' as unknown as number, borderRadius: 3 },
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' },
  tableHeader: { backgroundColor: C.surface2, borderBottomWidth: 1, borderBottomColor: C.border },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.surface3 },
  tableCell: { flex: 1, paddingHorizontal: 12, paddingVertical: 8 },
  tableHeaderText: { fontSize: 11, fontWeight: '600', color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableCellText: { fontSize: 13, color: C.textPrimary },
});

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
    <Card>
      <CardHeader>
        <CardTitle>Task Burndown</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        <Progress value={pct} />

        {entries.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Count</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(([status, count]) => (
                  <TableRow key={status}>
                    <TableCell>{status}</TableCell>
                    <TableCell>
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
