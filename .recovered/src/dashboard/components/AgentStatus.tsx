import React from 'react';
import { View, Text } from 'react-native';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@titan-design/react-ui';
import type { BadgeColor } from '@titan-design/react-ui';

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

export function AgentStatus({ agents = [], auditAgents }: AgentStatusProps) {
  return (
    <Card variant="elevated" elevation={2}>
      <CardHeader>
        <CardTitle>Agent Status</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 gap-2">
        {agents.length === 0 ? (
          <Text className="text-sm text-text-tertiary">
            No agent data in status cache
          </Text>
        ) : (
          agents.map((agent, i) => (
            <View
              key={i}
              className="bg-surface-raised border border-border-subtle rounded-lg px-4 py-3"
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-sm font-semibold text-text-primary">
                  {agent.name ?? 'unnamed'}
                </Text>
                <Badge
                  variant="subtle"
                  color={statusColor(agent.status)}
                  size="sm"
                >
                  {agent.status ?? 'unknown'}
                </Badge>
              </View>
              {agent.task && (
                <Text className="text-xs text-text-secondary mt-1">
                  Task: {agent.task}
                </Text>
              )}
              {agent.branch && (
                <Text className="text-xs text-text-secondary mt-0.5">
                  Branch: {agent.branch}
                </Text>
              )}
            </View>
          ))
        )}
      </CardContent>
    </Card>
  );
}
