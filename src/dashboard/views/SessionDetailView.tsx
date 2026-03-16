import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import type { DashboardData, SessionDetailData, SessionTurn, SessionToolCall, SubagentSummary } from '../types.js';
import { C } from '../components/shared/colors.js';

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

const TEXT_TRUNCATE_LIMIT = 500;
const GAP_THRESHOLD_MS = 10 * 60 * 1000;

const TOOL_BADGE_MAP: Record<string, { letter: string; bg: string; fg: string }> = {
  Read:  { letter: 'R', bg: 'rgba(25,101,176,0.2)', fg: '#7BAFDE' },
  Write: { letter: 'W', bg: 'rgba(20,184,166,0.2)', fg: C.success },
  Edit:  { letter: 'E', bg: 'rgba(244,167,54,0.2)', fg: C.warning },
  Bash:  { letter: '$', bg: 'rgba(107,114,128,0.2)', fg: C.textSecondary },
  Grep:  { letter: 'G', bg: 'rgba(130,60,160,0.2)', fg: '#C084FC' },
  Glob:  { letter: 'G', bg: 'rgba(130,60,160,0.2)', fg: '#C084FC' },
  Task:  { letter: 'T', bg: 'rgba(255,121,0,0.12)', fg: C.brand },
  Agent: { letter: 'A', bg: 'rgba(255,121,0,0.12)', fg: C.brand },
};

