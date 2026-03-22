import React, { useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { DashboardTask } from '../types.js';
import { C, palette } from '../components/shared/colors.js';
import { Badge } from '../components/shared/Badge.js';
import { Avatar } from '../components/shared/Avatar.js';
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

  const cardStyle = {
    backgroundColor: C.surface2,
    borderWidth: highlighted ? 2 : 1,
    borderColor: highlighted ? C.brand : hovered ? C.steel : C.border,
    borderLeftWidth: 3,
    borderLeftColor: stripeColor,
    borderRadius: 8,
    padding: 10,
    paddingLeft: 12,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    cursor: 'pointer' as const,
    transform: hovered ? ([{ translateY: -1 }] as object) : undefined,
    boxShadow: highlighted
      ? (`0 0 0 2px ${C.brand}44` as object)
      : hovered ? (`0 4px 12px ${palette.overlay.black30}` as object) : undefined,
  };

  // Navigate to task detail view
  const handleCardPress = () => {
    window.location.hash = `#task?id=${encodeURIComponent(task.id)}`;
  };

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={handleCardPress}
      style={cardStyle}
    >
      {/* Top row: ID + optional age badge */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: C.brand, fontFamily: 'Space Grotesk, monospace' }}>
          {task.id}
        </Text>
        {task.col === 'ready' && task.queueAge != null && task.queueAge > 0 && (
          <Badge label={formatAge(task.queueAge)} color={C.warning} size="sm" />
        )}
      </View>

      {/* Title */}
      <Text style={{ fontSize: 13, fontWeight: '500', color: C.textPrimary, lineHeight: 18, marginBottom: 8 }}>
        {task.title}
      </Text>

      {/* Meta row: agent + branch */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
              style={{ cursor: 'pointer' as const }}
            >
              <Avatar name={task.agent} size={20} rounded={true} />
            </Pressable>
          ) : null}
          {task.agent && (
            <Text style={{ fontSize: 11, color: C.textSecondary }}>{task.agent}</Text>
          )}
        </View>
        {task.branch && (
          <View style={{ backgroundColor: C.surface3, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 140 }}>
            <Text style={{ fontSize: 10, color: C.textSecondary, fontFamily: 'monospace' }} numberOfLines={1}>
              {task.branch}
            </Text>
          </View>
        )}
      </View>

      {/* PR badge for review column */}
      {task.pr && (
        <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
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
        <View style={{ marginTop: 6, gap: 3 }}>
          {unmetDeps.map(depId => {
            const dep = allTasks.find(t => t.id === depId);
            return (
              <View key={depId} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ fontSize: 11, color: C.error }}>↳</Text>
                <Pressable onPress={(e) => {
                  e.stopPropagation();
                  window.location.hash = `#task?id=${encodeURIComponent(depId)}`;
                }}>
                  <Text style={{ fontSize: 10, color: C.brand, fontFamily: 'monospace' }}>{depId}</Text>
                </Pressable>
                {dep && (
                  <Text style={{ fontSize: 10, color: C.error }} numberOfLines={1}>{dep.title}</Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

function reviewStatusColor(status: string): string {
  return status === 'approved' ? C.success : status === 'changes' ? C.warning : C.textSecondary;
}
