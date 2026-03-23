import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DashboardData } from '../types.js';
import { StatCard } from '../components/shared/StatCard.js';
import { C, component } from '../components/shared/colors.js';
import { Section } from '../components/shared/Section.js';
import { DataTable } from '../components/shared/DataTable.js';
import { HorizBarList } from '../components/shared/HorizBarList.js';
import type { HorizBarRow } from '../components/shared/HorizBarList.js';
import { ChartContainer, GridLines, xPos, yPos } from '../components/shared/chart/index.js';
import {
  computeDodPassRate,
  computeFunnel,
  computeAgentErrorRates,
  computeStageDurations,
  computeVelocity,
  fmtMinutes,
  type AgentErrorRate,
  type VelocityPoint,
} from './qualityMetrics.js';

interface QualityViewProps {
  dashboard: DashboardData | null;
}

// ── Agent Error Table ─────────────────────────────────────────────────────────

const ERROR_COLUMNS = [
  { key: 'name', label: 'Agent', flex: 1, align: 'left' as const },
  { key: 'toolCalls', label: 'Tool Calls', width: 72, align: 'right' as const },
  { key: 'errors', label: 'Errors', width: 56, align: 'right' as const },
  { key: 'errorRate', label: 'Err Rate', width: 72, align: 'right' as const },
];

function AgentErrorTable({ agents }: { agents: AgentErrorRate[] }) {
  return (
    <DataTable
      columns={ERROR_COLUMNS}
      data={agents}
      getKey={a => a.id}
      highlightRow={a => a.errorRate > 5}
      emptyText="No agents"
      renderCell={(a, key) => {
        if (key === 'name') {
          return <Text style={styles.agentName}>{a.name}</Text>;
        }
        if (key === 'errors') {
          return (
            <Text style={[styles.cellText, a.errors > 0 && styles.errorText]}>
              {a.errors}
            </Text>
          );
        }
        if (key === 'errorRate') {
          const isHigh = a.errorRate > 5;
          return (
            <View style={[styles.rateBadge, isHigh && styles.errorBadge]}>
              <Text style={[styles.cellText, isHigh && styles.errorText, isHigh && styles.boldText]}>
                {a.errorRate}%
              </Text>
            </View>
          );
        }
        return (
          <Text style={styles.cellText}>
            {a[key as keyof AgentErrorRate] as string | number}
          </Text>
        );
      }}
    />
  );
}

// ── Velocity Chart ─────────────────────────────────────────────────────────────

