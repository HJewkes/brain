import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@titan-design/react-ui';
import type { AuditReport, DashboardData } from '../types.js';

interface GraphViewProps {
  dashboard: DashboardData | null;
  audit: AuditReport;
}

const BAR_COLORS = [
  '#FF7900', '#1965B0', '#14B8A6', '#882E72',
  '#4EB265', '#F4A736', '#7BAFDE', '#DC050C',
];

function BarChart({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <Text style={s.muted}>No data</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {entries.map(([key, val], i) => (
              <View key={key} style={{ gap: 3 }}>
                <View style={s.barLabel}>
                  <Text style={s.barKey}>{key}</Text>
                  <Text style={s.barVal}>{val.toLocaleString()}</Text>
                </View>
                <View style={s.barTrack}>
                  <View
                    style={{
                      height: '100%',
                      width: `${(val / max) * 100}%`,
                      backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                      borderRadius: 3,
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </CardContent>
    </Card>
  );
}

const VIEW_MODES = ['Force-Directed', 'Clustered', 'Ego-Network'] as const;

export function GraphView({ audit }: GraphViewProps) {
  const noteCount = audit.notes?.total ?? 0;
  const relationCount = audit.relations?.total ?? 0;

  return (
    <View style={{ gap: 16 }}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Knowledge Graph</Text>
        <View style={s.badges}>
          {VIEW_MODES.map((mode) => (
            <Badge key={mode} color="neutral">{mode}</Badge>
          ))}
        </View>
      </View>

      {/* Coming soon */}
      <Card>
        <CardContent>
          <View style={{ gap: 8 }}>
            <Text style={s.sectionTitle}>Graph visualization coming soon</Text>
            <Text style={s.body}>
              Will display {noteCount.toLocaleString()} notes and{' '}
              {relationCount.toLocaleString()} relations as an interactive
              force-directed network.
            </Text>
            <Text style={s.muted}>
              View modes: Force-directed (physics simulation), Clustered (grouped
              by module), Ego-network (explore from a single node)
            </Text>
            <Text style={[s.muted, { fontSize: 11, marginTop: 4 }]}>
              Requires graph data in the dashboard payload — tracked in VNM-15.28
            </Text>
          </View>
        </CardContent>
      </Card>

      {/* Row 1: Notes by Module + Notes by Type */}
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <BarChart title="Notes by Module" data={audit.notes?.byModule ?? {}} />
        </View>
        <View style={{ flex: 1 }}>
          <BarChart title="Notes by Type" data={audit.notes?.byType ?? {}} />
        </View>
      </View>

      {/* Row 2: Relations by Type + Graph Stats */}
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <BarChart title="Relations by Type" data={audit.relations?.byType ?? {}} />
        </View>
        <View style={{ flex: 1 }}>
          <Card>
            <CardHeader>
              <CardTitle>Graph Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <View style={{ gap: 12 }}>
                {[
                  { label: 'Total notes (nodes)', value: noteCount.toLocaleString() },
                  { label: 'Total relations (edges)', value: relationCount.toLocaleString() },
                  { label: 'Stale notes', value: (audit.notes?.staleCount ?? 0).toLocaleString() },
                  { label: 'Active memories', value: (audit.memories?.active ?? 0).toLocaleString() },
                ].map(({ label, value }) => (
                  <View key={label} style={s.statRow}>
                    <Text style={s.body}>{label}</Text>
                    <Text style={s.statValue}>{value}</Text>
                  </View>
                ))}
              </View>
            </CardContent>
          </Card>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F3F4F6',
    fontFamily: 'Space Grotesk, sans-serif',
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F3F4F6',
  },
  body: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  muted: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  barLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barKey: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  barVal: {
    fontSize: 12,
    color: '#6B7280',
  },
  barTrack: {
    height: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 4,
    overflow: 'hidden',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F3F4F6',
  },
});
