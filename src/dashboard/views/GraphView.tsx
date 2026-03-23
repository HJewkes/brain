import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '../components/shared/Card.js';
import { Badge } from '../components/shared/Badge.js';
import type { AuditReport, DashboardData } from '../types.js';
import { palette, semantic } from '../tokens.js';

interface GraphViewProps {
  dashboard: DashboardData | null;
  audit: AuditReport;
}

const BAR_COLORS = palette.series;

function BarChart({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;

  return (
    <Card>
      <View style={s.cardHeader}>
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      <View style={s.cardContent}>
        {entries.length === 0 ? (
          <Text style={s.muted}>No data</Text>
        ) : (
          <View style={s.barList}>
            {entries.map(([key, val], i) => (
              <View key={key} style={s.barItem}>
                <View style={s.barLabel}>
                  <Text style={s.barKey}>{key}</Text>
                  <Text style={s.barVal}>{val.toLocaleString()}</Text>
                </View>
                <View style={s.barTrack}>
                  <View
                    style={[s.barFill, {
                      width: `${(val / max) * 100}%` as unknown as number,
                      backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                    }]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </Card>
  );
}

const VIEW_MODES = ['Force-Directed', 'Clustered', 'Ego-Network'] as const;

export function GraphView({ audit }: GraphViewProps) {
  const noteCount = audit.notes?.total ?? 0;
  const relationCount = audit.relations?.total ?? 0;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Knowledge Graph</Text>
        <View style={s.badges}>
          {VIEW_MODES.map((mode) => (
            <Badge key={mode} label={mode} color={semantic.text.tertiary} />
          ))}
        </View>
      </View>

      {/* Coming soon */}
      <Card>
        <View style={s.cardContent}>
          <View style={s.comingSoon}>
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
            <Text style={[s.muted, s.mutedSmall]}>
              Requires graph data in the dashboard payload — tracked in VNM-15.28
            </Text>
          </View>
        </View>
      </Card>

      {/* Row 1: Notes by Module + Notes by Type */}
      <View style={s.row}>
        <View style={s.col}>
          <BarChart title="Notes by Module" data={audit.notes?.byModule ?? {}} />
        </View>
        <View style={s.col}>
          <BarChart title="Notes by Type" data={audit.notes?.byType ?? {}} />
        </View>
      </View>

      {/* Row 2: Relations by Type + Graph Stats */}
      <View style={s.row}>
        <View style={s.col}>
          <BarChart title="Relations by Type" data={audit.relations?.byType ?? {}} />
        </View>
        <View style={s.col}>
          <Card>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>Graph Stats</Text>
            </View>
            <View style={s.cardContent}>
              <View style={s.statList}>
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
            </View>
          </Card>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    gap: 16,
  },
  col: {
    flex: 1,
  },
  mutedSmall: {
    fontSize: 11,
    marginTop: 4,
  },
  comingSoon: {
    gap: 8,
  },
  barList: {
    gap: 8,
  },
  barItem: {
    gap: 3,
  },
  barFill: {
    height: '100%' as unknown as number,
    borderRadius: 3,
  },
  statList: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: semantic.text.primary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: semantic.border,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: semantic.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardContent: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: semantic.text.primary,
  },
  body: {
    fontSize: 13,
    color: semantic.text.secondary,
    lineHeight: 20,
  },
  muted: {
    fontSize: 12,
    color: semantic.text.tertiary,
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
    color: semantic.text.secondary,
  },
  barVal: {
    fontSize: 12,
    color: semantic.text.tertiary,
  },
  barTrack: {
    height: 8,
    backgroundColor: palette.surface3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.surface3,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: semantic.text.primary,
  },
});