function VelocityChart({ points }: { points: VelocityPoint[] }) {
  const hasData = points.some(p => p.count > 0);
  if (!hasData) return <Text style={styles.emptyText}>No completions in the last 14 days</Text>;

  const W = 560;
  const H = 160;
  const PAD = { top: 10, right: 20, bottom: 28, left: 32 };
  const maxY = Math.max(...points.map(p => p.count), 1);
  const cfg = { width: W, height: H, padding: PAD };

  const xp = (i: number) => xPos(i, points.length, cfg);
  const yp = (v: number) => yPos(v, maxY, cfg);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xp(i).toFixed(1)},${yp(p.count).toFixed(1)}`)
    .join(' ');
  const areaPath =
    linePath +
    ` L${xp(points.length - 1).toFixed(1)},${yp(0).toFixed(1)} L${xp(0).toFixed(1)},${yp(0).toFixed(1)} Z`;

  const xStep = Math.ceil(points.length / 7);
  const gridYs = [0, Math.round(maxY / 2), maxY];

  return (
    <ChartContainer width={W} height={H} padding={PAD}>
      <GridLines horizontal={3} width={W} height={H} padding={PAD} />
      {gridYs.map(v => (
        <text key={v} x={PAD.left - 4} y={yp(v) + 3} fill={C.textTertiary} fontSize="9" textAnchor="end">
          {v}
        </text>
      ))}
      {points
        .filter((_, i) => i % xStep === 0 || i === points.length - 1)
        .map(p => {
          const i = points.indexOf(p);
          return (
            <text key={i} x={xp(i)} y={H - 4} fill={C.textTertiary} fontSize="9" textAnchor="middle">
              {p.label}
            </text>
          );
        })}
      <path d={areaPath} fill={C.success} opacity="0.12" />
      <path d={linePath} fill="none" stroke={C.success} strokeWidth="2" />
      {points.map((p, i) =>
        p.count > 0 ? <circle key={i} cx={xp(i)} cy={yp(p.count)} r="3" fill={C.success} /> : null,
      )}
    </ChartContainer>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function QualityView({ dashboard }: QualityViewProps) {
  if (!dashboard) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No dashboard data available</Text>
      </View>
    );
  }

  const dod = computeDodPassRate(dashboard);
  const funnel = computeFunnel(dashboard);
  const agentErrors = computeAgentErrorRates(dashboard);
  const stageDurs = computeStageDurations(dashboard.stageHistory);
  const velocity = computeVelocity(dashboard.stageHistory);

  const velocitySpark = velocity.map(p => p.count);
  const highErrorCount = agentErrors.filter(a => a.errorRate > 5).length;

  const funnelTotal = funnel[0]?.count ?? 0;
  const funnelRows: HorizBarRow[] = funnel.map((stage, i) => {
    const pct = funnelTotal > 0 ? (stage.count / funnelTotal) * 100 : 0;
    const prev = funnel[i - 1];
    const dropOff =
      i > 0 && prev && prev.count > 0
        ? Math.round(((prev.count - stage.count) / prev.count) * 100)
        : null;
    return {
      label: stage.label,
      value: pct,
      display: String(stage.count),
      annotation: dropOff !== null && dropOff > 0 ? `−${dropOff}%` : undefined,
    };
  });

  const stageDurRows: HorizBarRow[] = stageDurs.map(s => ({
    label: s.stage,
    value: s.avgMinutes,
    display: s.avgMinutes > 0 ? `${fmtMinutes(s.avgMinutes)}${s.isBottleneck ? ' ⚠' : ''}` : '—',
    warn: s.isBottleneck,
  }));

  return (
    <View style={styles.container}>
      {/* KPI row */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCell}>
          <StatCard
            label="DoD Pass Rate"
            value={dod.passRate !== null ? `${dod.passRate}%` : '—'}
            delta={dod.total > 0 ? `${dod.passed}/${dod.total} tasks` : undefined}
            deltaPositive={dod.passRate !== null && dod.passRate >= 80}
          />
        </View>
        <View style={styles.kpiCell}>
          <StatCard
            label="Tasks Done"
            value={funnel.find(s => s.label === 'Done')?.count ?? 0}
            sparkData={velocitySpark}
          />
        </View>
        <View style={styles.kpiCell}>
          <StatCard
            label="High-Error Agents"
            value={highErrorCount}
            delta={highErrorCount > 0 ? '>5% err rate' : 'all healthy'}
            deltaPositive={highErrorCount === 0}
          />
        </View>
      </View>

      {/* Funnel + Error Rate side by side */}
      <View style={styles.twoCol}>
        <View style={styles.colLeft}>
          <Section title="Task Completion Funnel">
            {funnelTotal === 0 ? (
              <Text style={styles.emptyText}>No tasks yet</Text>
            ) : (
              <HorizBarList rows={funnelRows} maxValue={100} labelWidth={84} barHeight={12} />
            )}
          </Section>
        </View>
        <View style={styles.colRight}>
          <Section title="Error Rate by Agent">
            <AgentErrorTable agents={agentErrors} />
          </Section>
        </View>
      </View>

      {/* Stage Duration + Velocity side by side */}
      <View style={styles.twoCol}>
        <View style={styles.colLeft}>
          <Section title="Stage Duration Distribution">
            <HorizBarList
              rows={stageDurRows}
              labelWidth={80}
              barHeight={10}
              emptyText="No stage history"
            />
          </Section>
        </View>
        <View style={styles.colRight}>
          <Section title="Task Velocity (14 days)">
            <VelocityChart points={velocity} />
          </Section>
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { gap: 16, paddingBottom: 32 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 14, color: C.textTertiary },

  kpiRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  kpiCell: { flex: 1, minWidth: 160 },

  twoCol: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  colLeft: { flex: 2, minWidth: 300 },
  colRight: { flex: 1, minWidth: 260 },

  // AgentErrorTable cell styles
  agentName: { fontSize: 13, color: C.textPrimary, fontWeight: '500' },
  cellText: { fontSize: 12, color: C.textSecondary },
  errorText: { color: C.error },
  boldText: { fontWeight: '600' },
  rateBadge: { borderRadius: 4, paddingHorizontal: 4, alignItems: 'center' },
  errorBadge: { backgroundColor: component.statCard.negativeDeltaBg },
});
