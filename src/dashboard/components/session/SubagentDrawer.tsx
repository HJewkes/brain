import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { C, palette, semantic, component } from '../shared/colors.js';
import type { SessionDetailData, SubagentSummary } from '../../types.js';

export interface SubagentDrawerProps {
  agentId: string;
  sessionData: SessionDetailData;
  onClose: () => void;
}

interface ToolBreakdownEntry {
  category: string;
  count: number;
  pct: number;
  color: string;
}

interface AgentToolCall {
  timestamp: string;
  toolName: string;
  inputSummary: string;
  outcome: 'success' | 'error' | 'pending';
  errorMessage: string | null;
  durationMs: number | null;
}

const TOOL_COLORS: Record<string, string> = {
  Read: palette.blue.dark,
  Write: palette.teal.base,
  Bash: palette.amber.base,
  Agent: palette.brand.base,
  Other: semantic.text.tertiary,
};

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Write', 'Edit']);
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Skill']);

function toolCat(name: string): string {
  if (READ_TOOLS.has(name)) return 'Read';
  if (WRITE_TOOLS.has(name)) return 'Write';
  if (AGENT_TOOLS.has(name)) return 'Agent';
  return 'Bash';
}

export function SubagentDrawer({ agentId, sessionData, onClose }: SubagentDrawerProps) {
  const agent = useMemo(
    () => sessionData.subagents.find((s) => s.agentId === agentId) ?? null,
    [agentId, sessionData.subagents],
  );

  const toolCalls = useMemo(
    () => extractAgentToolCalls(sessionData, agentId),
    [sessionData, agentId],
  );

  const spawnPrompt = useMemo(
    () => extractSpawnPrompt(sessionData, agentId),
    [sessionData, agentId],
  );

  useEscapeKey(onClose);

  if (!agent) {
    return (
      <DrawerShell onClose={onClose}>
        <EmptyState />
      </DrawerShell>
    );
  }

  return (
    <DrawerShell onClose={onClose}>
      <DrawerHeader agentId={agentId} onClose={onClose} />
      <MetaBadges agent={agent} />
      <ScrollView style={styles.body}>
        {spawnPrompt ? <SpawnPromptSection prompt={spawnPrompt} /> : null}
        <ToolBreakdownSection toolCalls={toolCalls} />
        <ToolCallsTable toolCalls={toolCalls} totalCount={agent.toolCalls} />
      </ScrollView>
    </DrawerShell>
  );
}

/* ── Shell (backdrop + drawer) ── */

function DrawerShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>{children}</View>
    </View>
  );
}

/* ── Header ── */

function DrawerHeader({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const label = `Subagent ${agentId.length > 12 ? agentId.slice(0, 12) + '\u2026' : agentId}`;
  return (
    <View style={styles.header}>
      <Pressable onPress={onClose} style={styles.backBtn}>
        <Text style={styles.backArrow}>{'\u2190'}</Text>
        <Text style={styles.backText}>Back to session</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/* ── Meta badges ── */

function MetaBadges({ agent }: { agent: SubagentSummary }) {
  const durationText = formatDuration(agent.durationMs);
  return (
    <View style={styles.metaRow}>
      <Badge text="Agent" variant="agent" />
      <Badge text={durationText} />
      <Badge text={`${agent.toolCalls} calls`} />
      {agent.errors > 0 && (
        <Badge text={`${agent.errors} error${agent.errors !== 1 ? 's' : ''}`} variant="error" />
      )}
      {agent.model && <Badge text={agent.model} />}
    </View>
  );
}

function Badge({ text, variant }: { text: string; variant?: 'agent' | 'error' }) {
  const extra = variant === 'agent' ? styles.badgeAgent : variant === 'error' ? styles.badgeError : null;
  const textExtra = variant === 'agent' ? styles.badgeAgentText : variant === 'error' ? styles.badgeErrorText : null;
  return (
    <View style={[styles.badge, extra]}>
      <Text style={[styles.badgeText, textExtra]}>{text}</Text>
    </View>
  );
}

/* ── Spawn prompt section ── */

function SpawnPromptSection({ prompt }: { prompt: string }) {
  const display = prompt.length >= 300 ? prompt.slice(0, 300) + '\u2026' : prompt;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>SPAWN PROMPT</Text>
      <View style={styles.promptBox}>
        <Text style={styles.promptText}>{display}</Text>
      </View>
    </View>
  );
}

/* ── Tool breakdown section ── */

function ToolBreakdownSection({ toolCalls }: { toolCalls: AgentToolCall[] }) {
  const entries = useMemo(() => buildBreakdown(toolCalls), [toolCalls]);
  if (entries.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>TOOL BREAKDOWN</Text>
      {entries.map((e) => (
        <View key={e.category} style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{e.category}</Text>
          <View style={styles.breakdownTrack}>
            <View style={[styles.breakdownFill, { width: `${e.pct}%` as unknown as number, backgroundColor: e.color }]} />
          </View>
          <Text style={styles.breakdownCount}>{e.count}</Text>
        </View>
      ))}
    </View>
  );
}

function buildBreakdown(toolCalls: AgentToolCall[]): ToolBreakdownEntry[] {
  const counts: Record<string, number> = {};
  for (const tc of toolCalls) {
    const cat = toolCat(tc.toolName);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return entries.map(([category, count]) => ({
    category,
    count,
    pct: (count / max) * 100,
    color: TOOL_COLORS[category] ?? TOOL_COLORS.Other,
  }));
}

/* ── Tool calls table ── */

function ToolCallsTable({ toolCalls, totalCount }: { toolCalls: AgentToolCall[]; totalCount: number }) {
  if (toolCalls.length === 0) return null;
  const truncated = totalCount > toolCalls.length;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>TOOL CALLS</Text>
      {toolCalls.map((tc, i) => (
        <ToolCallRow key={`${tc.timestamp}-${i}`} tc={tc} />
      ))}
      {truncated && (
        <Text style={styles.truncNote}>
          Showing {toolCalls.length} of {totalCount} calls
        </Text>
      )}
    </View>
  );
}

function ToolCallRow({ tc }: { tc: AgentToolCall }) {
  const isErr = tc.outcome === 'error';
  const nameColor = TOOL_COLORS[toolCat(tc.toolName)] ?? C.textPrimary;
  const durText = formatMs(tc.durationMs);
  const time = formatTime(tc.timestamp);

  return (
    <View style={[styles.tableRow, isErr && styles.tableRowErr]}>
      <Text style={styles.tcTime}>{time}</Text>
      <Text style={[styles.tcName, { color: isErr ? palette.red.light : nameColor }]}>{tc.toolName}</Text>
      <Text style={styles.tcDetail} numberOfLines={1}>{tc.inputSummary}</Text>
      <Text style={styles.tcDur}>{durText}</Text>
    </View>
  );
}

/* ── Empty state ── */

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>Subagent data not available</Text>
    </View>
  );
}

