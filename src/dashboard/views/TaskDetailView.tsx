import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { DashboardData, DashboardTask, DashboardStageTransition } from '../types.js';
import { C } from '../components/shared/colors.js';
import { columnColor, priorityColor } from '../utils/semantic-colors.js';
import { Section } from '../components/shared/Section.js';

interface TaskDetailViewProps {
  taskId: string;
  dashboard: DashboardData | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colLabel(col: string): string {
  const MAP: Record<string, string> = {
    blocked: 'Blocked', ready: 'Ready', inprogress: 'In Progress',
    review: 'Review', done: 'Done',
  };
  return MAP[col] ?? col;
}

function fmtTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function buildUpstream(taskId: string, tasks: DashboardTask[], depth: number, visited: Set<string>): DepNode[] {
  if (depth <= 0 || visited.has(taskId)) return [];
  visited.add(taskId);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return [];
  return task.deps.map(depId => {
    const dep = tasks.find(t => t.id === depId);
    return { id: depId, title: dep?.title, col: dep?.col, children: buildUpstream(depId, tasks, depth - 1, new Set(visited)) };
  });
}

function buildDownstream(taskId: string, tasks: DashboardTask[], depth: number, visited: Set<string>): DepNode[] {
  if (depth <= 0 || visited.has(taskId)) return [];
  visited.add(taskId);
  return tasks
    .filter(t => t.deps.includes(taskId))
    .map(t => ({ id: t.id, title: t.title, col: t.col, children: buildDownstream(t.id, tasks, depth - 1, new Set(visited)) }));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <View style={s.infoValue}>{children}</View>
    </View>
  );
}

