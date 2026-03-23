import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import type { DashboardData, SessionDetailData, SessionTurn, SessionToolCall, SubagentSummary } from '../types.js';
import { C, palette, semantic, component } from '../components/shared/colors.js';
import { statusColor } from '../utils/semantic-colors.js';
import { fmtTime, fmtTimestamp, fmtDuration, fmtGap } from '../utils/formatting.js';
import {
  TimeSyncProvider,
  SessionSidebar,
  ActivityMinimap,
  ToolCallRow as ToolCallRowMolecule,
  GapIndicator as GapIndicatorMolecule,
  ConversationTurn,
} from '../components/session/index.js';
import type {
  ToolBadgeType,
  TimelineDotType,
  MiniStatusOutcome,
  TurnSummaryCardProps,
} from '../components/session/index.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionDetailViewProps {
  sessionId: string;
  dashboard: DashboardData | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAP_THRESHOLD_MS = 10 * 60 * 1000;

const TOOL_BADGE_MAP: Record<string, { letter: string; bg: string; fg: string }> = {
  Read:  { letter: 'R', bg: semantic.tool.read.bg,  fg: semantic.tool.read.fg },
  Write: { letter: 'W', bg: semantic.tool.write.bg, fg: semantic.tool.write.fg },
  Edit:  { letter: 'E', bg: semantic.tool.edit.bg,  fg: semantic.tool.edit.fg },
  Bash:  { letter: '$', bg: semantic.tool.bash.bg,  fg: semantic.tool.bash.fg },
  Grep:  { letter: 'G', bg: semantic.tool.grep.bg,  fg: semantic.tool.grep.fg },
  Glob:  { letter: 'G', bg: semantic.tool.glob.bg,  fg: semantic.tool.glob.fg },
  Task:  { letter: 'T', bg: semantic.tool.agent.bg, fg: semantic.tool.agent.fg },
  Agent: { letter: 'A', bg: semantic.tool.agent.bg, fg: semantic.tool.agent.fg },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolBadgeInfo(toolName: string): { letter: string; bg: string; fg: string } {
  return TOOL_BADGE_MAP[toolName] ?? { letter: toolName.charAt(0).toUpperCase(), bg: palette.gray.dim15, fg: C.textTertiary };
}

function groupToolCalls(calls: SessionToolCall[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const c of calls) {
    map.set(c.toolName, (map.get(c.toolName) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function totalDurationMs(calls: SessionToolCall[]): number {
  return calls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
}

function matchesSearch(turn: SessionTurn, query: string): boolean {
  const q = query.toLowerCase();
  if (turn.userMessage.toLowerCase().includes(q)) return true;
  if (turn.assistantResponse.toLowerCase().includes(q)) return true;
  for (const tc of turn.toolCalls) {
    if (tc.toolName.toLowerCase().includes(q)) return true;
    if (tc.errorMessage?.toLowerCase().includes(q)) return true;
  }
  return false;
}

/** Map tool name to the ToolBadgeType atom key. */
function toBadgeType(toolName: string): ToolBadgeType {
  const key = toolName.toLowerCase();
  if (key === 'read') return 'read';
  if (key === 'write') return 'write';
  if (key === 'edit') return 'edit';
  if (key === 'bash') return 'bash';
  if (key === 'grep') return 'grep';
  if (key === 'glob') return 'glob';
  if (key === 'agent' || key === 'task') return 'agent';
  return 'bash'; // fallback
}

/** Map tool name to the ToolPill type key. */
function toPillType(toolName: string): string | undefined {
  const key = toolName.toLowerCase();
  if (key === 'read' || key === 'grep' || key === 'glob') return 'read';
  if (key === 'write' || key === 'edit') return 'write';
  if (key === 'bash') return 'bash';
  if (key === 'agent' || key === 'task') return 'agent';
  return undefined;
}

/** Map tool call outcome to TimelineDotType. */
function toDotType(call: SessionToolCall): TimelineDotType {
  if (call.agentId != null) return 'agent';
  if (call.outcome === 'error') return 'err';
  return 'ok';
}

/** Map tool call outcome to MiniStatusOutcome. */
function toStatusOutcome(call: SessionToolCall): MiniStatusOutcome {
  if (call.outcome === 'error') return 'error';
  if (call.outcome === 'pending') return 'pending';
  return 'success';
}

/** Build TurnSummaryCardProps from a list of tool calls. */
function buildSummaryProps(
  calls: SessionToolCall[],
  expanded: boolean,
  onToggle: () => void,
): TurnSummaryCardProps | undefined {
  if (calls.length === 0) return undefined;
  const errorCount = calls.filter(c => c.outcome === 'error').length;
  const groups = groupToolCalls(calls);
  const dur = totalDurationMs(calls);
  return {
    callCount: calls.length,
    errorCount,
    duration: fmtDuration(dur),
    pills: groups.map(g => ({
      label: `${g.name}${g.count > 1 ? ` x${g.count}` : ''}`,
      type: toPillType(g.name),
    })),
    hasErrors: errorCount > 0,
    onToggleExpand: onToggle,
    expanded,
  };
}

// ---------------------------------------------------------------------------
// Sub-components: Header
// ---------------------------------------------------------------------------

function SessionHeader({ data, searchQuery, onSearchChange }: {
  data: SessionDetailData;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const { session } = data;
  const sessionStatusColor = statusColor(session.status);

  return (
    <View style={s.header}>
      <View style={s.headerLeft}>
        <Pressable onPress={() => { window.location.hash = '#sessions'; }} style={s.backBtn}>
          <Text style={s.backBtnText}>← Sessions</Text>
        </Pressable>
        <View style={s.headerDivider} />
        <Text style={s.headerTitle}>{session.displayId}</Text>
        <View style={[s.statusBadge, { backgroundColor: `${sessionStatusColor}1A`, borderColor: `${sessionStatusColor}40` }]}>
          <View style={[s.statusDot, { backgroundColor: sessionStatusColor }]} />
          <Text style={[s.statusText, { color: sessionStatusColor }]}>{session.status}</Text>
        </View>
      </View>
      <View style={s.headerMeta}>
        {session.project && (
          <Text style={s.metaItem}>{session.project}</Text>
        )}
        <Text style={s.metaItem}>{fmtTimestamp(session.startedAt)}</Text>
        {session.agentModel && (
          <Text style={s.metaItem}>{session.agentModel}</Text>
        )}
      </View>
      <View style={s.searchWrap}>
        <TextInput
          style={s.searchInput}
          value={searchQuery}
          onChangeText={onSearchChange}
          placeholder="Search turns..."
          placeholderTextColor={C.textTertiary}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Expanded tool call rows (uses ToolCallRow molecule)
// ---------------------------------------------------------------------------

function ExpandedToolCalls({ calls }: { calls: SessionToolCall[] }) {
  return (
    <View style={s.toolCallsExpanded}>
      {calls.map(call => {
        const badge = toolBadgeInfo(call.toolName);
        const isError = call.outcome === 'error';
        const isAgent = call.agentId != null;
        const maxDur = Math.max(...calls.map(c => c.durationMs ?? 0), 1);
        const durPct = call.durationMs != null ? (call.durationMs / maxDur) * 100 : undefined;

        return (
          <ToolCallRowMolecule
            key={call.id}
            time={fmtTime(call.timestamp)}
            dotType={toDotType(call)}
            badgeType={toBadgeType(call.toolName)}
            name={call.toolName}
            path={call.inputSummary}
            durationLabel={call.durationMs != null ? fmtDuration(call.durationMs) : undefined}
            durationPct={durPct}
            durationColor={badge.fg}
            status={toStatusOutcome(call)}
            variant={isError ? 'error' : isAgent ? 'agent' : 'normal'}
            onPress={isAgent ? () => { window.location.hash = `#agents?agent=${encodeURIComponent(call.agentId!)}`; } : undefined}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: SubagentPanel
// ---------------------------------------------------------------------------

function SubagentPanel({ subagents, onClose }: {
  subagents: SubagentSummary[];
  onClose: () => void;
}) {
  return (
    <View style={s.drawerOverlay}>
      <Pressable style={s.drawerBackdrop} onPress={onClose} />
      <View style={s.drawer}>
        <View style={s.drawerHeader}>
          <Text style={s.drawerTitle}>Subagents</Text>
          <Pressable onPress={onClose} style={s.drawerClose}>
            <Text style={s.drawerCloseText}>x</Text>
          </Pressable>
        </View>
        <ScrollView style={s.drawerBody}>
          {subagents.map(sa => (
            <View key={sa.agentId} style={s.subagentRow}>
              <View style={s.subagentHeader}>
                <Pressable onPress={() => { window.location.hash = `#agents?agent=${encodeURIComponent(sa.agentId)}`; }}>
                  <Text style={[s.subagentId, s.crossLink]}>{sa.agentId}</Text>
                </Pressable>
                <View style={[s.statusBadge, { backgroundColor: sa.status === 'completed' ? `${C.success}1A` : `${C.warning}1A`, borderColor: sa.status === 'completed' ? `${C.success}40` : `${C.warning}40` }]}>
                  <Text style={[s.statusText, { color: sa.status === 'completed' ? C.success : C.warning }]}>{sa.status}</Text>
                </View>
              </View>
              {sa.model && <Text style={s.subagentMeta}>Model: {sa.model}</Text>}
              {sa.taskId && (
                <Pressable onPress={() => { window.location.hash = `#task?id=${encodeURIComponent(sa.taskId!)}`; }}>
                  <Text style={[s.subagentMeta, s.crossLink]}>Task: {sa.taskId}</Text>
                </Pressable>
              )}
              <Text style={s.subagentMeta}>
                {sa.toolCalls} tool calls · {sa.errors} errors
                {sa.durationMs != null ? ` · ${fmtDuration(sa.durationMs)}` : ''}
              </Text>
            </View>
          ))}
          {subagents.length === 0 && (
            <Text style={s.emptyText}>No subagents in this session</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SessionDetailView({ sessionId, dashboard }: SessionDetailViewProps) {
  const [data, setData] = useState<SessionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSubagents, setShowSubagents] = useState(false);
  const timelineRef = useRef<ScrollView>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiBase = window.__BRAIN_API__ ?? 'http://localhost:7800';
    fetch(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/detail`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: SessionDetailData) => {
        if (!cancelled) { setData(json); setLoading(false); }
      })
      .catch(err => {
        if (!cancelled) { setError(String(err)); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  const toggleTurn = useCallback((index: number) => {
    setExpandedTurns(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const turnsWithGaps = useMemo(() => {
    if (!data) return [];
    const items: Array<{ type: 'turn'; turn: SessionTurn } | { type: 'gap'; ms: number }> = [];
    for (let i = 0; i < data.turns.length; i++) {
      if (i > 0) {
        const prevTs = new Date(data.turns[i - 1].timestamp).getTime();
        const currTs = new Date(data.turns[i].timestamp).getTime();
        const gap = currTs - prevTs;
        if (gap >= GAP_THRESHOLD_MS) {
          items.push({ type: 'gap', ms: gap });
        }
      }
      items.push({ type: 'turn', turn: data.turns[i] });
    }
    return items;
  }, [data]);

  if (loading) {
    return (
      <View style={s.centered}>
        <Text style={s.loadingText}>Loading session detail...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={s.centered}>
        <Text style={s.errorTitle}>Failed to load session</Text>
        <Text style={s.errorDetail}>{error ?? 'No data returned'}</Text>
        <Pressable onPress={() => { window.location.hash = '#sessions'; }} style={s.backBtnLarge}>
          <Text style={s.backBtnText}>← Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <View style={s.root}>
      <SessionHeader data={data} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <TimeSyncProvider
        initialTimestamp={data.session.startedAt}
        timelineRef={timelineRef as unknown as React.RefObject<HTMLElement | null>}
      >
        <View style={s.body}>
          <View style={s.minimapColumn}>
            <ActivityMinimap data={data} timelineRef={timelineRef} height={600} />
          </View>
          <ScrollView ref={timelineRef} style={s.timeline} contentContainerStyle={s.timelineContent}>
            {turnsWithGaps.map((item, i) => {
              if (item.type === 'gap') {
                return <GapIndicatorMolecule key={`gap-${i}`} label={fmtGap(item.ms)} />;
              }
              const { turn } = item;
              const dimmed = hasSearch && !matchesSearch(turn, searchQuery.trim());
              const expanded = expandedTurns.has(turn.index);
              const summaryProps = buildSummaryProps(
                turn.toolCalls,
                expanded,
                () => toggleTurn(turn.index),
              );
              return (
                <ConversationTurn
                  key={turn.index}
                  userMessage={turn.userMessage}
                  userTimestamp={fmtTime(turn.timestamp)}
                  assistantResponse={turn.assistantResponse}
                  assistantTimestamp={fmtTime(turn.timestamp)}
                  hasErrors={turn.toolCalls.some(c => c.outcome === 'error')}
                  summary={summaryProps}
                  dimmed={dimmed}
                >
                  {expanded && turn.toolCalls.length > 0 ? (
                    <ExpandedToolCalls calls={turn.toolCalls} />
                  ) : null}
                </ConversationTurn>
              );
            })}
            {data.turns.length === 0 && (
              <View style={s.centered}>
                <Text style={s.emptyText}>No conversation turns in this session</Text>
              </View>
            )}
          </ScrollView>
          <ScrollView style={s.sidebarScroll}>
            <SessionSidebar data={data} />
          </ScrollView>
        </View>
      </TimeSyncProvider>
      {showSubagents && (
        <SubagentPanel subagents={data.subagents} onClose={() => setShowSubagents(false)} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles (layout-level only — card/component styles are in organisms/molecules)
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, height: '100%' as unknown as number },
  body: { flex: 1, flexDirection: 'row' as const, height: '100%' as unknown as number },
  minimapColumn: { width: 8, position: 'relative' as const, flexShrink: 0 },
  sidebarScroll: {
    width: 180,
    flexShrink: 0,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    backgroundColor: C.surface1,
  },

  // Centered states
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  loadingText: { fontSize: 14, color: C.textSecondary },
  errorTitle: { fontSize: 18, fontWeight: '600', color: C.error },
  errorDetail: { fontSize: 13, color: C.textTertiary },
  emptyText: { fontSize: 13, color: C.textTertiary, fontStyle: 'italic' },

  // Header
  header: {
    backgroundColor: C.surface1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDivider: { width: 1, height: 16, backgroundColor: C.border },
  headerTitle: { fontSize: 15, fontWeight: '700', color: C.textPrimary, fontFamily: "'Space Grotesk', sans-serif" },
  headerMeta: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  metaItem: { fontSize: 12, color: C.textTertiary, fontFamily: "'Space Grotesk', sans-serif" },
  searchWrap: { marginLeft: 'auto' as unknown as number },
  searchInput: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    color: C.textPrimary,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    width: 200,
    outlineStyle: 'none' as never,
  },

  // Status badge (header)
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', fontFamily: "'Space Grotesk', sans-serif" },

  // Back buttons
  backBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  backBtnLarge: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, marginTop: 8 },
  backBtnText: { fontSize: 12, color: C.textTertiary, fontWeight: '500' },

  // Timeline
  timeline: { flex: 1 },
  timelineContent: { padding: 20, paddingBottom: 80, maxWidth: 900 },

  // Expanded tool calls
  toolCallsExpanded: { paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border, marginTop: 6, gap: 2 },

  // Subagent drawer
  drawerOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    zIndex: 100,
  },
  drawerBackdrop: { flex: 1, backgroundColor: component.drawer.backdrop },
  drawer: {
    width: 340,
    backgroundColor: C.surface1,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    flexDirection: 'column' as const,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  drawerTitle: { fontSize: 14, fontWeight: '700', color: C.textPrimary, fontFamily: "'Space Grotesk', sans-serif" },
  drawerClose: { padding: 4 },
  drawerCloseText: { fontSize: 14, color: C.textTertiary, fontWeight: '700' },
  drawerBody: { flex: 1, padding: 14 },
  subagentRow: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  subagentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subagentId: { fontSize: 13, fontWeight: '600', color: C.textPrimary, fontFamily: "'Space Grotesk', sans-serif" },
  subagentMeta: { fontSize: 11, color: C.textTertiary },

  // Cross-view navigation links
  crossLink: { color: C.brand },
});
