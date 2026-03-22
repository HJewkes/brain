import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@titan-design/react-ui';
import type { BadgeColor } from '@titan-design/react-ui';
import { C } from './shared/colors.js';

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
    <Card variant="elevated" elevation={2}>
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
                <Badge variant="subtle" color={statusColor(agent.status)} size="sm">
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
