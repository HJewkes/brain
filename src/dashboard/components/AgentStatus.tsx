import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './shared/Card.js';
import { C, palette } from './shared/colors.js';

type BadgeColor = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const BADGE_COLORS: Record<BadgeColor, { bg: string; text: string }> = {
  success: { bg: palette.teal.dim10,   text: palette.teal.base },
  warning: { bg: palette.amber.dim20,  text: palette.amber.base },
  error:   { bg: palette.red.dim10,    text: palette.red.base },
  info:    { bg: 'rgba(33,150,243,0.15)', text: palette.blue.base },
  neutral: { bg: palette.gray.dim15,   text: C.textSecondary },
};

function CardHeader({ children }: { children: React.ReactNode }) {
  return <View style={s.cardHeader}>{children}</View>;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

function CardContent({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.cardContent, style]}>{children}</View>;
}

function Badge({ children, color = 'neutral' }: { children: React.ReactNode; color?: BadgeColor }) {
  const c = BADGE_COLORS[color] ?? BADGE_COLORS.neutral;
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: c.text, fontSize: 11, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

interface Agent {
  name?: string;
  task?: string;
  branch?: string;
  status?: string;
}

interface AgentStatusProps {
  agents?: Agent[];
  auditAgents?: {
    total: number;
    active: number;
    completed: number;
    worktrees: number;
  };
}

function statusColor(status?: string): BadgeColor {
  if (!status) return 'warning';
  const s = status.toLowerCase();
  if (s === 'active' || s === 'running') return 'success';
  if (s === 'completed' || s === 'done') return 'info';
  if (s === 'error' || s === 'failed') return 'error';
  return 'warning';
}

export function AgentStatus({ agents = [], auditAgents: _auditAgents }: AgentStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Status</CardTitle>
      </CardHeader>
      <CardContent style={{ paddingTop: 0, gap: 8 }}>
        {agents.length === 0 ? (
          <Text style={s.emptyText}>No agent data in status cache</Text>
        ) : (
          agents.map((agent, i) => (
            <View key={i} style={s.agentRow}>
              <View style={s.rowTop}>
                <Text style={s.agentName}>{agent.name ?? 'unnamed'}</Text>
                <Badge color={statusColor(agent.status)}>
                  {agent.status ?? 'unknown'}
                </Badge>
              </View>
              {agent.task && (
                <Text style={s.metaText}>Task: {agent.task}</Text>
              )}
              {agent.branch && (
                <Text style={s.metaText}>Branch: {agent.branch}</Text>
              )}
            </View>
          ))
        )}
      </CardContent>
    </Card>
  );
}

const s = StyleSheet.create({
  cardHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardContent: { padding: 16 },
  emptyText: { fontSize: 14, color: C.textTertiary },
  agentRow: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  agentName: { fontSize: 14, fontWeight: '600', color: C.textPrimary },
  metaText: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
});