function ColBadge({ col }: { col: string }) {
  const color = columnColor(col);
  return (
    <View style={[s.badge, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
      <View style={[s.badgeDot, { backgroundColor: color }]} />
      <Text style={[s.badgeText, { color }]}>{colLabel(col)}</Text>
    </View>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const color = priorityColor(priority);
  return (
    <View style={[s.badge, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
      <Text style={[s.badgeText, { color }]}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dependency tree
// ---------------------------------------------------------------------------

interface DepNode { id: string; title?: string; col?: string; children: DepNode[] }

function DepTreeNode({ node, depth }: { node: DepNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const color = columnColor(node.col ?? '');
  const hasChildren = node.children.length > 0;
  const indent = depth * 20;

  return (
    <View>
      <View style={[s.depTreeRow, { marginLeft: indent }]}>
        <View style={[s.depTreeConnector, { borderColor: C.border }]} />
        <Text style={[s.depIcon, { color, width: 14 }]}>
          {node.col === 'done' ? '✓' : node.col === 'blocked' ? '✗' : '○'}
        </Text>
        <Pressable onPress={() => { window.location.hash = `#task?id=${encodeURIComponent(node.id)}`; }}>
          <Text style={[s.depId, s.link]}>{node.id}</Text>
        </Pressable>
        {node.title && <Text style={s.depTitle} numberOfLines={1}>{node.title}</Text>}
        {node.col && <ColBadge col={node.col} />}
        {hasChildren && (
          <Pressable onPress={() => setExpanded(e => !e)} style={s.expandBtn}>
            <Text style={s.expandBtnText}>{expanded ? '−' : '+'}</Text>
          </Pressable>
        )}
      </View>
      {expanded && node.children.map(child => (
        <DepTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </View>
  );
}

function DepTreeSection({ label, nodes }: { label: string; nodes: DepNode[] }) {
  const [collapsed, setCollapsed] = useState(false);
  if (nodes.length === 0) return null;
  return (
    <View style={s.depTreeSection}>
      <Pressable onPress={() => setCollapsed(c => !c)} style={s.depTreeSectionHeader}>
        <Text style={s.depTreeSectionLabel}>{label} ({nodes.length})</Text>
        <Text style={s.expandBtnText}>{collapsed ? '+' : '−'}</Text>
      </Pressable>
      {!collapsed && nodes.map(node => <DepTreeNode key={node.id} node={node} depth={0} />)}
    </View>
  );
}

function DepTree({ taskId, tasks }: { taskId: string; tasks: DashboardTask[] }) {
  const upstream = buildUpstream(taskId, tasks, 3, new Set());
  const downstream = buildDownstream(taskId, tasks, 3, new Set());

  if (upstream.length === 0 && downstream.length === 0) {
    return <Text style={s.emptyText}>No dependency relationships.</Text>;
  }

  return (
    <View style={s.depTreeContainer}>
      <DepTreeSection label="Upstream" nodes={upstream} />
      <DepTreeSection label="Downstream" nodes={downstream} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Note text
// ---------------------------------------------------------------------------

function NoteText({ description }: { description: string }) {
  const isLong = description.length > 500;
  const [collapsed, setCollapsed] = useState(isLong);

  return (
    <View style={s.noteTextContainer}>
      <Pressable onPress={() => setCollapsed(c => !c)} style={s.noteTextToggle}>
        <Text style={s.noteTextToggleLabel}>{collapsed ? 'Show note content' : 'Collapse'}</Text>
      </Pressable>
      {!collapsed && (
        <ScrollView style={s.noteTextScroll} nestedScrollEnabled>
          <Text style={s.noteTextContent}>{description}</Text>
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stage history timeline
// ---------------------------------------------------------------------------

function StageTimeline({ transitions }: { transitions: DashboardStageTransition[] }) {
  if (transitions.length === 0) {
    return <Text style={s.emptyText}>No stage transitions recorded.</Text>;
  }

  return (
    <View style={s.timeline}>
      {transitions.map((t, i) => (
        <View key={i} style={s.timelineRow}>
          <View style={s.timelineLine}>
            <View style={s.timelineDot} />
            {i < transitions.length - 1 && <View style={s.timelineConnector} />}
          </View>
          <View style={s.timelineContent}>
            <Text style={s.timelineTs}>{fmtTimestamp(t.timestamp)}</Text>
            <View style={s.timelineStages}>
              <Text style={[s.timelineStage, { color: columnColor(t.fromState) }]}>{colLabel(t.fromState)}</Text>
              <Text style={s.timelineArrow}>→</Text>
              <Text style={[s.timelineStage, { color: columnColor(t.toState) }]}>{colLabel(t.toState)}</Text>
            </View>
            {t.agentId && (
              <Pressable onPress={() => { window.location.hash = `#agents?agent=${encodeURIComponent(t.agentId!)}`; }}>
                <Text style={[s.timelineAgent, s.link]}>via {t.agentId}</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function TaskDetailView({ taskId, dashboard }: TaskDetailViewProps) {
  const tasks = dashboard?.tasks ?? [];
  const task = tasks.find(t => t.id === taskId);

  const handleBack = () => { window.history.back(); };

  if (!task) {
    return (
      <View style={s.notFound}>
        <Text style={s.notFoundIcon}>⊘</Text>
        <Text style={s.notFoundTitle}>Task not found</Text>
        <Text style={s.notFoundSub}>No task with ID "{taskId}" in current data.</Text>
        <Pressable onPress={handleBack} style={s.backBtn}>
          <Text style={s.backBtnText}>← Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const workstreamInfo = dashboard?.workstreams[task.workstream];
  const taskHistory = (dashboard?.stageHistory ?? []).filter(t => t.taskId === taskId);
  const agent = task.agent ? (dashboard?.agents ?? []).find(a => a.name === task.agent) : null;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.container}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.taskId}>{task.id}</Text>
          <PriorityBadge priority={task.priority} />
          <ColBadge col={task.col} />
        </View>
        <Pressable onPress={handleBack} style={s.backBtn}>
          <Text style={s.backBtnText}>← Back</Text>
        </Pressable>
      </View>

      <Text style={s.title}>{task.title}</Text>
      {workstreamInfo && (
        <View style={s.workstreamRow}>
          <View style={s.workstreamBadge}>
            <Text style={s.workstreamText}>{task.workstream} · {workstreamInfo.name}</Text>
          </View>
        </View>
      )}

      <View style={s.infoGrid}>
        <View style={s.infoCol}>
          <InfoRow label="Agent">
            {task.agent ? (
              <Pressable onPress={() => { window.location.hash = `#agents?agent=${encodeURIComponent(task.agent!)}`; }}>
                <View style={s.agentRow}>
                  <View style={s.agentAvatar}>
                    <Text style={s.agentAvatarText}>{task.agent.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <Text style={[s.infoText, s.link]}>{task.agent}</Text>
                </View>
              </Pressable>
            ) : <Text style={s.infoTextDim}>Unassigned</Text>}
          </InfoRow>
          <InfoRow label="Branch">
            {task.branch
              ? <View style={s.monoBadge}><Text style={s.monoText}>{task.branch}</Text></View>
              : <Text style={s.infoTextDim}>—</Text>}
          </InfoRow>
        </View>
        <View style={s.infoCol}>
          <InfoRow label="Priority"><PriorityBadge priority={task.priority} /></InfoRow>
          <InfoRow label="PR">
            {task.pr
              ? <Text style={[s.infoText, s.link, { fontFamily: 'monospace' }]}>#{task.pr.url.split('/').pop()} ({task.pr.reviewStatus})</Text>
              : <Text style={s.infoTextDim}>—</Text>}
          </InfoRow>
        </View>
      </View>

      <Section variant="inline" title="Dependencies">
        <DepTree taskId={taskId} tasks={tasks} />
      </Section>

      {task.description && (
        <Section variant="inline" title="Note Content">
          <NoteText description={task.description} />
        </Section>
      )}

      <Section variant="inline" title="Stage History">
        <StageTimeline transitions={taskHistory} />
      </Section>

      {agent && (
        <Section variant="inline" title="Related">
          <View style={s.relatedRow}>
            <Text style={s.relatedLabel}>Agent</Text>
            <Pressable onPress={() => { window.location.hash = `#agents?agent=${encodeURIComponent(agent.name)}`; }}>
              <Text style={[s.infoText, s.link]}>{agent.name} ({agent.status})</Text>
            </Pressable>
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { padding: 24, maxWidth: 900, gap: 20 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskId: { fontSize: 22, fontWeight: '700', color: C.brand, fontFamily: 'Space Grotesk, monospace' },

  title: { fontSize: 20, fontWeight: '600', color: C.textPrimary, lineHeight: 28 },

  workstreamRow: { flexDirection: 'row' },
  workstreamBadge: { backgroundColor: 'rgba(64,109,135,0.15)', borderWidth: 1, borderColor: 'rgba(64,109,135,0.3)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  workstreamText: { fontSize: 12, color: C.steel, fontWeight: '500' },

  infoGrid: { flexDirection: 'row', gap: 24, flexWrap: 'wrap' },
  infoCol: { flex: 1, minWidth: 200, gap: 12, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 16 },
  infoRow: { gap: 4 },
  infoLabel: { fontSize: 11, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { flexDirection: 'row', alignItems: 'center' },
  infoText: { fontSize: 14, color: C.textPrimary },
  infoTextDim: { fontSize: 14, color: C.textTertiary },
  link: { color: C.brand },

  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  agentAvatarText: { fontSize: 10, fontWeight: '700', color: '#fff' },

  monoBadge: { backgroundColor: C.surface3, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  monoText: { fontSize: 12, color: C.textSecondary, fontFamily: 'monospace' },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '500' },

  // Dep tree
  depTreeContainer: { gap: 12 },
  depTreeSection: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, gap: 8 },
  depTreeSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  depTreeSectionLabel: { fontSize: 12, fontWeight: '600', color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  depTreeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  depTreeConnector: { width: 12, height: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  expandBtn: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 2, backgroundColor: C.surface3, borderRadius: 4 },
  expandBtnText: { fontSize: 12, color: C.textTertiary, fontWeight: '600' },

  depIcon: { fontSize: 13, textAlign: 'center' },
  depId: { fontSize: 13, fontWeight: '600', fontFamily: 'Space Grotesk, monospace' },
  depTitle: { flex: 1, fontSize: 13, color: C.textSecondary },

  // Note text
  noteTextContainer: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' },
  noteTextToggle: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  noteTextToggleLabel: { fontSize: 12, color: C.brand, fontWeight: '500' },
  noteTextScroll: { maxHeight: 400 },
  noteTextContent: { fontSize: 13, color: C.textSecondary, fontFamily: 'monospace', padding: 14, lineHeight: 20, whiteSpace: 'pre-wrap' as never },

  // Timeline
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineLine: { width: 16, alignItems: 'center', paddingTop: 4 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand, flexShrink: 0 },
  timelineConnector: { width: 2, flex: 1, backgroundColor: C.border, marginTop: 4, marginBottom: 0 },
  timelineContent: { flex: 1, paddingBottom: 18, gap: 3 },
  timelineTs: { fontSize: 11, color: C.textTertiary },
  timelineStages: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timelineStage: { fontSize: 13, fontWeight: '500' },
  timelineArrow: { fontSize: 13, color: C.textTertiary },
  timelineAgent: { fontSize: 11, color: C.textTertiary },

  relatedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  relatedLabel: { fontSize: 12, color: C.textTertiary, width: 50 },

  backBtn: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  backBtnText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  notFoundIcon: { fontSize: 40, color: C.textTertiary },
  notFoundTitle: { fontSize: 18, fontWeight: '600', color: C.textSecondary },
  notFoundSub: { fontSize: 14, color: C.textTertiary },

  emptyText: { fontSize: 13, color: C.textTertiary },
});
