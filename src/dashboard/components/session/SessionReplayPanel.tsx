/**
 * SessionReplayPanel — flat chronological event timeline for session replay.
 *
 * Builds a unified event list from SessionDetailData and renders it as a
 * step-by-step timeline color-coded by event kind. Selecting an event shows
 * its full context in a right-hand pane, enabling counterfactual inspection:
 * "what was the agent's context when it made decision X?"
 */

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { type as T } from '../../tokens.js';
import { C, palette, component, semantic } from '../shared/colors.js';
import type {
  SessionDetailData,
  SessionTurn,
  SessionToolCall,
  TaskEvent,
  AgentEvent,
  CompactionEvent,
} from '../../types.js';
import { fmtTime, fmtTimestamp, fmtDuration } from '../../utils/formatting.js';

// ---------------------------------------------------------------------------
// Replay event model
// ---------------------------------------------------------------------------

export type ReplayEventKind =
  | 'turn'
  | 'tool_ok'
  | 'tool_err'
  | 'task'
  | 'agent'
  | 'friction'
  | 'compaction';

export interface ReplayEvent {
  id: string;
  kind: ReplayEventKind;
  timestamp: string;
  title: string;
  subtitle?: string;
  /** Underlying data for the context pane. */
  payload:
    | { type: 'turn'; turn: SessionTurn }
    | { type: 'tool'; call: SessionToolCall; turnIndex: number }
    | { type: 'task'; event: TaskEvent }
    | { type: 'agent'; event: AgentEvent }
    | { type: 'friction'; kind: string; detail: string; toolName?: string; count?: number }
    | { type: 'compaction'; event: CompactionEvent };
}

// ---------------------------------------------------------------------------
// Color map
// ---------------------------------------------------------------------------

const KIND_COLOR: Record<ReplayEventKind, string> = {
  turn:       component.timelineDot.user,
  tool_ok:    component.timelineDot.ok,
  tool_err:   component.timelineDot.err,
  task:       palette.amber.base,
  agent:      component.timelineDot.agent,
  friction:   palette.red.light,
  compaction: component.timelineDot.info,
};

const KIND_LABEL: Record<ReplayEventKind, string> = {
  turn:       'TURN',
  tool_ok:    'TOOL',
  tool_err:   'ERR',
  task:       'TASK',
  agent:      'AGENT',
  friction:   'FRICTION',
  compaction: 'COMPACT',
};

// ---------------------------------------------------------------------------
// Build unified event list from SessionDetailData
// ---------------------------------------------------------------------------

function buildReplayEvents(data: SessionDetailData): ReplayEvent[] {
  const events: ReplayEvent[] = [];

  // Conversation turns (one event per turn, then individual tool calls)
  for (const turn of data.turns) {
    const ts = turn.timestamp;
    events.push({
      id: `turn-${turn.index}`,
      kind: 'turn',
      timestamp: ts,
      title: turn.userMessage ? turn.userMessage.slice(0, 80) : '(empty)',
      subtitle: turn.assistantResponse
        ? turn.assistantResponse.slice(0, 60)
        : undefined,
      payload: { type: 'turn', turn },
    });

    for (const call of turn.toolCalls) {
      const isErr = call.outcome === 'error';
      events.push({
        id: `tool-${call.id}`,
        kind: isErr ? 'tool_err' : 'tool_ok',
        timestamp: call.timestamp || ts,
        title: call.toolName,
        subtitle: call.inputSummary || undefined,
        payload: { type: 'tool', call, turnIndex: turn.index },
      });
    }
  }

  // Task events
  for (const ev of data.taskEvents) {
    events.push({
      id: `task-${ev.taskId}-${ev.timestamp}`,
      kind: 'task',
      timestamp: ev.timestamp,
      title: `${ev.action.toUpperCase()} ${ev.taskId}`,
      subtitle: ev.detail ?? undefined,
      payload: { type: 'task', event: ev },
    });
  }

  // Agent events
  for (const ev of data.agentEvents) {
    events.push({
      id: `agent-${ev.agentId}-${ev.timestamp}`,
      kind: 'agent',
      timestamp: ev.timestamp,
      title: `${ev.action.toUpperCase()} ${ev.agentId}`,
      subtitle: ev.model ?? undefined,
      payload: { type: 'agent', event: ev },
    });
  }

  // Friction signals
  for (let i = 0; i < data.frictionSignals.length; i++) {
    const sig = data.frictionSignals[i];
    events.push({
      id: `friction-${i}-${sig.timestamp}`,
      kind: 'friction',
      timestamp: sig.timestamp,
      title: sig.kind.replace(/_/g, ' ').toUpperCase(),
      subtitle: sig.detail.slice(0, 80),
      payload: {
        type: 'friction',
        kind: sig.kind,
        detail: sig.detail,
        toolName: sig.toolName,
        count: sig.count,
      },
    });
  }

  // Compaction events
  for (let i = 0; i < data.compactions.length; i++) {
    const ev = data.compactions[i];
    events.push({
      id: `compact-${i}`,
      kind: 'compaction',
      timestamp: ev.timestamp,
      title: 'Context compaction',
      subtitle: ev.summaryPreview.slice(0, 60),
      payload: { type: 'compaction', event: ev },
    });
  }

  // Sort by timestamp ascending
  events.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return ta - tb;
  });

  return events;
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

