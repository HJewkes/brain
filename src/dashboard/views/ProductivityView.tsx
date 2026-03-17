import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { DashboardData, AuditReport, DashboardAgent } from '../types.js';
import { StatCard } from '../components/shared/StatCard.js';
import { TokenGauge } from '../components/shared/TokenGauge.js';
import { C } from '../components/shared/colors.js';
import { Section } from '../components/shared/Section.js';
import {
  computeThroughput, computeLeadTimeP85, computeFlowEfficiency,
  computeWIPAge, computeAgentPerf, computeBurndown, computeResumptionStats,
  fmtMinutes,
  type AgentPerf, type BurndownPoint, type ResumptionStats,
} from './productivityMetrics.js';
import { Avatar } from '../components/shared/Avatar.js';
import { ChartContainer, GridLines, xPos, yPos } from '../components/shared/chart/index.js';

interface ProductivityViewProps {
  dashboard: DashboardData | null;
  audit: AuditReport;
  initialAgent?: string;
}

// ── KPI Row ────────────────────────────────────────────────────────────────────

function KPIRow({ dashboard }: { dashboard: DashboardData }) {
  const throughput = computeThroughput(dashboard);
  const { p85 } = computeLeadTimeP85(dashboard.stageHistory);
  const { ratio: flowEff } = computeFlowEfficiency(dashboard.stageHistory);
  const wipAge = computeWIPAge(dashboard, dashboard.stageHistory);

  return (
    <View style={styles.kpiRow}>
      <View style={styles.kpiCell}>
        <StatCard label="Throughput" value={throughput} delta={throughput > 0 ? `${throughput} done` : undefined} deltaPositive />
      </View>
      <View style={styles.kpiCell}>
        <StatCard label="Lead Time P85" value={p85 !== null ? fmtMinutes(p85) : '—'} />
      </View>
      <View style={styles.kpiCell}>
        <StatCard
          label="Flow Efficiency"
          value={flowEff !== null ? `${flowEff}%` : '—'}
          delta={flowEff !== null ? (flowEff >= 15 ? 'healthy' : 'low') : undefined}
          deltaPositive={flowEff !== null && flowEff >= 15}
        />
      </View>
      <View style={styles.kpiCell}>
        <StatCard label="WIP Age" value={wipAge !== null ? fmtMinutes(wipAge) : '—'} />
      </View>
    </View>
  );
}

// ── Agent Avatar ───────────────────────────────────────────────────────────────

function AgentAvatar({ agent }: { agent: DashboardAgent }) {
  const isActive = agent.status === 'active' || agent.status === 'running';
  return (
    <View style={styles.avatarWrap}>
      <Avatar name={agent.name} size={32} rounded={true} />
      <View style={[styles.statusDot, { backgroundColor: isActive ? C.success : C.textTertiary }]} />
    </View>
  );
}

// ── Agent Performance Grid ─────────────────────────────────────────────────────