const TOOL_PILL_MAP: Record<string, { bg: string; fg: string }> = {
  Read:  { bg: 'rgba(25,101,176,0.2)', fg: '#7BAFDE' },
  Write: { bg: 'rgba(20,184,166,0.2)', fg: C.success },
  Edit:  { bg: 'rgba(244,167,54,0.15)', fg: C.warning },
  Bash:  { bg: 'rgba(107,114,128,0.2)', fg: C.textSecondary },
  Grep:  { bg: 'rgba(130,60,160,0.2)', fg: '#C084FC' },
  Glob:  { bg: 'rgba(130,60,160,0.2)', fg: '#C084FC' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtGap(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m gap`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m gap`;
}

function toolBadgeInfo(toolName: string): { letter: string; bg: string; fg: string } {
  return TOOL_BADGE_MAP[toolName] ?? { letter: toolName.charAt(0).toUpperCase(), bg: 'rgba(107,114,128,0.15)', fg: C.textTertiary };
}

function toolPillInfo(toolName: string): { bg: string; fg: string } {
  return TOOL_PILL_MAP[toolName] ?? { bg: 'rgba(107,114,128,0.1)', fg: C.textTertiary };
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

function renderSimpleMarkdown(text: string): React.ReactNode[] {
  return text.split('\n\n').map((para, i) => {
    const parts: React.ReactNode[] = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    const codeRegex = /`([^`]+)`/g;
    let last = 0;
    const combined = [...para.matchAll(boldRegex), ...para.matchAll(codeRegex)]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    if (combined.length === 0) {
      parts.push(<Text key={`p${i}`} style={s.claudeParaText}>{para}</Text>);
    } else {
      for (const match of combined) {
        const idx = match.index ?? 0;
        if (idx > last) {
          parts.push(<Text key={`t${i}-${last}`} style={s.claudeParaText}>{para.slice(last, idx)}</Text>);
        }
        if (match[0].startsWith('**')) {
          parts.push(<Text key={`b${i}-${idx}`} style={s.claudeBoldText}>{match[1]}</Text>);
        } else {
          parts.push(<Text key={`c${i}-${idx}`} style={s.claudeCodeText}>{match[1]}</Text>);
        }
        last = idx + match[0].length;
      }
      if (last < para.length) {
        parts.push(<Text key={`e${i}`} style={s.claudeParaText}>{para.slice(last)}</Text>);
      }
    }
    return (
      <View key={i} style={i > 0 ? s.claudeParagraph : undefined}>
        <Text>{parts}</Text>
      </View>
    );
  });
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
  const statusColor = session.status === 'active' ? C.success
    : session.status === 'completed' ? C.success
    : C.textTertiary;

  return (
    <View style={s.header}>
      <View style={s.headerLeft}>
        <Pressable onPress={() => { window.location.hash = '#sessions'; }} style={s.backBtn}>
          <Text style={s.backBtnText}>← Sessions</Text>
        </Pressable>
        <View style={s.headerDivider} />
        <Text style={s.headerTitle}>{session.displayId}</Text>
        <View style={[s.statusBadge, { backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}40` }]}>
          <View style={[s.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[s.statusText, { color: statusColor }]}>{session.status}</Text>
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
// Sub-components: Tool pills
// ---------------------------------------------------------------------------

function ToolPills({ groups }: { groups: Array<{ name: string; count: number }> }) {
  return (
    <View style={s.toolPills}>
      {groups.map(({ name, count }) => {
        const { bg, fg } = toolPillInfo(name);
        return (
          <View key={name} style={[s.toolPill, { backgroundColor: bg }]}>
            <Text style={[s.toolPillText, { color: fg }]}>
              {name} {count > 1 ? `x${count}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Tool call row
// ---------------------------------------------------------------------------

function ToolCallRow({ call }: { call: SessionToolCall }) {
  const [showError, setShowError] = useState(false);
  const badge = toolBadgeInfo(call.toolName);
  const isError = call.outcome === 'error';
  const isAgent = call.agentId != null;

  return (
    <View style={[s.toolRow, isError && s.toolRowError]}>
      <Text style={s.toolRowTime}>{fmtTime(call.timestamp)}</Text>
      <View style={[s.toolBadge, { backgroundColor: badge.bg }]}>
        <Text style={[s.toolBadgeLetter, { color: badge.fg }]}>{badge.letter}</Text>
      </View>
      <Text style={[s.toolName, { color: badge.fg }]}>{call.toolName}</Text>
      <Text style={s.toolPath} numberOfLines={1}>{call.inputSummary}</Text>
      {call.durationMs != null && (
        <View style={s.durWrap}>
          <View style={[s.durBar, { width: Math.min(60, Math.max(2, call.durationMs / 100)), backgroundColor: badge.fg }]} />
          <Text style={s.durLabel}>{fmtDuration(call.durationMs)}</Text>
        </View>
      )}
      <View style={[s.statusDotSmall, { backgroundColor: isError ? C.error : C.success }]} />
      {isAgent && (
        <View style={s.agentChip}>
          <Text style={s.agentChipText}>Spawned subagent</Text>
        </View>
      )}
      {isError && call.errorMessage && (
        <Pressable onPress={() => setShowError(e => !e)}>
          <Text style={s.errToggle}>{showError ? 'Hide error' : 'Show error'}</Text>
        </Pressable>
      )}
      {showError && call.errorMessage && (
        <View style={s.errBlock}>
          <Text style={s.errBlockText}>{call.errorMessage}</Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Tool summary card
// ---------------------------------------------------------------------------

function ToolSummaryCard({ calls, expanded, onToggle }: {
  calls: SessionToolCall[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (calls.length === 0) return null;

  const errorCount = calls.filter(c => c.outcome === 'error').length;
  const groups = groupToolCalls(calls);
  const dur = totalDurationMs(calls);

  return (
    <View style={s.toolSection}>
      <Pressable onPress={onToggle} style={[s.summaryCard, errorCount > 0 && s.summaryCardError]}>
        <View style={s.summaryTop}>
          <Text style={s.summaryStats}>
            <Text style={s.summaryCallCount}>{calls.length} calls</Text>
            {errorCount > 0 && <Text style={s.summaryErrorCount}> · {errorCount} errors</Text>}
            <Text style={s.summaryDur}> · {fmtDuration(dur)}</Text>
          </Text>
          <Text style={s.expandBtn}>{expanded ? '−' : '+'}</Text>
        </View>
        <ToolPills groups={groups} />
      </Pressable>
      {expanded && (
        <View style={s.toolCallsExpanded}>
          {calls.map(call => <ToolCallRow key={call.id} call={call} />)}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: TruncatableText
// ---------------------------------------------------------------------------

function TruncatableText({ text, style, limit }: {
  text: string;
  style: object;
  limit?: number;
}) {
  const max = limit ?? TEXT_TRUNCATE_LIMIT;
  const needsTruncate = text.length > max;
  const [expanded, setExpanded] = useState(false);

  const displayed = !needsTruncate || expanded ? text : text.slice(0, max) + '...';
  return (
    <View>
      <Text style={style}>{displayed}</Text>
      {needsTruncate && (
        <Pressable onPress={() => setExpanded(e => !e)}>
          <Text style={s.showMore}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: UserMessage
// ---------------------------------------------------------------------------

function UserMessage({ text, timestamp }: { text: string; timestamp: string }) {
  return (
    <View style={s.userCard}>
      <View style={s.userHeader}>
        <Text style={s.userIcon}>{'💬'}</Text>
        <Text style={s.userLabel}>USER</Text>
        <Text style={s.userTime}>{fmtTime(timestamp)}</Text>
      </View>
      <TruncatableText text={text} style={s.userText} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: ClaudeResponse
// ---------------------------------------------------------------------------

function ClaudeResponseText({ text }: { text: string }) {
  const needsTruncate = text.length > TEXT_TRUNCATE_LIMIT;
  const [expanded, setExpanded] = useState(false);

  const displayed = !needsTruncate || expanded ? text : text.slice(0, TEXT_TRUNCATE_LIMIT);

  return (
    <View>
      <View style={!expanded && needsTruncate ? s.claudeTextTruncated : undefined}>
        {renderSimpleMarkdown(displayed)}
      </View>
      {needsTruncate && (
        <Pressable onPress={() => setExpanded(e => !e)}>
          <Text style={s.claudeShowMore}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ClaudeResponse({ text, timestamp, toolCalls, turnExpanded, onToggleTools }: {
  text: string;
  timestamp: string;
  toolCalls: SessionToolCall[];
  turnExpanded: boolean;
  onToggleTools: () => void;
}) {
  const hasErrors = toolCalls.some(c => c.outcome === 'error');
  return (
    <View style={[s.claudeCard, hasErrors && s.claudeCardError]}>
      <View style={s.claudeHeader}>
        <Text style={s.claudeIcon}>{'🤖'}</Text>
        <Text style={s.claudeLabel}>CLAUDE</Text>
        <Text style={s.claudeTime}>{fmtTime(timestamp)}</Text>
      </View>
      {text.length > 0 && <ClaudeResponseText text={text} />}
      <ToolSummaryCard
        calls={toolCalls}
        expanded={turnExpanded}
        onToggle={onToggleTools}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: ConversationTurn
// ---------------------------------------------------------------------------

function ConversationTurn({ turn, expanded, onToggle, dimmed }: {
  turn: SessionTurn;
  expanded: boolean;
  onToggle: () => void;
  dimmed: boolean;
}) {
  return (
    <View style={[s.turn, dimmed && s.turnDimmed]}>
      {turn.userMessage.length > 0 && (
        <UserMessage text={turn.userMessage} timestamp={turn.timestamp} />
      )}
      {(turn.assistantResponse.length > 0 || turn.toolCalls.length > 0) && (
        <ClaudeResponse
          text={turn.assistantResponse}
          timestamp={turn.timestamp}
          toolCalls={turn.toolCalls}
          turnExpanded={expanded}
          onToggleTools={onToggle}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: GapIndicator
// ---------------------------------------------------------------------------

function GapIndicator({ ms }: { ms: number }) {
  return (
    <View style={s.gap}>
      <View style={s.gapLine} />
      <Text style={s.gapLabel}>{fmtGap(ms)}</Text>
      <View style={s.gapLine} />
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
                <Text style={s.subagentId}>{sa.agentId}</Text>
                <View style={[s.statusBadge, { backgroundColor: sa.status === 'completed' ? `${C.success}1A` : `${C.warning}1A`, borderColor: sa.status === 'completed' ? `${C.success}40` : `${C.warning}40` }]}>
                  <Text style={[s.statusText, { color: sa.status === 'completed' ? C.success : C.warning }]}>{sa.status}</Text>
                </View>
              </View>
              {sa.model && <Text style={s.subagentMeta}>Model: {sa.model}</Text>}
              {sa.taskId && <Text style={s.subagentMeta}>Task: {sa.taskId}</Text>}
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiBase = window.__BRAIN_API__ ?? '';
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
      <ScrollView style={s.timeline} contentContainerStyle={s.timelineContent}>
        {turnsWithGaps.map((item, i) => {
          if (item.type === 'gap') {
            return <GapIndicator key={`gap-${i}`} ms={item.ms} />;
          }
          const { turn } = item;
          const dimmed = hasSearch && !matchesSearch(turn, searchQuery.trim());
          return (
            <ConversationTurn
              key={turn.index}
              turn={turn}
              expanded={expandedTurns.has(turn.index)}
              onToggle={() => toggleTurn(turn.index)}
              dimmed={dimmed}
            />
          );
        })}
        {data.turns.length === 0 && (
          <View style={s.centered}>
            <Text style={s.emptyText}>No conversation turns in this session</Text>
          </View>
        )}
      </ScrollView>
      {showSubagents && (
        <SubagentPanel subagents={data.subagents} onClose={() => setShowSubagents(false)} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const USER_BG = 'rgba(20,50,90,0.35)';
const USER_BORDER = 'rgba(91,155,213,0.5)';
const USER_COLOR = '#5B9BD5';
const USER_TEXT_COLOR = '#7BAFDE';
const CLAUDE_BG = '#1a1400';
const CLAUDE_BORDER = 'rgba(255,121,0,0.25)';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

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
  headerTitle: { fontSize: 15, fontWeight: '700', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' },
  headerMeta: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  metaItem: { fontSize: 12, color: C.textTertiary, fontFamily: 'Space Grotesk, sans-serif' },
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

  // Status badge
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
  statusText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif' },

  // Back buttons
  backBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  backBtnLarge: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, marginTop: 8 },
  backBtnText: { fontSize: 12, color: C.textTertiary, fontWeight: '500' },

  // Timeline
  timeline: { flex: 1 },
  timelineContent: { padding: 20, paddingBottom: 80, maxWidth: 900 },

  // Conversation turn
  turn: { marginBottom: 12 },
  turnDimmed: { opacity: 0.15 },

  // User message card
  userCard: {
    backgroundColor: USER_BG,
    borderWidth: 1,
    borderColor: USER_BORDER,
    borderLeftWidth: 4,
    borderLeftColor: USER_COLOR,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  userHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  userIcon: { fontSize: 13 },
  userLabel: { fontSize: 10, fontWeight: '600', color: USER_TEXT_COLOR, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif' },
  userTime: { fontSize: 10, color: USER_TEXT_COLOR, fontFamily: 'Space Grotesk, sans-serif', marginLeft: 'auto' as unknown as number },
  userText: { fontSize: 13, lineHeight: 20, color: C.textPrimary },

  // Claude response card
  claudeCard: {
    backgroundColor: CLAUDE_BG,
    borderWidth: 1,
    borderColor: CLAUDE_BORDER,
    borderLeftWidth: 3,
    borderLeftColor: C.brand,
    borderRadius: 8,
    padding: 10,
  },
  claudeCardError: { borderLeftColor: C.error },
  claudeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  claudeIcon: { fontSize: 13 },
  claudeLabel: { fontSize: 10, fontWeight: '600', color: C.brand, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif', flex: 1 },
  claudeTime: { fontSize: 10, color: C.textTertiary, fontFamily: 'Space Grotesk, sans-serif' },
  claudeParaText: { fontSize: 13, lineHeight: 21, color: C.textPrimary },
  claudeBoldText: { fontSize: 13, lineHeight: 21, color: C.textPrimary, fontWeight: '700' },
  claudeCodeText: { fontSize: 11, color: C.textSecondary, fontFamily: 'monospace', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3 },
  claudeParagraph: { marginTop: 8 },
  claudeTextTruncated: { maxHeight: 130, overflow: 'hidden' },
  claudeShowMore: { fontSize: 11, color: C.brand, marginTop: 6, opacity: 0.8 },
  showMore: { fontSize: 11, color: USER_TEXT_COLOR, marginTop: 5, opacity: 0.8 },

  // Tool section
  toolSection: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,121,0,0.12)' },
  summaryCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,121,0,0.15)',
    borderRadius: 5,
    padding: 6,
    paddingHorizontal: 10,
  },
  summaryCardError: { borderColor: 'rgba(220,5,12,0.25)' },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryStats: { fontSize: 11, color: C.textSecondary, fontFamily: 'Space Grotesk, sans-serif' },
  summaryCallCount: { color: C.textPrimary, fontWeight: '600' },
  summaryErrorCount: { color: '#F87171', fontWeight: '600' },
  summaryDur: { color: C.textTertiary },
  expandBtn: { fontSize: 12, fontWeight: '600', color: C.textTertiary, paddingHorizontal: 6, paddingVertical: 2 },

  // Tool pills
  toolPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  toolPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99 },
  toolPillText: { fontSize: 10, fontWeight: '600', fontFamily: 'Space Grotesk, sans-serif' },

  // Expanded tool calls
  toolCallsExpanded: { paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border, marginTop: 6, gap: 2 },

  // Tool call row
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 5,
    flexWrap: 'wrap',
  },
  toolRowError: { backgroundColor: 'rgba(220,5,12,0.05)', borderWidth: 1, borderColor: 'rgba(220,5,12,0.25)' },
  toolRowTime: { fontSize: 10, color: C.textTertiary, fontFamily: 'monospace', width: 55 },
  toolBadge: {
    width: 20, height: 20, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  toolBadgeLetter: { fontSize: 10, fontWeight: '700', fontFamily: 'Space Grotesk, sans-serif' },
  toolName: { fontSize: 12, fontWeight: '600', fontFamily: 'Space Grotesk, sans-serif' },
  toolPath: { flex: 1, fontSize: 11, color: C.textTertiary, fontFamily: 'monospace', minWidth: 40 },
  durWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  durBar: { height: 3, borderRadius: 2 },
  durLabel: { fontSize: 10, color: C.textTertiary, fontFamily: 'Space Grotesk, sans-serif', minWidth: 30, textAlign: 'right' as const },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3 },

  // Agent chip
  agentChip: { backgroundColor: 'rgba(255,121,0,0.12)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  agentChipText: { fontSize: 10, fontWeight: '600', color: C.brand, fontFamily: 'Space Grotesk, sans-serif' },

  // Error display
  errToggle: { fontSize: 11, color: C.error, marginTop: 4 },
  errBlock: {
    backgroundColor: 'rgba(220,5,12,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(220,5,12,0.2)',
    borderRadius: 4,
    padding: 8,
    marginTop: 4,
    width: '100%' as unknown as number,
  },
  errBlockText: { fontSize: 10, color: '#F87171', fontFamily: 'monospace', lineHeight: 15 },

  // Gap indicator
  gap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12, paddingHorizontal: 4 },
  gapLine: { flex: 1, height: 1, backgroundColor: C.border },
  gapLabel: { fontSize: 10, color: C.textTertiary, fontFamily: 'Space Grotesk, sans-serif', letterSpacing: 0.3 },

  // Subagent drawer
  drawerOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    zIndex: 100,
  },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
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
  drawerTitle: { fontSize: 14, fontWeight: '700', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' },
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
  subagentId: { fontSize: 13, fontWeight: '600', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' },
  subagentMeta: { fontSize: 11, color: C.textTertiary },
});
