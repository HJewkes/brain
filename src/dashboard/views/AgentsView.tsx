import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { DashboardData, DashboardAgent } from '../types.js';
import { C } from '../components/shared/colors.js';
import { Badge } from '../components/shared/Badge.js';
import { fmtK } from '../utils/formatting.js';
import { AgentCard } from '../components/AgentCard.js';
import { Avatar } from '../components/shared/Avatar.js';
import { statusColor } from '../utils/semantic-colors.js';

interface AgentsViewProps {
  dashboard: DashboardData | null;
  initialAgent?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isActiveAgent(a: DashboardAgent): boolean {
  return a.status === 'active' || a.status === 'running';
}

function sortAgents(agents: DashboardAgent[]): DashboardAgent[] {
  // Stable partition: active agents first, historical agents preserve original order.
  const active = agents.filter(isActiveAgent);
  const historical = agents.filter(a => !isActiveAgent(a));
  return [...active, ...historical];
}

// ---------------------------------------------------------------------------
// Aggregate stats bar
// ---------------------------------------------------------------------------
function StatsBar({ agents }: { agents: DashboardAgent[] }) {
  const active = agents.filter(isActiveAgent).length;
  const totalTokens = agents.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0);
  const totalTools = agents.reduce((s, a) => s + a.toolCalls, 0);
  const totalErrors = agents.reduce((s, a) => s + a.errors, 0);
  const errRate = totalTools > 0 ? ((totalErrors / totalTools) * 100).toFixed(1) : '0.0';