function AgentPerfGrid({ perf, highlightedAgent }: { perf: AgentPerf[]; highlightedAgent?: string }) {
  if (perf.length === 0) {
    return <Text style={styles.emptyText}>No agents</Text>;
  }
  return (
    <View>
      {perf.map(({ agent, tasksDone, errorRate }) => (
        <View
          key={agent.id}
          style={[
            styles.agentRow,
            agent.name === highlightedAgent && styles.agentRowHighlighted,
          ]}
        >
          <View style={styles.agentIdentity}>
            <AgentAvatar agent={agent} />
            <View style={styles.agentMeta}>
              <Pressable onPress={() => { window.location.hash = `#agents?agent=${encodeURIComponent(agent.name)}`; }}>
                <Text style={[styles.agentName, styles.agentNameLink]}>{agent.name}</Text>
              </Pressable>
              <Text style={styles.agentStatus}>{agent.status}</Text>
            </View>
          </View>
          <View style={styles.agentStat}>
            <Text style={styles.agentStatVal}>{tasksDone}</Text>
            <Text style={styles.agentStatLabel}>Done</Text>
          </View>
          <View style={styles.agentStatWide}>
            <TokenGauge tokensIn={agent.tokensIn} tokensOut={agent.tokensOut} />
          </View>
          <View style={styles.agentStat}>
            <Text style={styles.agentStatVal}>{agent.toolCalls}</Text>
            <Text style={styles.agentStatLabel}>Tools</Text>
          </View>
          <View style={styles.agentStat}>
            <Text style={[styles.agentStatVal, agent.errors > 0 && styles.errorVal]}>{agent.errors}</Text>
            <Text style={styles.agentStatLabel}>Errors</Text>
          </View>
          <View style={styles.agentStat}>
            <Text style={[styles.agentStatVal, errorRate > 5 && styles.errorVal]}>{errorRate}%</Text>
            <Text style={styles.agentStatLabel}>Err Rate</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Burndown Chart ─────────────────────────────────────────────────────────────

function BurndownChart({ points }: { points: BurndownPoint[] }) {
  if (points.length < 2) {
    return <Text style={styles.emptyText}>Not enough data</Text>;
  }
  const W = 580;
  const H = 180;
  const PAD = { top: 10, right: 50, bottom: 28, left: 36 };
  const cfg = { width: W, height: H, padding: PAD };
  const maxY = Math.max(...points.map(p => Math.max(p.ideal, p.actual)), 1);

  const xp = (i: number) => xPos(i, points.length, cfg);
  const yp = (v: number) => yPos(v, maxY, cfg);

  const idealPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xp(i).toFixed(1)},${yp(p.ideal).toFixed(1)}`).join(' ');
  const actualPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xp(i).toFixed(1)},${yp(p.actual).toFixed(1)}`).join(' ');
  const areaPath = actualPath + ` L${xp(points.length - 1).toFixed(1)},${yp(0).toFixed(1)} L${xp(0).toFixed(1)},${yp(0).toFixed(1)} Z`;

  const gridYs = [0, Math.round(maxY / 2), maxY];
  const xStep = Math.ceil(points.length / 7);
  const visiblePoints = points.filter((_, i) => i % xStep === 0 || i === points.length - 1);

  return (
    <View style={styles.chartWrap}>
      <ChartContainer width={W} height={H} padding={PAD}>
        <GridLines horizontal={3} width={W} height={H} padding={PAD} />
        {gridYs.map(v => (
          <text key={v} x={PAD.left - 4} y={yp(v) + 3} fill={C.textTertiary} fontSize="9" textAnchor="end">{v}</text>
        ))}
        {visiblePoints.map(p => {
          const i = points.indexOf(p);
          return (
            <text key={i} x={xp(i)} y={H - 4} fill={C.textTertiary} fontSize="9" textAnchor="middle">{p.label}</text>
          );
        })}
        <path d={areaPath} fill={C.brand} opacity="0.12" />
        <path d={idealPath} fill="none" stroke={C.textSecondary} strokeWidth="1.5" strokeDasharray="4,4" />
        <path d={actualPath} fill="none" stroke={C.brand} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={xp(i)} cy={yp(p.actual)} r="3" fill={C.brand} />
        ))}
        <text x={xp(points.length - 1) + 4} y={yp(points[points.length - 1].actual) + 3} fill={C.brand} fontSize="9">Actual</text>
        <text x={xp(points.length - 1) + 4} y={yp(points[points.length - 1].ideal) + 3} fill={C.textTertiary} fontSize="9">Ideal</text>
      </ChartContainer>
    </View>
  );
}

// ── Error Hotspots ─────────────────────────────────────────────────────────────

