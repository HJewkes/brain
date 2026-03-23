import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './shared/Card.js';
import { C } from './shared/colors.js';

function CardHeader({ children }: { children: React.ReactNode }) {
  return <View style={s.cardHeader}>{children}</View>;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

function CardContent({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.cardContent, style]}>{children}</View>;
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
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' },
  tableHeader: { backgroundColor: C.surface2, borderBottomWidth: 1, borderBottomColor: C.border },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.surface3 },
  tableCell: { flex: 1, paddingHorizontal: 12, paddingVertical: 8 },
  tableHeaderText: { fontSize: 11, fontWeight: '600', color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableCellText: { fontSize: 13, color: C.textPrimary },
});

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
    <Card>
      <CardHeader>
        <CardTitle>Relations</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0 }}>
        {entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Count</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([type, count]) => (
                <TableRow key={type}>
                  <TableCell>{type}</TableCell>
                  <TableCell>
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
