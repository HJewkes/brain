import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { DashboardAgent } from '../types.js';
import { C } from './shared/colors.js';
import { TokenGauge } from './shared/TokenGauge.js';
import { ActivitySparkline } from './shared/ActivitySparkline.js';
import type { SparkEvent } from './shared/ActivitySparkline.js';

const AVATAR_COLORS = [C.brand, C.info, C.success, C.steel, C.warning, '#8B5CF6', '#EC4899'];

interface Props {
  agent: DashboardAgent;
  index: number;
}

function buildSparkEvents(domains: string[]): SparkEvent[] {
  // Use toolDomains as mock sparkline data (last 15 entries)
  return domains.slice(-15).map(type => ({ type }));
}

export function AgentCard({ agent, index }: Props) {
  const isActive = agent.status === 'active' || agent.status === 'running';
  const errRate = agent.toolCalls > 0
    ? ((agent.errors / agent.toolCalls) * 100).toFixed(1)
    : '0.0';
  const avatarBg = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const statusBg = isActive ? 'rgba(20,184,166,0.15)' : 'rgba(107,114,128,0.15)';
  const statusDotColor = isActive ? C.success : C.textTertiary;
  const statusLabel = isActive ? 'Active' : (agent.status === 'completed' ? 'Done' : 'Idle');
  const sparkEvents = buildSparkEvents(agent.toolDomains);

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.nameGroup}>
          <View style={[s.avatar, { backgroundColor: avatarBg }]}>
            <Text style={s.avatarText}>{agent.name.slice(0, 2).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={s.name}>{agent.name}</Text>
            <View style={[s.statusBadge, { backgroundColor: statusBg }]}>
              <View style={[s.statusDot, { backgroundColor: statusDotColor }]} />
              <Text style={[s.statusText, { color: statusDotColor }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Task + branch */}
      {agent.task ? (
        <Pressable
          style={s.taskRow}
          onPress={() => { window.location.hash = `#kanban?task=${encodeURIComponent(agent.task!)}`; }}
        >
          <Text style={[s.taskText, s.taskTextLink]} numberOfLines={1}>
            {agent.task}
            {agent.branch ? `  ${agent.branch}` : ''}
          </Text>
        </Pressable>
      ) : (
        <View style={s.taskRow}>
          <Text style={s.taskText} numberOfLines={1}>No active task</Text>
        </View>
      )}

      {/* Token gauge */}
      <TokenGauge tokensIn={agent.tokensIn} tokensOut={agent.tokensOut} />

      {/* Metrics */}
      <View style={s.metricsRow}>
        {([
          ['Tool Calls', String(agent.toolCalls), false],
          ['Errors', String(agent.errors), agent.errors > 0],
          ['Err Rate', `${errRate}%`, parseFloat(errRate) > 5],
        ] as [string, string, boolean][]).map(([label, val, isErr]) => (
          <View key={label} style={s.metric}>
            <Text style={[s.metricValue, isErr && s.errorText]}>{val}</Text>
            <Text style={s.metricLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Activity sparkline */}
      <Text style={s.sparkLabel}>Recent Activity</Text>
      <ActivitySparkline events={sparkEvents} />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  nameGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'Space Grotesk, sans-serif',
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 3,
    fontFamily: 'Inter, sans-serif',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '500' },
  taskRow: {
    backgroundColor: C.surface3,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 12,
  },
  taskText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: C.steel,
  },
  taskTextLink: {
    color: C.brand,
    textDecorationLine: 'underline',
    textDecorationColor: C.brand + '66',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  metric: {
    flex: 1,
    backgroundColor: C.surface3,
    borderRadius: 6,
    padding: 7,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
    fontFamily: 'Space Grotesk, sans-serif',
  },
  metricLabel: { fontSize: 10, color: C.textTertiary, marginTop: 2 },
  errorText: { color: C.error },
  sparkLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.textTertiary,
    marginBottom: 4,
  },
});