  const stats: [string, string, string][] = [
    ['Total Agents', String(agents.length), C.textPrimary],
    ['Active', String(active), C.success],
    ['Idle', String(agents.length - active), C.textTertiary],
    ['Total Tokens', fmtK(totalTokens), C.info],
    ['Tool Calls', fmtK(totalTools), C.success],
    ['Error Rate', `${errRate}%`, totalErrors > 0 ? C.error : C.textTertiary],
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

// ---------------------------------------------------------------------------
// Status cards sub-view
// ---------------------------------------------------------------------------
interface StatusCardsViewProps {
  agents: DashboardAgent[];
  highlightedAgent?: string;
  dimHistorical: boolean;
}

function StatusCardsView({ agents, highlightedAgent, dimHistorical }: StatusCardsViewProps) {
  if (agents.length === 0) {
    return (
      <View style={s.emptyState}>
        <Text style={s.emptyIcon}>○</Text>
        <Text style={s.emptyTitle}>No agents tracked yet</Text>
        <Text style={s.emptySubtitle}>Agents appear here once they register with the session module.</Text>
      </View>
    );
  }

  return (
    <>
      <StatsBar agents={agents} />
      <View style={s.cardsGrid}>
        {agents.map((agent, i) => {
          const dim = dimHistorical && !isActiveAgent(agent);
          return (
            <View
              key={agent.id}
              style={[
                s.cardSlot,
                agent.name === highlightedAgent && s.cardSlotHighlighted,
                dim && s.cardSlotDimmed,
              ]}
            >
              <AgentCard agent={agent} index={i} />
            </View>
          );
        })}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Topology sub-view (flat placeholder — no delegation data yet)
// ---------------------------------------------------------------------------
function TopologyView({ agents, dimHistorical }: { agents: DashboardAgent[]; dimHistorical: boolean }) {
  if (agents.length === 0) {
    return (
      <View style={s.emptyState}>
        <Text style={s.emptyIcon}>○</Text>
        <Text style={s.emptyTitle}>No agents tracked yet</Text>
        <Text style={s.emptySubtitle}>Hierarchy view will appear once agents are active.</Text>
      </View>
    );
  }

  // First agent is treated as coordinator; rest are workers.
  const coordinator = agents[0];
  const workers = agents.slice(1);
  const isDimmed = (a: DashboardAgent) => dimHistorical && !isActiveAgent(a);

  return (
    <View style={s.topology}>
      {/* Coordinator row */}
      <View style={s.topoRow}>
        <TopoNode agent={coordinator} role="coordinator" index={0} isDimmed={isDimmed(coordinator)} />
      </View>

      {workers.length > 0 && (
        <>
          {/* Connector line */}
          <View style={s.connectorLine} />
          {/* Horizontal bar above workers */}
          {workers.length > 1 && <View style={s.connectorBar} />}
          {/* Worker row */}
          <View style={s.topoRow}>
            {workers.map((agent, i) => (
              <View key={agent.id} style={s.topoWorkerSlot}>
                {workers.length > 1 && <View style={s.connectorDown} />}
                <TopoNode agent={agent} role="worker" index={i + 1} isDimmed={isDimmed(agent)} />
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}


interface TopoNodeProps {
  agent: DashboardAgent;
  role: 'coordinator' | 'worker';
  index: number;
  isDimmed?: boolean;
}

function TopoNode({ agent, role, index: _index, isDimmed }: TopoNodeProps) {
  const isActive = agent.status === 'active' || agent.status === 'running';
  const statusLabel = isActive ? 'active' : 'idle';
  const roleLabel = role === 'coordinator' ? 'coordinator' : 'worker';

  return (
    <View style={[s.topoNode, isDimmed && s.topoNodeDimmed]}>
      <Avatar name={agent.name} size={40} rounded={false} />
      <Text style={s.topoName}>{agent.name}</Text>
      <Text style={s.topoRole}>{roleLabel}</Text>
      <Badge label={statusLabel} color={statusColor(statusLabel)} dot size="sm" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toggle bar + main view
// ---------------------------------------------------------------------------
type ViewMode = 'status' | 'topology';

export function AgentsView({ dashboard, initialAgent }: AgentsViewProps) {
  const [mode, setMode] = useState<ViewMode>('status');
  const [showHistorical, setShowHistorical] = useState(false);
  const allAgents = dashboard?.agents ?? [];
  const highlightedAgent = initialAgent;

  const historicalCount = allAgents.filter(a => !isActiveAgent(a)).length;
  const visibleAgents = showHistorical
    ? sortAgents(allAgents)
    : sortAgents(allAgents.filter(isActiveAgent));

  return (
    <View style={s.container}>
      {/* Toggle bar row */}
      <View style={s.toggleRow}>
        <View style={s.toggleBar}>
          <Pressable
            style={[s.toggleBtn, mode === 'status' && s.toggleBtnActive]}
            onPress={() => setMode('status')}
          >
            <Text style={[s.toggleBtnText, mode === 'status' && s.toggleBtnTextActive]}>
              Status Cards
            </Text>
          </Pressable>
          <Pressable
            style={[s.toggleBtn, mode === 'topology' && s.toggleBtnActive]}
            onPress={() => setMode('topology')}
          >
            <Text style={[s.toggleBtnText, mode === 'topology' && s.toggleBtnTextActive]}>
              Topology
            </Text>
          </Pressable>
        </View>

        <Pressable
          style={[s.historicalPill, showHistorical && s.historicalPillActive]}
          onPress={() => setShowHistorical(prev => !prev)}
        >
          <Text style={[s.historicalPillText, showHistorical && s.historicalPillTextActive]}>
            {showHistorical ? 'Hide Historical' : `Show Historical${historicalCount > 0 ? ` (${historicalCount})` : ''}`}
          </Text>
        </Pressable>
      </View>

      {!showHistorical && historicalCount > 0 && (
        <Text style={s.hiddenHint}>{historicalCount} historical agent{historicalCount !== 1 ? 's' : ''} hidden</Text>
      )}

      {mode === 'status'
        ? <StatusCardsView agents={visibleAgents} highlightedAgent={highlightedAgent} dimHistorical={showHistorical} />
        : <TopologyView agents={visibleAgents} dimHistorical={showHistorical} />
      }
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  container: { flex: 1 },

  // Toggle row (view-mode pills + historical toggle)
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },

  // Toggle
  toggleBar: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 4,
    alignSelf: 'flex-start',
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 6,
  },
  toggleBtnActive: { backgroundColor: C.surface3 },
  toggleBtnText: { fontSize: 13, color: C.textSecondary, fontFamily: "'Inter', sans-serif" },
  toggleBtnTextActive: { color: C.textPrimary, fontWeight: '600' },

  // Historical toggle pill
  historicalPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface1,
  },
  historicalPillActive: {
    borderColor: C.brand,
    backgroundColor: `${C.brand}18` as unknown as object,
  },
  historicalPillText: { fontSize: 12, color: C.textTertiary, fontFamily: "'Inter', sans-serif" },
  historicalPillTextActive: { color: C.brand, fontWeight: '500' },

  // Hidden count hint
  hiddenHint: {
    fontSize: 11,
    color: C.textTertiary,
    marginBottom: 14,
    fontStyle: 'italic',
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    flexWrap: 'wrap' as const,
  },
  statCard: {
    flex: 1,
    minWidth: 90,
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
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: "'Space Grotesk', sans-serif",
  },

  // Cards grid — 3-col with wrapping
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap' as const,
    gap: 14,
  },
  cardSlot: {
    width: '31%' as unknown as number,
    minWidth: 280,
    flex: 1,
  },
  cardSlotHighlighted: {
    borderWidth: 2,
    borderColor: C.brand,
    borderRadius: 10,
    boxShadow: `0 0 0 3px ${C.brand}33` as unknown as object,
  },
  cardSlotDimmed: { opacity: 0.55 },

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

  // Topology
  topology: {
    alignItems: 'center',
    paddingTop: 32,
    gap: 0,
  },
  topoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  topoWorkerSlot: { alignItems: 'center' },
  connectorLine: {
    width: 2,
    height: 32,
    backgroundColor: C.border,
  },
  connectorBar: {
    height: 2,
    width: '80%' as unknown as number,
    backgroundColor: C.border,
  },
  connectorDown: {
    width: 2,
    height: 16,
    backgroundColor: C.border,
  },
  topoNode: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    gap: 4,
    minWidth: 120,
  },
  topoNodeDimmed: { opacity: 0.55 },
  topoName: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textPrimary,
    fontFamily: "'Inter', sans-serif",
  },
  topoRole: {
    fontSize: 10,
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
