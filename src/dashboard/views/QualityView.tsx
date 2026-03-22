import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DashboardData } from '../types.js';
import { StatCard } from '../components/shared/StatCard.js';
import { C, component } from '../components/shared/colors.js';
import { Section } from '../components/shared/Section.js';
import { ChartContainer, GridLines, xPos, yPos } from '../components/shared/chart/index.js';
import {
  computeDodPassRate,
  computeFunnel,
  computeAgentErrorRates,
  computeStageDurations,
  computeVelocity,
  fmtMinutes,
  type FunnelStage,
  type AgentErrorRate,
  type StageDuration,
  type VelocityPoint,
} from './qualityMetrics.js';

interface QualityViewProps {
  dashboard: DashboardData | null;
}

function EmptyState({ message }: { message: string }) {
  return <Text style={styles.emptyText}>{message}</Text>;
}

// ── Task Completion Funnel ──────────────────────────────────────────────────

function CompletionFunnel({ stages }: { stages: FunnelStage[] }) {
  const total = stages[0]?.count ?? 0;
  if (total === 0) return <EmptyState message="No tasks yet" />;

  return (
    <View style={styles.funnelWrap}>
      {stages.map((stage, i) => {
        const pct = total > 0 ? (stage.count / total) * 100 : 0;
        const dropOff =
          i > 0 && stages[i - 1].count > 0
            ? Math.round(((stages[i - 1].count - stage.count) / stages[i - 1].count) * 100)
            : null;
        return (
          <View key={stage.label} style={styles.funnelRow}>
            <Text style={styles.funnelLabel}>{stage.label}</Text>
            <View style={styles.funnelBarBg}>
              <View style={[styles.funnelBarFill, { width: `${pct}%` as unknown as number }]} />
            </View>
            <Text style={styles.funnelCount}>{stage.count}</Text>
            {dropOff !== null && dropOff > 0 ? (
              <Text style={styles.funnelDropOff}>−{dropOff}%</Text>
            ) : (
              <Text style={styles.funnelDropOffEmpty} />
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Error Rate by Agent ─────────────────────────────────────────────────────

function AgentErrorTable({ agents }: { agents: AgentErrorRate[] }) {
  if (agents.length === 0) return <EmptyState message="No agents" />;

  return (
    <View>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCell, styles.tableColWide]}>Agent</Text>
        <Text style={styles.tableCell}>Tool Calls</Text>
        <Text style={styles.tableCell}>Errors</Text>
        <Text style={styles.tableCell}>Err Rate</Text>
      </View>
      {agents.map(a => {
        const isHigh = a.errorRate > 5;
        return (
          <View key={a.id} style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.tableColWide, styles.agentName]}>{a.name}</Text>
            <Text style={styles.tableCell}>{a.toolCalls}</Text>
            <Text style={[styles.tableCell, a.errors > 0 && styles.errorText]}>{a.errors}</Text>
            <View style={[styles.tableCellWrap, isHigh && styles.errorBadge]}>
              <Text style={[styles.tableCell, isHigh && styles.errorText, isHigh && styles.boldText]}>
                {a.errorRate}%
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Stage Duration Bars ─────────────────────────────────────────────────────

function StageDurationChart({ stages }: { stages: StageDuration[] }) {
  const hasData = stages.some(s => s.avgMinutes > 0);
  if (!hasData) return <EmptyState message="No stage history" />;

  const maxMin = Math.max(...stages.map(s => s.avgMinutes), 1);

  return (
    <View style={styles.stageDurWrap}>
      {stages.map(s => {
        const pct = (s.avgMinutes / maxMin) * 100;
        return (
          <View key={s.stage} style={styles.stageDurRow}>
            <Text style={styles.stageDurLabel}>{s.stage}</Text>
            <View style={styles.stageDurBarBg}>
              <View
                style={[
                  styles.stageDurBarFill,
                  { width: `${pct}%` as unknown as number },
                  s.isBottleneck && styles.stageDurBottleneck,
                ]}
              />
            </View>
            <Text style={[styles.stageDurVal, s.isBottleneck && styles.errorText]}>
              {s.avgMinutes > 0 ? fmtMinutes(s.avgMinutes) : '—'}
              {s.isBottleneck ? ' ⚠' : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Task Velocity Chart ─────────────────────────────────────────────────────

function VelocityChart({ points }: { points: VelocityPoint[] }) {
  const hasData = points.some(p => p.count > 0);
  if (!hasData) return <EmptyState message="No completions in the last 14 days" />;

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
            value={agentErrors.filter(a => a.errorRate > 5).length}
            delta={agentErrors.filter(a => a.errorRate > 5).length > 0 ? '>5% err rate' : 'all healthy'}
            deltaPositive={agentErrors.filter(a => a.errorRate > 5).length === 0}
          />
        </View>
      </View>

      {/* Funnel + Error Rate side by side */}
      <View style={styles.twoCol}>
        <View style={styles.colLeft}>
          <Section title="Task Completion Funnel">
            <CompletionFunnel stages={funnel} />
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
            <StageDurationChart stages={stageDurs} />
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

  // Funnel
  funnelWrap: { gap: 10 },
  funnelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  funnelLabel: { fontSize: 12, color: C.textSecondary, width: 84 },
  funnelBarBg: {
    flex: 1,
    height: 12,
    backgroundColor: C.surface3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  funnelBarFill: { height: '100%', backgroundColor: C.brand, borderRadius: 6 },
  funnelCount: { fontSize: 12, color: C.textPrimary, fontWeight: '600', minWidth: 28, textAlign: 'right' },
  funnelDropOff: { fontSize: 11, color: C.error, minWidth: 36, textAlign: 'right' },
  funnelDropOffEmpty: { minWidth: 36 },

  // Agent error table
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableCell: { fontSize: 12, color: C.textSecondary, minWidth: 60, textAlign: 'center' },
  tableColWide: { flex: 1, textAlign: 'left' },
  tableCellWrap: { minWidth: 60, alignItems: 'center', borderRadius: 4 },
  agentName: { fontSize: 13, color: C.textPrimary, fontWeight: '500' },
  errorText: { color: C.error },
  boldText: { fontWeight: '600' },
  errorBadge: { backgroundColor: component.statCard.negativeDeltaBg, borderRadius: 4, paddingHorizontal: 4 },

  // Stage duration
  stageDurWrap: { gap: 12 },
  stageDurRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stageDurLabel: { fontSize: 12, color: C.textSecondary, width: 80 },
  stageDurBarBg: {
    flex: 1,
    height: 10,
    backgroundColor: C.surface3,
    borderRadius: 5,
    overflow: 'hidden',
  },
  stageDurBarFill: { height: '100%', backgroundColor: C.steel, borderRadius: 5 },
  stageDurBottleneck: { backgroundColor: C.warning },
  stageDurVal: { fontSize: 12, color: C.textSecondary, minWidth: 64, textAlign: 'right' },

});
