import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import type { DashboardTask, DashboardAgent } from '../types.js';
import { C } from '../components/shared/colors.js';
import { KanbanCard } from './KanbanCard.js';

const COL_ACCENT: Record<string, string> = {
  blocked: C.error,
  ready: C.warning,
  inprogress: C.brand,
  review: C.info,
  done: C.success,
};

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

const WS_COLORS = [C.brand, '#1965B0', '#4EB265', '#882E72', '#F4A736', '#7BAFDE', '#DC050C', '#F7F056'];

export function KanbanColumn({ col, tasks, allTasks, agents, workstreams = {}, highlightedTask, onAgentHover, onAgentLeave, onAgentClick }: KanbanColumnProps) {
  const [collapsed, setCollapsed] = useState(col === 'done');
  const accent = COL_ACCENT[col] ?? C.textSecondary;
  const label = COL_LABEL[col] ?? col;
  const width = col === 'inprogress' ? 380 : col === 'review' ? 320 : 300;

  const headerStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.surface2,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 2,
    borderTopColor: accent,
    borderBottomWidth: 0,
  };

  const bodyStyle = {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    padding: 8,
    gap: 8,
    minHeight: 60,
    maxHeight: 'calc(100vh - 190px)' as unknown as number,
    overflowY: 'auto' as unknown as 'scroll',
  };

  const wipOver = col === 'inprogress' && tasks.length > WIP_LIMIT;
  const wipWarn = col === 'inprogress' && tasks.length === WIP_LIMIT;

  // Group inprogress tasks by agent swimlane
  const swimlanes = col === 'inprogress' ? buildSwimlanes(tasks, agents) : null;

  return (
    <View style={{ width, flexShrink: 0 }}>
      {/* Column header */}
      <View style={headerStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {label}
          </Text>
          <View style={{ backgroundColor: C.surface3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
            <Text style={{ fontSize: 11, color: C.textSecondary, fontWeight: '500' }}>{tasks.length}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {col === 'inprogress' && (
            <Text style={{ fontSize: 11, color: wipOver ? C.error : wipWarn ? C.warning : C.textSecondary, fontWeight: (wipOver || wipWarn) ? '600' : '400' }}>
              WIP {tasks.length}/{WIP_LIMIT}
            </Text>
          )}
          {col === 'done' && (
            <Pressable onPress={() => setCollapsed(!collapsed)}>
              <Text style={{ fontSize: 14, color: C.textSecondary }}>{collapsed ? '▶' : '▼'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Column body */}
      {!collapsed && (
        <ScrollView style={bodyStyle} contentContainerStyle={{ gap: 8 }}>
          {tasks.length === 0 ? (
            <View style={{ paddingVertical: 28, paddingHorizontal: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: C.textTertiary, fontStyle: 'italic' }}>No tasks</Text>
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
        <View style={{ ...bodyStyle, padding: 12, alignItems: 'center' }}>
          <Pressable onPress={() => setCollapsed(false)}>
            <Text style={{ fontSize: 12, color: C.textTertiary }}>Click to expand {tasks.length} done tasks</Text>
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
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          paddingVertical: 4, paddingHorizontal: 6,
          borderTopWidth: i > 0 ? 1 : 0, borderTopColor: C.border,
          marginTop: i > 0 ? 4 : 0,
        }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: wsColor }} />
          <Text style={{ fontSize: 10, fontWeight: '600', color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {wsName}
          </Text>
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

function AgentSwimlane({ agentName, agent, tasks, allTasks, highlightedTask, onAgentHover, onAgentLeave, onAgentClick }: AgentSwimlaneProps) {
  const isActive = agent?.status === 'active' || agent?.status === 'running';

  return (
    <View style={{ backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' }}>
      {/* Swimlane header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.02)', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable
          onHoverIn={(e) => onAgentHover(agentName, e.target as HTMLElement)}
          onHoverOut={onAgentLeave}
          onPress={() => onAgentClick(agentName)}
          style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: isActive ? C.brand : C.steel, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as const }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>
            {agentName.slice(0, 2).toUpperCase()}
          </Text>
        </Pressable>
        <Text style={{ fontSize: 12, fontWeight: '600', color: C.textPrimary, flex: 1 }}>{agentName}</Text>
        <Text style={{ fontSize: 11, color: C.textSecondary }}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</Text>
      </View>

      {/* Swimlane cards */}
      <View style={{ padding: 6, gap: 6 }}>
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
