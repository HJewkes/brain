import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DashboardData } from '../types.js';
import { C } from '../components/shared/colors.js';
import { type as T } from '../tokens.js';

interface CostsViewProps {
  dashboard: DashboardData | null;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function AlertBanner({ alerts }: { alerts: Array<{ level: string; message: string }> }) {
  if (alerts.length === 0) return null;

  return (
    <View style={s.alertContainer}>
      {alerts.map((alert, i) => (
        <View
          key={i}
          style={[
            s.alertRow,
            alert.level === 'critical' ? s.alertCritical : s.alertWarning,
          ]}
        >
          <Text style={s.alertIcon}>{alert.level === 'critical' ? '!!' : '!'}</Text>
          <Text style={s.alertText}>{alert.message}</Text>
        </View>
      ))}
    </View>
  );
}

function SummaryCards({ totalCost, totalAgents }: { totalCost: number; totalAgents: number }) {
  const avgCost = totalAgents > 0 ? totalCost / totalAgents : 0;

  const stats: [string, string, string][] = [
    ['Total Spend', fmtUsd(totalCost), C.textPrimary],
    ['Agents', String(totalAgents), C.info],
    ['Avg / Agent', fmtUsd(avgCost), C.textSecondary],
  ];

  return (
    <View style={s.statsBar}>
      {stats.map(([label, value, color]) => (
        <View key={label} style={s.statCard}>
          <Text style={s.statLabel}>{label}</Text>
          <Text style={[s.statValue, { color }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function CostTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<[string, string, string]>;
}) {
  if (rows.length === 0) {
    return (
      <View style={s.tableContainer}>
        <Text style={s.tableTitle}>{title}</Text>
        <Text style={s.emptyText}>No cost data available.</Text>
      </View>
    );
  }

  return (
    <View style={s.tableContainer}>
      <Text style={s.tableTitle}>{title}</Text>
      <View style={s.tableHeader}>
        {headers.map((h) => (
          <Text key={h} style={s.headerCell}>{h}</Text>
        ))}
      </View>
      {rows.map(([col1, col2, col3], i) => (
        <View key={i} style={[s.tableRow, i % 2 === 0 && s.tableRowAlt]}>
          <Text style={s.cell}>{col1}</Text>
          <Text style={[s.cell, s.cellRight]}>{col2}</Text>
          <Text style={[s.cell, s.cellRight]}>{col3}</Text>
        </View>
      ))}
    </View>
  );
}

function CostBar({ items, total }: { items: Array<{ label: string; value: number }>; total: number }) {
  if (items.length === 0 || total === 0) return null;

  return (
    <View style={s.barContainer}>
      <View style={s.barTrack}>
        {items.map((item, i) => {
          const pct = (item.value / total) * 100;
          if (pct < 1) return null;
          return (
            <View
              key={i}
              style={[
                s.barSegment,
                { width: `${pct}%` as unknown as number },
                { backgroundColor: barColors[i % barColors.length] },
              ]}
            />
          );
        })}
      </View>
      <View style={s.barLegend}>
        {items.filter((item) => item.value > 0).map((item, i) => (
          <View key={i} style={s.legendItem}>
            <View
              style={[s.legendDot, { backgroundColor: barColors[i % barColors.length] }]}
            />
            <Text style={s.legendLabel}>
              {item.label} ({fmtUsd(item.value)})
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const barColors = [C.brand, C.success, C.info, C.warning, C.error, C.textTertiary];

export function CostsView({ dashboard }: CostsViewProps) {
  const costs = dashboard?.costs;

  if (!costs || (costs.totalAgents === 0 && costs.byPeriod.length === 0)) {
    return (
      <View style={s.emptyState}>
        <Text style={s.emptyIcon}>$</Text>
        <Text style={s.emptyTitle}>No cost data yet</Text>
        <Text style={s.emptySubtitle}>
          Agent costs appear here once agents report their usage.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <AlertBanner alerts={costs.alerts} />
      <SummaryCards totalCost={costs.totalCostUsd} totalAgents={costs.totalAgents} />

      <CostBar
        items={costs.byWorkstream.map((w) => ({ label: w.workstream, value: w.costUsd }))}
        total={costs.totalCostUsd}
      />

      <View style={s.tablesRow}>
        <CostTable
          title="Cost by Day"
          headers={['Date', 'Cost', 'Agents']}
          rows={costs.byPeriod.slice(-14).map((p) => [
            p.period,
            fmtUsd(p.costUsd),
            String(p.agentCount),
          ])}
        />
        <CostTable
          title="Cost by Workstream"
          headers={['Workstream', 'Cost', 'Agents']}
          rows={costs.byWorkstream.map((w) => [
            w.workstream,
            fmtUsd(w.costUsd),
            String(w.agentCount),
          ])}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  container: { flex: 1, gap: 20 },

  // Alerts
  alertContainer: { gap: 8 },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  alertCritical: {
    backgroundColor: `${C.error}18` as unknown as object,
    borderColor: C.error,
  },
  alertWarning: {
    backgroundColor: `${C.warning}18` as unknown as object,
    borderColor: C.warning,
  },
  alertIcon: { fontSize: 14, fontWeight: '700', color: C.error },
  alertText: { ...T.bodySm, color: C.textPrimary, flex: 1 },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  statCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 14,
  },
  statLabel: {
    fontSize: 10,
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statValue: { ...T.heading2xl },

  // Cost bar visualization
  barContainer: { gap: 8 },
  barTrack: {
    flexDirection: 'row',
    height: 20,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: C.surface1,
  },
  barSegment: { height: '100%' as unknown as number },
  barLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap' as const,
    gap: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...T.bodySm, color: C.textSecondary },

  // Tables
  tablesRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  tableContainer: {
    flex: 1,
    minWidth: 280,
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 16,
  },
  tableTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 12,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingBottom: 8,
    marginBottom: 4,
  },
  headerCell: {
    flex: 1,
    fontSize: 10,
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  tableRowAlt: {
    backgroundColor: `${C.surface2}60` as unknown as object,
    borderRadius: 4,
  },
  cell: { flex: 1, ...T.bodySm, color: C.textSecondary },
  cellRight: { textAlign: 'right' },

  emptyText: { ...T.bodySm, color: C.textTertiary },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyIcon: { fontSize: 48, color: C.textTertiary },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  emptySubtitle: {
    fontSize: 13,
    color: C.textTertiary,
    textAlign: 'center',
    maxWidth: 360,
  },
});