/* ── Escape key hook ── */

function useEscapeKey(onClose: () => void) {
  const handler = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); },
    [onClose],
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handler]);
}

/* ── Data extraction helpers ── */

function extractAgentToolCalls(data: SessionDetailData, agentId: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  for (const turn of data.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.agentId !== agentId) continue;
      calls.push({
        timestamp: tc.timestamp,
        toolName: tc.toolName,
        inputSummary: tc.inputSummary,
        outcome: tc.outcome,
        errorMessage: tc.errorMessage,
        durationMs: tc.durationMs,
      });
    }
  }
  return calls;
}

function extractSpawnPrompt(data: SessionDetailData, agentId: string): string | null {
  for (const turn of data.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.toolName !== 'Agent' && tc.toolName !== 'Task') continue;
      if (!tc.inputSummary.includes(agentId)) continue;
      const promptMatch = tc.inputSummary.match(/prompt[:=]\s*"?(.+)/);
      return promptMatch?.[1]?.replace(/"$/, '') ?? tc.inputSummary;
    }
  }
  return null;
}

/* ── Formatting helpers ── */

function formatDuration(ms: number | null): string {
  if (!ms) return '\u2014';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatMs(ms: number | null): string {
  if (!ms) return '\u2014';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/* ── Styles ── */

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: component.drawer.backdrop,
    zIndex: 499,
  } as object,
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 400,
    height: '100%' as unknown as number,
    backgroundColor: C.surface1,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    zIndex: 500,
    flexDirection: 'column',
  } as object,
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface2,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  backArrow: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 14,
    color: C.textTertiary,
  },
  backText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 12,
    color: C.textTertiary,
  },
  title: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 14,
    fontWeight: '700',
    color: C.brand,
    flex: 1,
    minWidth: 0,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: C.surface3,
    borderWidth: 1,
    borderColor: C.border,
  },
  badgeText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '600',
    color: C.textSecondary,
  },
  badgeAgent: {
    backgroundColor: palette.brand.dim12,
    borderColor: palette.brand.dim30,
  },
  badgeAgentText: {
    color: C.brand,
  },
  badgeError: {
    backgroundColor: palette.red.dim10,
    borderColor: palette.red.dim30,
  },
  badgeErrorText: {
    color: palette.red.light,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '700',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  promptBox: {
    backgroundColor: component.subagentToolRow.bg,
    borderWidth: 1,
    borderColor: component.subagentToolRow.border,
    borderLeftWidth: 4,
    borderLeftColor: component.subagentToolRow.leftAccent,
    borderRadius: 6,
    padding: 10,
    maxHeight: 200,
    overflow: 'hidden',
  },
  promptText: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
    lineHeight: 19,
    color: C.textPrimary,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  breakdownLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '600',
    color: C.textSecondary,
    width: 38,
  },
  breakdownTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.overlay.white06,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: 6,
    borderRadius: 3,
  },
  breakdownCount: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textTertiary,
    width: 28,
    textAlign: 'right',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 6,
  },
  tableRowErr: {
    backgroundColor: palette.red.dim05,
  },
  tcTime: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    color: C.textTertiary,
    width: 36,
  },
  tcName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    fontWeight: '600',
    width: 48,
  },
  tcDetail: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    color: C.textTertiary,
    flex: 1,
    minWidth: 0,
  },
  tcDur: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    color: C.textTertiary,
    textAlign: 'right',
    width: 48,
  },
  truncNote: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 10,
    color: C.textTertiary,
    marginTop: 6,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    color: C.textTertiary,
    fontStyle: 'italic',
  },
});
