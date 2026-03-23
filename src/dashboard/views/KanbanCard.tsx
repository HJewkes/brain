import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { DashboardTask } from '../types.js';
import { C, palette } from '../components/shared/colors.js';
import { Badge } from '../components/shared/Badge.js';
import { Avatar } from '../components/shared/Avatar.js';
import { Card } from '../components/shared/Card.js';
import { priorityStripeColor } from '../utils/semantic-colors.js';
import { formatAge } from '../utils/formatting.js';

interface KanbanCardProps {
  task: DashboardTask;
  allTasks: DashboardTask[];
  highlighted?: boolean;
  onAgentHover: (agentName: string, el: HTMLElement) => void;
  onAgentLeave: () => void;
  onAgentClick: (agentName: string) => void;
}

export function KanbanCard({ task, allTasks, highlighted, onAgentHover, onAgentLeave, onAgentClick }: KanbanCardProps) {
  const [hovered, setHovered] = React.useState(false);
  const avatarRef = useRef<View>(null);

  const stripeColor = priorityStripeColor(task.priority);
  const isBlocked = task.col === 'blocked';

  // Find unmet deps (deps that exist in allTasks and aren't done)
  const unmetDeps = task.deps.filter(depId => {
    const dep = allTasks.find(t => t.id === depId);
    return dep && dep.col !== 'done';
  });

  const borderColor = highlighted ? C.brand : hovered ? C.steel : C.border;
  const boxShadow = highlighted
    ? (`0 0 0 2px ${C.brand}44` as object)
    : hovered ? (`0 4px 12px ${palette.overlay.black30}` as object) : undefined;
  const transform = hovered ? ([{ translateY: -1 }] as object) : undefined;

  // Navigate to task detail view
  const handleCardPress = () => {
    window.location.hash = `#task?id=${encodeURIComponent(task.id)}`;
  };

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={handleCardPress}
      style={[styles.pressable, { transform, boxShadow } as object]}
    >
      <Card
        variant="accent"
        accentColor={stripeColor}
        accentWidth={3}
        borderColor={borderColor}
        padding={10}
      >
        {/* Top row: ID + optional age badge */}
        <View style={styles.topRow}>
          <Text style={styles.taskId}>{task.id}</Text>
          {task.col === 'ready' && task.queueAge != null && task.queueAge > 0 && (
            <Badge label={formatAge(task.queueAge)} color={C.warning} size="sm" />
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{task.title}</Text>

        {/* Meta row: agent + branch */}
        <View style={styles.metaRow}>
          <View style={styles.agentRow}>
            {task.agent ? (
              <Pressable
                ref={avatarRef as React.RefObject<View>}
                onHoverIn={(e) => {
                  const el = (e.target as HTMLElement);
                  onAgentHover(task.agent!, el);
                }}
                onHoverOut={onAgentLeave}
                onPress={(e) => {
                  e.stopPropagation();
                  onAgentClick(task.agent!);
                }}
                style={styles.avatarPressable}
              >
                <Avatar name={task.agent} size={20} rounded={true} />
              </Pressable>
            ) : null}
            {task.agent && (
              <Text style={styles.agentName}>{task.agent}</Text>
            )}
          </View>
          {task.branch && (
            <View style={styles.branchPill}>
              <Text style={styles.branchText} numberOfLines={1}>
                {task.branch}
              </Text>
            </View>
          )}
        </View>

        {/* PR badge for review column */}
        {task.pr && (
          <View style={styles.prRow}>
            <Badge label={`PR #${task.pr.url.split('/').pop()}`} color={C.info} size="sm" />
            {task.pr.reviewStatus && (
              <Badge
                label={task.pr.reviewStatus}
                color={reviewStatusColor(task.pr.reviewStatus)}
                size="sm"
              />
            )}
          </View>
        )}

        {/* Dependency chain for blocked cards */}
        {isBlocked && unmetDeps.length > 0 && (
          <View style={styles.depsContainer}>
            {unmetDeps.map(depId => {
              const dep = allTasks.find(t => t.id === depId);
              return (
                <View key={depId} style={styles.depRow}>
                  <Text style={styles.depArrow}>↳</Text>
                  <Pressable onPress={(e) => {
                    e.stopPropagation();
                    window.location.hash = `#task?id=${encodeURIComponent(depId)}`;
                  }}>
                    <Text style={styles.depId}>{depId}</Text>
                  </Pressable>
                  {dep && (
                    <Text style={styles.depTitle} numberOfLines={1}>{dep.title}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

function reviewStatusColor(status: string): string {
  return status === 'approved' ? C.success : status === 'changes' ? C.warning : C.textSecondary;
}

const styles = StyleSheet.create({
  pressable: {
    cursor: 'pointer' as never,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  taskId: {
    fontSize: 11,
    fontWeight: '600',
    color: C.brand,
    fontFamily: "'Space Grotesk', monospace",
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    color: C.textPrimary,
    lineHeight: 18,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatarPressable: {
    cursor: 'pointer' as never,
  },
  agentName: {
    fontSize: 11,
    color: C.textSecondary,
  },
  branchPill: {
    backgroundColor: C.surface3,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 140,
  },
  branchText: {
    fontSize: 10,
    color: C.textSecondary,
    fontFamily: 'monospace',
  },
  prRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  depsContainer: {
    marginTop: 6,
    gap: 3,
  },
  depRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  depArrow: {
    fontSize: 11,
    color: C.error,
  },
  depId: {
    fontSize: 10,
    color: C.brand,
    fontFamily: 'monospace',
  },
  depTitle: {
    fontSize: 10,
    color: C.error,
  },
});