function ErrorHotspots({ perf }: { perf: AgentPerf[] }) {
  const sorted = perf
    .filter(p => p.agent.errors > 0)
    .sort((a, b) => b.agent.errors - a.agent.errors);

  if (sorted.length === 0) {
    return <Text style={styles.emptyText}>No errors recorded</Text>;
  }

  return (
    <View>
      {sorted.map(({ agent, errorRate }) => (
        <View key={agent.id} style={styles.errorRow}>
          <Text style={styles.errorCount}>{agent.errors}x</Text>
          <Text style={styles.errorName}>{agent.name}</Text>
          <View style={[styles.errorRateBadge, errorRate > 5 && styles.errorRateBadgeHigh]}>
            <Text style={[styles.errorRateText, errorRate > 5 && styles.errorRateTextHigh]}>
              {errorRate}% err
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Resumption Analytics ───────────────────────────────────────────────────────

function ResumptionSection({ stats }: { stats: ResumptionStats }) {
  if (stats.totalResumptions === 0) {
    return <Text style={styles.emptyText}>No task resumptions recorded</Text>;
  }

  const maxWsCount = stats.byWorkstream[0]?.count ?? 1;

  return (
    <View style={styles.resumptionGrid}>
      {/* Rate card */}
      <View style={styles.resumptionCard}>
        <Text style={styles.resumptionCardTitle}>Resumption Rate</Text>
        <Text style={styles.resumptionBig}>{stats.totalResumptions}</Text>
        <Text style={styles.resumptionSub}>
          resets / {stats.totalCompletions} completions
          {stats.resumptionRate !== null ? ` (${stats.resumptionRate}%)` : ''}
        </Text>
      </View>

      {/* By workstream bar chart */}
      <View style={[styles.resumptionCard, styles.resumptionCardWide]}>
        <Text style={styles.resumptionCardTitle}>By Workstream</Text>
        {stats.byWorkstream.map(({ workstream, count }) => (
          <View key={workstream} style={styles.wsBarRow}>
            <Text style={styles.wsBarLabel} numberOfLines={1}>{workstream}</Text>
            <View style={styles.wsBarTrack}>
              <View style={[styles.wsBarFill, { width: `${Math.round((count / maxWsCount) * 100)}%` as any }]} />
            </View>
            <Text style={styles.wsBarCount}>{count}</Text>
          </View>
        ))}
      </View>

      {/* Top tasks table */}
      <View style={[styles.resumptionCard, styles.resumptionCardWide]}>
        <Text style={styles.resumptionCardTitle}>High-Resumption Tasks</Text>
        {stats.topTasks.map(row => (
          <View key={row.taskId} style={styles.taskRow}>
            <View style={styles.taskRowMeta}>
              <Text style={styles.taskRowTitle} numberOfLines={1}>{row.title}</Text>
              <Text style={styles.taskRowWs}>{row.workstream}</Text>
            </View>
            <View style={[styles.resumptionBadge, row.count >= 3 && styles.resumptionBadgeHigh]}>
              <Text style={[styles.resumptionBadgeText, row.count >= 3 && styles.resumptionBadgeTextHigh]}>
                ×{row.count}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ProductivityView({ dashboard, initialAgent }: ProductivityViewProps) {
  if (!dashboard) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No dashboard data available</Text>
      </View>
    );
  }

  const agentPerf = computeAgentPerf(dashboard);
  const burndown = computeBurndown(dashboard);
  const resumption = computeResumptionStats(dashboard.stageHistory, dashboard.tasks, dashboard.workstreams);

  return (
    <View style={styles.container}>
      <KPIRow dashboard={dashboard} />
      <Section title="Agent Performance">
        <AgentPerfGrid perf={agentPerf} highlightedAgent={initialAgent} />
      </Section>
      <View style={styles.twoCol}>
        <View style={styles.colLeft}>
          <Section title="Task Burndown">
            <BurndownChart points={burndown} />
          </Section>
        </View>
        <View style={styles.colRight}>
          <Section title="Error Hotspots">
            <ErrorHotspots perf={agentPerf} />
          </Section>
        </View>
      </View>
      <Section title="Resumption Analytics">
        <ResumptionSection stats={resumption} />
      </Section>
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
  colRight: { flex: 1, minWidth: 220 },

  // Agent grid rows
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  agentRowHighlighted: {
    backgroundColor: 'rgba(255,121,0,0.06)',
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  agentIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 160 },
  agentMeta: { flex: 1 },
  agentName: { fontSize: 13, fontWeight: '600', color: C.textPrimary },
  agentNameLink: { color: C.brand, textDecorationLine: 'underline', textDecorationColor: C.brand + '66' },
  agentStatus: { fontSize: 11, color: C.textTertiary },
  agentStat: { alignItems: 'center', minWidth: 52 },
  agentStatWide: { flex: 1, minWidth: 140 },
  agentStatVal: { fontSize: 16, fontWeight: '600', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' },
  agentStatLabel: { fontSize: 10, color: C.textTertiary, textTransform: 'uppercase' },

  // Avatar wrapper (holds Avatar + status dot)
  avatarWrap: {
    width: 32,
    height: 32,
    position: 'relative',
  },
  statusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: C.surface1,
  },

  // Chart
  chartWrap: { width: '100%' },

  // Error hotspots
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  errorCount: { fontSize: 14, fontWeight: '700', color: C.error, minWidth: 32, fontFamily: 'Space Grotesk, sans-serif' },
  errorName: { flex: 1, fontSize: 13, color: C.textPrimary },
  errorRateBadge: {
    backgroundColor: C.surface3,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  errorRateBadgeHigh: { backgroundColor: 'rgba(209,67,67,0.15)' },
  errorRateText: { fontSize: 11, color: C.textSecondary },
  errorRateTextHigh: { color: C.error, fontWeight: '600' },
  errorVal: { color: C.error },

  // Resumption analytics
  resumptionGrid: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  resumptionCard: {
    flex: 1,
    minWidth: 160,
    backgroundColor: C.surface3,
    borderRadius: 8,
    padding: 14,
  },
  resumptionCardWide: { flex: 2, minWidth: 240 },
  resumptionCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  resumptionBig: {
    fontSize: 36,
    fontWeight: '700',
    color: C.textPrimary,
    fontFamily: 'Space Grotesk, sans-serif',
  },
  resumptionSub: { fontSize: 12, color: C.textTertiary, marginTop: 4 },

  // Workstream bars
  wsBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  wsBarLabel: { fontSize: 11, color: C.textSecondary, width: 72 },
  wsBarTrack: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  wsBarFill: { height: '100%', backgroundColor: C.brand, borderRadius: 4 },
  wsBarCount: { fontSize: 11, color: C.textTertiary, minWidth: 18, textAlign: 'right' },

  // High-resumption task table
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  taskRowMeta: { flex: 1 },
  taskRowTitle: { fontSize: 12, color: C.textPrimary },
  taskRowWs: { fontSize: 10, color: C.textTertiary },
  resumptionBadge: {
    backgroundColor: C.surface1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  resumptionBadgeHigh: { backgroundColor: 'rgba(209,67,67,0.15)' },
  resumptionBadgeText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' },
  resumptionBadgeTextHigh: { color: C.error },
});
