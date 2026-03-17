import React, { useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { DashboardTask } from '../types.js';
import { C } from '../components/shared/colors.js';
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
    borderRadius: 8,
    padding: 10,
    paddingLeft: 14,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    cursor: 'pointer' as const,
    transform: hovered ? ([{ translateY: -1 }] as object) : undefined,
    boxShadow: highlighted
      ? (`0 0 0 2px ${C.brand}44` as object)
      : hovered ? ('0 4px 12px rgba(0,0,0,0.3)' as object) : undefined,
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
      {/* Priority stripe */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: stripeColor, borderRadius: 8 }} />

      {/* Top row: ID + optional age badge */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: C.brand, fontFamily: 'Space Grotesk, monospace' }}>
          {task.id}
        </Text>
        {task.col === 'ready' && task.queueAge != null && task.queueAge > 0 && (
          <View style={{ backgroundColor: 'rgba(255,176,32,0.1)', borderWidth: 1, borderColor: 'rgba(255,176,32,0.2)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ fontSize: 10, color: C.warning }}>{formatAge(task.queueAge)}</Text>
          </View>
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
              style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as const }}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff' }}>
                {task.agent.slice(0, 2).toUpperCase()}
              </Text>
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
          <View style={{ backgroundColor: 'rgba(33,150,243,0.1)', borderWidth: 1, borderColor: 'rgba(33,150,243,0.2)', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, color: C.info }}>PR #{task.pr.url.split('/').pop()}</Text>
          </View>
          {task.pr.reviewStatus && (
            <View style={reviewStatusStyle(task.pr.reviewStatus)}>
              <Text style={{ fontSize: 10, color: reviewStatusColor(task.pr.reviewStatus) }}>
                {task.pr.reviewStatus}
              </Text>
            </View>
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

function reviewStatusStyle(status: string) {
  const configs: Record<string, { bg: string; border: string }> = {
    approved: { bg: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.2)' },
    changes: { bg: 'rgba(255,176,32,0.1)', border: 'rgba(255,176,32,0.2)' },
    pending: { bg: 'rgba(107,114,128,0.15)', border: 'rgba(107,114,128,0.2)' },
  };
  const c = configs[status] ?? configs.pending;
  return { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 };
}

function reviewStatusColor(status: string): string {
  return status === 'approved' ? C.success : status === 'changes' ? C.warning : C.textSecondary;
}