interface EventRowProps {
  event: ReplayEvent;
  index: number;
  selected: boolean;
  onSelect: (event: ReplayEvent) => void;
}

function EventRow({ event, index, selected, onSelect }: EventRowProps) {
  const color = KIND_COLOR[event.kind];
  const label = KIND_LABEL[event.kind];

  return (
    <Pressable
      style={[s.eventRow, selected && s.eventRowSelected]}
      onPress={() => onSelect(event)}
    >
      <View style={s.eventIndex}>
        <Text style={s.eventIndexText}>{index + 1}</Text>
      </View>
      <View style={s.eventDotCol}>
        <View style={[s.eventDot, { backgroundColor: color }]} />
        {/* Connector line */}
        <View style={[s.connectorLine, { backgroundColor: color + '40' }]} />
      </View>
      <View style={s.eventBody}>
        <View style={s.eventTopRow}>
          <View style={[s.kindBadge, { borderColor: color + '60', backgroundColor: color + '15' }]}>
            <Text style={[s.kindBadgeText, { color }]}>{label}</Text>
          </View>
          <Text style={s.eventTime}>{fmtTime(event.timestamp)}</Text>
        </View>
        <Text style={[s.eventTitle, selected && s.eventTitleSelected]} numberOfLines={1}>
          {event.title}
        </Text>
        {event.subtitle ? (
          <Text style={s.eventSubtitle} numberOfLines={1}>{event.subtitle}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Context pane — shows full details of the selected event
// ---------------------------------------------------------------------------

interface ContextPaneProps {
  event: ReplayEvent | null;
  allEvents: ReplayEvent[];
  totalEvents: number;
  onPrev: () => void;
  onNext: () => void;
  selectedIndex: number;
}

function ContextPane({ event, allEvents: _allEvents, totalEvents, onPrev, onNext, selectedIndex }: ContextPaneProps) {
  if (!event) {
    return (
      <View style={s.contextEmpty}>
        <Text style={s.contextEmptyTitle}>Select an event</Text>
        <Text style={s.contextEmptyHint}>Click any event in the timeline to inspect its full context.</Text>
      </View>
    );
  }

  const color = KIND_COLOR[event.kind];

  return (
    <View style={s.contextPane}>
      {/* Header */}
      <View style={s.contextHeader}>
        <View style={[s.contextKindPill, { borderColor: color + '60', backgroundColor: color + '15' }]}>
          <Text style={[s.contextKindText, { color }]}>{KIND_LABEL[event.kind]}</Text>
        </View>
        <Text style={s.contextHeaderTs}>{fmtTimestamp(event.timestamp)}</Text>
        <View style={s.contextNav}>
          <Pressable style={s.navBtn} onPress={onPrev} disabled={selectedIndex === 0}>
            <Text style={[s.navBtnText, selectedIndex === 0 && s.navBtnDisabled]}>‹</Text>
          </Pressable>
          <Text style={s.navCount}>{selectedIndex + 1} / {totalEvents}</Text>
          <Pressable style={s.navBtn} onPress={onNext} disabled={selectedIndex === totalEvents - 1}>
            <Text style={[s.navBtnText, selectedIndex === totalEvents - 1 && s.navBtnDisabled]}>›</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={s.contextBody} contentContainerStyle={s.contextBodyContent}>
        <ContextDetail event={event} />
      </ScrollView>
    </View>
  );
}

function ContextDetail({ event }: { event: ReplayEvent }) {
  const { payload } = event;

  if (payload.type === 'turn') {
    const { turn } = payload;
    return (
      <View style={s.detail}>
        <ContextSection label="User Message">
          <Text style={s.detailText}>{turn.userMessage || '(empty)'}</Text>
        </ContextSection>
        <ContextSection label="Assistant Response">
          <Text style={s.detailText}>{turn.assistantResponse || '(empty)'}</Text>
        </ContextSection>
        {turn.tokenUsage && (
          <ContextSection label="Token Usage">
            <View style={s.metaGrid}>
              <MetaRow label="Input" value={String(turn.tokenUsage.input_tokens)} />
              <MetaRow label="Output" value={String(turn.tokenUsage.output_tokens)} />
              {turn.tokenUsage.cache_read_input_tokens != null && (
                <MetaRow label="Cache read" value={String(turn.tokenUsage.cache_read_input_tokens)} />
              )}
              {turn.tokenUsage.cache_creation_input_tokens != null && (
                <MetaRow label="Cache write" value={String(turn.tokenUsage.cache_creation_input_tokens)} />
              )}
            </View>
          </ContextSection>
        )}
        {turn.toolCalls.length > 0 && (
          <ContextSection label={`Tool Calls (${turn.toolCalls.length})`}>
            {turn.toolCalls.map(c => (
              <View key={c.id} style={s.toolCallEntry}>
                <View style={s.toolCallHeader}>
                  <Text style={s.toolCallName}>{c.toolName}</Text>
                  <Text style={[s.toolCallOutcome, { color: c.outcome === 'error' ? C.error : C.success }]}>
                    {c.outcome}
                  </Text>
                  {c.durationMs != null && (
                    <Text style={s.toolCallDur}>{fmtDuration(c.durationMs)}</Text>
                  )}
                </View>
                {c.inputSummary && (
                  <Text style={s.toolCallInput} numberOfLines={3}>{c.inputSummary}</Text>
                )}
                {c.errorMessage && (
                  <Text style={s.toolCallError}>{c.errorMessage}</Text>
                )}
              </View>
            ))}
          </ContextSection>
        )}
      </View>
    );
  }

  if (payload.type === 'tool') {
    const { call } = payload;
    const isErr = call.outcome === 'error';
    return (
      <View style={s.detail}>
        <ContextSection label="Tool">
          <Text style={[s.detailBig, { color: isErr ? C.error : C.textPrimary }]}>{call.toolName}</Text>
        </ContextSection>
        <ContextSection label="Input">
          <Text style={s.detailMono}>{call.inputSummary || '(none)'}</Text>
        </ContextSection>
        <ContextSection label="Outcome">
          <View style={s.metaGrid}>
            <MetaRow label="Status" value={call.outcome} valueColor={isErr ? C.error : C.success} />
            {call.durationMs != null && (
              <MetaRow label="Duration" value={fmtDuration(call.durationMs)} />
            )}
            {call.agentId && (
              <MetaRow label="Agent" value={call.agentId} />
            )}
            <MetaRow label="Turn" value={String(payload.turnIndex)} />
          </View>
        </ContextSection>
        {isErr && call.errorMessage && (
          <ContextSection label="Error">
            <Text style={s.detailError}>{call.errorMessage}</Text>
          </ContextSection>
        )}
      </View>
    );
  }

  if (payload.type === 'task') {
    const { event: ev } = payload;
    const actionColor = ev.action === 'completed' ? C.success
      : ev.action === 'blocked' || ev.action === 'abandoned' ? C.error
      : ev.action === 'started' ? C.brand
      : C.textSecondary;
    return (
      <View style={s.detail}>
        <ContextSection label="Task Event">
          <View style={s.metaGrid}>
            <MetaRow label="Task" value={ev.taskId} />
            <MetaRow label="Action" value={ev.action.toUpperCase()} valueColor={actionColor} />
            <MetaRow label="Time" value={fmtTimestamp(ev.timestamp)} />
          </View>
        </ContextSection>
        {ev.detail && (
          <ContextSection label="Detail">
            <Text style={s.detailText}>{ev.detail}</Text>
          </ContextSection>
        )}
      </View>
    );
  }

  if (payload.type === 'agent') {
    const { event: ev } = payload;
    const actionColor = ev.action === 'completed' ? C.success
      : ev.action === 'failed' ? C.error
      : C.brand;
    return (
      <View style={s.detail}>
        <ContextSection label="Agent Event">
          <View style={s.metaGrid}>
            <MetaRow label="Agent" value={ev.agentId} />
            <MetaRow label="Action" value={ev.action.toUpperCase()} valueColor={actionColor} />
            {ev.model && <MetaRow label="Model" value={ev.model} />}
            {ev.taskId && <MetaRow label="Task" value={ev.taskId} />}
            <MetaRow label="Time" value={fmtTimestamp(ev.timestamp)} />
          </View>
        </ContextSection>
      </View>
    );
  }

  if (payload.type === 'friction') {
    return (
      <View style={s.detail}>
        <ContextSection label="Friction Signal">
          <View style={s.metaGrid}>
            <MetaRow label="Kind" value={payload.kind} valueColor={palette.red.light} />
            {payload.toolName && <MetaRow label="Tool" value={payload.toolName} />}
            {payload.count != null && <MetaRow label="Count" value={String(payload.count)} />}
          </View>
        </ContextSection>
        <ContextSection label="Detail">
          <Text style={s.detailText}>{payload.detail}</Text>
        </ContextSection>
      </View>
    );
  }

  if (payload.type === 'compaction') {
    const { event: ev } = payload;
    const saved = ev.tokensBefore - ev.tokensAfter;
    const savedPct = ev.tokensBefore > 0 ? Math.round((saved / ev.tokensBefore) * 100) : 0;
    return (
      <View style={s.detail}>
        <ContextSection label="Context Compaction">
          <View style={s.metaGrid}>
            <MetaRow label="Before" value={`${ev.tokensBefore.toLocaleString()} tokens`} />
            <MetaRow label="After" value={`${ev.tokensAfter.toLocaleString()} tokens`} />
            <MetaRow label="Saved" value={`${saved.toLocaleString()} (${savedPct}%)`} valueColor={C.success} />
            <MetaRow label="Turn" value={String(ev.turnIndex)} />
          </View>
        </ContextSection>
        {ev.summaryPreview && (
          <ContextSection label="Summary Preview">
            <Text style={s.detailText}>{ev.summaryPreview}</Text>
          </ContextSection>
        )}
      </View>
    );
  }

  return null;
}

function ContextSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function MetaRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={[s.metaValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <View style={s.legend}>
      {(Object.keys(KIND_COLOR) as ReplayEventKind[]).map(kind => (
        <View key={kind} style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: KIND_COLOR[kind] }]} />
          <Text style={s.legendLabel}>{KIND_LABEL[kind]}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface SessionReplayPanelProps {
  data: SessionDetailData;
}

export function SessionReplayPanel({ data }: SessionReplayPanelProps) {
  const events = useMemo(() => buildReplayEvents(data), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedIndex = selectedId != null
    ? events.findIndex(e => e.id === selectedId)
    : -1;
  const selectedEvent = selectedIndex >= 0 ? events[selectedIndex] : null;

  const handleSelect = useCallback((event: ReplayEvent) => {
    setSelectedId(prev => prev === event.id ? null : event.id);
  }, []);

  const handlePrev = useCallback(() => {
    if (selectedIndex > 0) setSelectedId(events[selectedIndex - 1].id);
  }, [selectedIndex, events]);

  const handleNext = useCallback(() => {
    if (selectedIndex < events.length - 1) setSelectedId(events[selectedIndex + 1].id);
  }, [selectedIndex, events]);

  return (
    <View style={s.root}>
      {/* Timeline */}
      <View style={s.timelineColumn}>
        <View style={s.timelineHeader}>
          <Text style={s.timelineTitle}>Event Timeline</Text>
          <Text style={s.timelineCount}>{events.length} events</Text>
        </View>
        <Legend />
        <ScrollView style={s.timelineScroll} contentContainerStyle={s.timelineContent}>
          {events.map((event, i) => (
            <EventRow
              key={event.id}
              event={event}
              index={i}
              selected={event.id === selectedId}
              onSelect={handleSelect}
            />
          ))}
          {events.length === 0 && (
            <Text style={s.emptyText}>No events found in this session.</Text>
          )}
        </ScrollView>
      </View>

      {/* Context pane */}
      <View style={s.contextColumn}>
        <ContextPane
          event={selectedEvent}
          allEvents={events}
          totalEvents={events.length}
          onPrev={handlePrev}
          onNext={handleNext}
          selectedIndex={selectedIndex >= 0 ? selectedIndex : 0}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row' as const,
    height: '100%' as unknown as number,
  },

  // Timeline column
  timelineColumn: {
    width: 340,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: C.border,
    flexDirection: 'column' as const,
    backgroundColor: C.surface1,
  },
  timelineHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  timelineTitle: {
    ...T.headingSm,
    color: C.textPrimary,
  },
  timelineCount: {
    ...T.labelSm,
    color: C.textTertiary,
  },
  timelineScroll: { flex: 1 },
  timelineContent: { paddingBottom: 40 },

  // Legend
  legend: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  legendItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 9,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '600' as const,
    color: C.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },

  // Event row
  eventRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border + '50',
    position: 'relative' as const,
  },
  eventRowSelected: {
    backgroundColor: palette.brand.dim06,
    borderLeftWidth: 2,
    borderLeftColor: C.brand,
  },
  eventIndex: {
    width: 22,
    flexShrink: 0,
    alignItems: 'flex-end' as const,
    paddingTop: 4,
    paddingRight: 6,
  },
  eventIndexText: {
    fontSize: 9,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', monospace",
  },
  eventDotCol: {
    width: 14,
    flexShrink: 0,
    alignItems: 'center' as const,
    paddingTop: 4,
    position: 'relative' as const,
  },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 1,
  },
  connectorLine: {
    position: 'absolute' as const,
    top: 12,
    bottom: -6,
    width: 1,
    left: 6,
  },
  eventBody: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
    gap: 2,
  },
  eventTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 2,
  },
  kindBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
  },
  kindBadgeText: {
    fontSize: 8,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '700' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  eventTime: {
    fontSize: 9,
    fontFamily: "'Space Grotesk', sans-serif",
    color: C.textTertiary,
    marginLeft: 'auto' as unknown as number,
  },
  eventTitle: {
    fontSize: 11,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '500' as const,
    color: C.textSecondary,
  },
  eventTitleSelected: {
    color: C.textPrimary,
  },
  eventSubtitle: {
    fontSize: 10,
    fontFamily: "'Space Grotesk', sans-serif",
    color: C.textTertiary,
    fontStyle: 'italic' as const,
  },

  // Context column
  contextColumn: {
    flex: 1,
    flexDirection: 'column' as const,
  },
  contextEmpty: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    padding: 40,
  },
  contextEmptyTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  contextEmptyHint: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: 'center' as const,
    maxWidth: 300,
  },

  // Context pane
  contextPane: {
    flex: 1,
    flexDirection: 'column' as const,
  },
  contextHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface1,
  },
  contextKindPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  contextKindText: {
    fontSize: 10,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  contextHeaderTs: {
    fontSize: 11,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  contextNav: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginLeft: 'auto' as unknown as number,
  },
  navBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  navBtnText: {
    fontSize: 14,
    color: C.textPrimary,
    lineHeight: 16,
  },
  navBtnDisabled: {
    color: C.textTertiary,
  },
  navCount: {
    fontSize: 11,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', sans-serif",
    minWidth: 50,
    textAlign: 'center' as const,
  },
  contextBody: { flex: 1 },
  contextBodyContent: { padding: 20 },

  // Detail sections
  detail: { gap: 16 },
  section: { gap: 6 },
  sectionLabel: {
    ...T.labelSm,
    color: C.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    fontWeight: '700' as const,
  },
  detailText: {
    fontSize: 12,
    lineHeight: 18,
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  detailMono: {
    fontSize: 11,
    lineHeight: 17,
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', monospace",
    backgroundColor: C.surface2,
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  detailBig: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: C.textPrimary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  detailError: {
    fontSize: 11,
    lineHeight: 16,
    color: palette.red.light,
    fontFamily: "'Space Grotesk', monospace",
    backgroundColor: palette.red.dim08,
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: palette.red.dim25,
  },
  metaGrid: { gap: 4 },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
  },
  metaLabel: {
    fontSize: 11,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', sans-serif",
    width: 80,
    flexShrink: 0,
  },
  metaValue: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', sans-serif",
    flex: 1,
  },

  // Tool call entries
  toolCallEntry: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 8,
    gap: 4,
    marginBottom: 4,
  },
  toolCallHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  toolCallName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: C.textPrimary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  toolCallOutcome: {
    fontSize: 10,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  toolCallDur: {
    fontSize: 10,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', sans-serif",
    marginLeft: 'auto' as unknown as number,
  },
  toolCallInput: {
    fontSize: 10,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', monospace",
  },
  toolCallError: {
    fontSize: 10,
    color: palette.red.light,
    fontFamily: "'Space Grotesk', monospace",
    backgroundColor: palette.red.dim08,
    padding: 6,
    borderRadius: 3,
  },

  // Empty state
  emptyText: {
    fontSize: 12,
    color: C.textTertiary,
    fontStyle: 'italic' as const,
    padding: 20,
    textAlign: 'center' as const,
  },
});
