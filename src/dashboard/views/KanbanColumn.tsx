import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { DashboardTask, DashboardAgent } from '../types.js';
import { C, palette } from '../components/shared/colors.js';
import { Avatar } from '../components/shared/Avatar.js';
import { columnColor } from '../utils/semantic-colors.js';
import { KanbanCard } from './KanbanCard.js';
import { component } from '../tokens.js';

const COL_LABEL: Record<string, string> = {
  blocked: 'Blocked',
  ready: 'Ready',
  inprogress: 'In Progress',
  review: 'PR / Review',
  done: 'Done',
};

const WIP_LIMIT = 4;

interface KanbanColumnProps {
  col: string;
  tasks: DashboardTask[];
  allTasks: DashboardTask[];
  agents: DashboardAgent[];
  workstreams?: Record<string, { name: string; project: string }>;
  highlightedTask?: string;
  onAgentHover: (agentName: string, el: HTMLElement) => void;
  onAgentLeave: () => void;
  onAgentClick: (agentName: string) => void;
}

const WS_COLORS = palette.series;

export function KanbanColumn({ col, tasks, allTasks, agents, workstreams = {}, highlightedTask, onAgentHover, onAgentLeave, onAgentClick }: KanbanColumnProps) {
  const [collapsed, setCollapsed] = useState(col === 'done');
  const accent = columnColor(col);
  const label = COL_LABEL[col] ?? col;
  const width = col === 'inprogress' ? 380 : col === 'review' ? 320 : 300;

  const headerStyle = [s.header, { borderTopColor: accent }];
  const bodyStyle = s.body;

  const wipOver = col === 'inprogress' && tasks.length > WIP_LIMIT;
  const wipWarn = col === 'inprogress' && tasks.length === WIP_LIMIT;

  // Group inprogress tasks by agent swimlane
  const swimlanes = col === 'inprogress' ? buildSwimlanes(tasks, agents) : null;

  const wipColor = wipOver ? C.error : wipWarn ? C.warning : C.textSecondary;
  const wipWeight = (wipOver || wipWarn) ? '600' : '400';

  return (
    <View style={[s.column, { width }]}>
      {/* Column header */}
      <View style={headerStyle}>
        <View style={s.headerLeft}>
          <View style={[s.dot, { backgroundColor: accent }]} />
          <Text style={s.colLabel}>{label}</Text>
          <View style={s.badge}>
            <Text style={s.badgeText}>{tasks.length}</Text>
          </View>
        </View>
        <View style={s.headerRight}>
          {col === 'inprogress' && (
            <Text style={[s.wipText, { color: wipColor, fontWeight: wipWeight as '400' | '600' }]}>
              WIP {tasks.length}/{WIP_LIMIT}
            </Text>
          )}
          {col === 'done' && (
            <Pressable onPress={() => setCollapsed(!collapsed)}>
              <Text style={s.chevron}>{collapsed ? '▶' : '▼'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Column body */}
      {!collapsed && (
        <ScrollView style={bodyStyle} contentContainerStyle={s.bodyContent}>
          {tasks.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>No tasks</Text>
            </View>
          ) : col === 'inprogress' && swimlanes ? (
            swimlanes.map(lane => (
              <AgentSwimlane
                key={lane.agentName}
                agentName={lane.agentName}
                agent={lane.agent}
                tasks={lane.tasks}
                allTasks={allTasks}
                highlightedTask={highlightedTask}
                onAgentHover={onAgentHover}
                onAgentLeave={onAgentLeave}
                onAgentClick={onAgentClick}
              />
            ))
          ) : (
            renderGroupedTasks(tasks, allTasks, workstreams, highlightedTask, onAgentHover, onAgentLeave, onAgentClick)
          )}
        </ScrollView>
      )}
      {collapsed && col === 'done' && (
        <View style={s.collapsedBody}>
          <Pressable onPress={() => setCollapsed(false)}>
            <Text style={s.collapsedText}>Click to expand {tasks.length} done tasks</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function renderGroupedTasks(
  tasks: DashboardTask[],
  allTasks: DashboardTask[],
  workstreams: Record<string, { name: string; project: string }>,
  highlightedTask: string | undefined,
  onAgentHover: (agentName: string, el: HTMLElement) => void,
  onAgentLeave: () => void,
  onAgentClick: (agentName: string) => void,
) {
  const groups = new Map<string, DashboardTask[]>();
  for (const t of tasks) {
    const ws = t.workstream || '(none)';
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws)!.push(t);
  }

  const sortedKeys = Array.from(groups.keys()).sort();
  if (sortedKeys.length <= 1) {
    return tasks.map(task => (
      <KanbanCard
        key={task.id} task={task} allTasks={allTasks}
        highlighted={task.id === highlightedTask}
        onAgentHover={onAgentHover} onAgentLeave={onAgentLeave} onAgentClick={onAgentClick}
      />
    ));
  }

  return sortedKeys.map((ws, i) => {
    const wsInfo = workstreams[ws];
    const wsName = wsInfo?.name ?? ws;
    const wsColor = WS_COLORS[i % WS_COLORS.length];
    const wsTasks = groups.get(ws)!;

    return (
      <React.Fragment key={ws}>
        <View style={[s.wsHeader, i > 0 && s.wsHeaderBorder, i > 0 && s.wsHeaderMargin]}>
          <View style={[s.wsDot, { backgroundColor: wsColor }]} />
          <Text style={s.wsName}>{wsName}</Text>
        </View>
        {wsTasks.map(task => (
          <KanbanCard
            key={task.id} task={task} allTasks={allTasks}
            highlighted={task.id === highlightedTask}
            onAgentHover={onAgentHover} onAgentLeave={onAgentLeave} onAgentClick={onAgentClick}
          />
        ))}
      </React.Fragment>
    );
  });
}

interface Swimlane {
  agentName: string;
  agent: DashboardAgent | undefined;
  tasks: DashboardTask[];
}

function buildSwimlanes(tasks: DashboardTask[], agents: DashboardAgent[]): Swimlane[] {
  const map = new Map<string, DashboardTask[]>();
  for (const t of tasks) {
    const key = t.agent ?? '(unassigned)';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries()).map(([agentName, laneTasks]) => ({
    agentName,
    agent: agents.find(a => a.name === agentName),
    tasks: laneTasks,
  }));
}

interface AgentSwimlaneProps {
  agentName: string;
  agent: DashboardAgent | undefined;
  tasks: DashboardTask[];
  allTasks: DashboardTask[];
  highlightedTask?: string;
  onAgentHover: (agentName: string, el: HTMLElement) => void;
  onAgentLeave: () => void;
  onAgentClick: (agentName: string) => void;
}

function AgentSwimlane({ agentName, agent: _agent, tasks, allTasks, highlightedTask, onAgentHover, onAgentLeave, onAgentClick }: AgentSwimlaneProps) {
  return (
    <View style={s.swimlane}>
      {/* Swimlane header */}
      <View style={s.swimlaneHeader}>
        <Pressable
          onHoverIn={(e) => onAgentHover(agentName, e.target as HTMLElement)}
          onHoverOut={onAgentLeave}
          onPress={() => onAgentClick(agentName)}
          style={s.avatarPress}
        >
          <Avatar name={agentName} size={26} rounded={false} />
        </Pressable>
        <Text style={s.swimlaneAgentName}>{agentName}</Text>
        <Text style={s.swimlaneTaskCount}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</Text>
      </View>

      {/* Swimlane cards */}
      <View style={s.swimlaneCards}>
        {tasks.map(task => (
          <KanbanCard
            key={task.id}
            task={task}
            allTasks={allTasks}
            highlighted={task.id === highlightedTask}
            onAgentHover={onAgentHover}
            onAgentLeave={onAgentLeave}
            onAgentClick={onAgentClick}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  column: {
    flexShrink: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.surface2,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 2,
    borderBottomWidth: 0,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  colLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  badge: {
    backgroundColor: C.surface3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    color: C.textSecondary,
    fontWeight: '500',
  },
  wipText: {
    fontSize: 11,
  },
  chevron: {
    fontSize: 14,
    color: C.textSecondary,
  },
  body: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    padding: 8,
    minHeight: 60,
    // Dynamic maxHeight and overflowY set via web styles
    maxHeight: 'calc(100vh - 190px)' as unknown as number,
    overflowY: 'auto' as unknown as 'scroll',
  },
  bodyContent: {
    gap: 8,
  },
  emptyState: {
    paddingVertical: 28,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: C.textTertiary,
    fontStyle: 'italic',
  },
  collapsedBody: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  collapsedText: {
    fontSize: 12,
    color: C.textTertiary,
  },
  wsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  wsHeaderBorder: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  wsHeaderMargin: {
    marginTop: 4,
  },
  wsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  wsName: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  swimlane: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  swimlaneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: component.swimlaneHeader.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  avatarPress: {
    cursor: 'pointer' as const,
  },
  swimlaneAgentName: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textPrimary,
    flex: 1,
  },
  swimlaneTaskCount: {
    fontSize: 11,
    color: C.textSecondary,
  },
  swimlaneCards: {
    padding: 6,
    gap: 6,
  },
});
