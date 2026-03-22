import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C, palette, semantic, component } from '../shared/colors.js';
import { Card } from '../shared/index.js';
import {
  TimelineDot,
  ToolBadge,
  DurationBar,
  MiniStatusDot,
  AgentDot,
  TaskPill,
  ToolPill,
} from './atoms.js';
import type {
  ToolBadgeType,
  TimelineDotType,
  MiniStatusOutcome,
  AgentDotState,
  TaskPillState,
} from './atoms.js';

/* ── M1. ToolCallRow ── */

export interface ToolCallRowProps {
  time: string;
  dotType: TimelineDotType;
  badgeType: ToolBadgeType;
  name: string;
  path?: string;
  durationLabel?: string;
  durationPct?: number;
  durationColor?: string;
  status: MiniStatusOutcome;
  variant?: 'normal' | 'error' | 'agent';
  onPress?: () => void;
}

export function ToolCallRow({
  time,
  dotType,
  badgeType,
  name,
  path,
  durationLabel,
  durationPct,
  durationColor,
  status,
  variant = 'normal',
  onPress,
}: ToolCallRowProps) {
  const bodyVariant =
    variant === 'error'
      ? s.bodyErr
      : variant === 'agent'
        ? s.bodyAgent
        : undefined;

  return (
    <Pressable style={s.toolRow} onPress={onPress}>
      <Text style={s.timeCol}>{time}</Text>
      <View style={s.dotCol}>
        <TimelineDot type={dotType} />
      </View>
      <View style={[s.body, bodyVariant]}>
        <View style={s.row}>
          <ToolBadge type={badgeType} />
          <Text style={s.toolName}>{name}</Text>
          {path ? (
            <Text style={s.toolPath} numberOfLines={1}>
              {path}
            </Text>
          ) : null}
          <View style={s.rowEnd}>
            {durationLabel != null && durationPct != null && durationColor ? (
              <View style={s.durWrap}>
                <Text style={s.durLabel}>{durationLabel}</Text>
                <DurationBar widthPct={durationPct} color={durationColor} />
              </View>
            ) : null}
            <MiniStatusDot outcome={status} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/* ── M2. AgentRow ── */

export interface AgentRowProps {
  state: AgentDotState;
  name: string;
  duration: string;
}

export function AgentRow({ state, name, duration }: AgentRowProps) {
  const nameColor =
    state === 'live'
      ? C.textPrimary
      : state === 'idle'
        ? palette.amber.base
        : C.textTertiary;

  return (
    <View style={s.agentRow}>
      <AgentDot state={state} />
      <Text style={[s.agentName, { color: nameColor }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={s.agentDur}>{duration}</Text>
    </View>
  );
}

/* ── M3. KanbanColumn ── */

export type KanbanColumnVariant = 'ready' | 'active' | 'done';

const KANBAN_HEAD_STYLES: Record<
  KanbanColumnVariant,
  { bg: string; fg: string }
> = {
  ready:  component.kanbanHead.ready,
  active: component.kanbanHead.active,
  done:   component.kanbanHead.done,
};

export interface KanbanColumnProps {
  variant: KanbanColumnVariant;
  label: string;
  count: number;
  tasks: Array<{ label: string; state: TaskPillState }>;
}

export function KanbanColumn({ variant, label, count, tasks }: KanbanColumnProps) {
  const head = KANBAN_HEAD_STYLES[variant];
  return (
    <View style={s.kanbanCol}>
      <View style={[s.kanbanColHead, { backgroundColor: head.bg }]}>
        <Text style={[s.kanbanColLabel, { color: head.fg }]}>{label}</Text>
        <Text style={[s.kanbanColCount, { color: head.fg }]}>{count}</Text>
      </View>
      <View style={s.kanbanColBody}>
        {tasks.map((t, i) => (
          <TaskPill key={i} label={t.label} state={t.state} />
        ))}
      </View>
    </View>
  );
}

/* ── M4. TurnSummaryCard ── */

export interface TurnSummaryCardProps {
  callCount: number;
  errorCount: number;
  duration: string;
  pills: Array<{ label: string; type?: string }>;
  hasErrors?: boolean;
  onToggleExpand?: () => void;
  expanded?: boolean;
}

export function TurnSummaryCard({
  callCount,
  errorCount,
  duration,
  pills,
  hasErrors,
  onToggleExpand,
  expanded,
}: TurnSummaryCardProps) {
  return (
    <Card variant="subtle" borderColor={hasErrors === true ? component.summaryCard.errorBorder : 'rgba(255,121,0,0.15)'} bg="rgba(255,255,255,0.03)">
      <View style={s.summaryTop}>
        <Text style={s.summaryStats}>
          <Text style={s.statCalls}>{callCount}</Text>
          {' calls'}
          {errorCount > 0 ? (
            <>
              {' \u00B7 '}
              <Text style={s.statErrors}>{errorCount}</Text>
              {' errors'}
            </>
          ) : null}
          {' \u00B7 '}
          {duration}
        </Text>
        {onToggleExpand ? (
          <Pressable onPress={onToggleExpand}>
            <Text style={s.expandBtn}>
              {expanded === true ? 'Collapse \u2191' : 'Expand \u2193'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.toolPills}>
        {pills.map((p, i) => (
          <ToolPill key={i} label={p.label} type={p.type} />
        ))}
      </View>
    </Card>
  );
}

/* ── M5. ErrorBlock ── */

export interface ErrorBlockProps {
  errorText: string;
}

export function ErrorBlock({ errorText }: ErrorBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable onPress={() => setOpen(!open)} style={s.errToggle}>
        <Text style={s.errToggleText}>
          {open ? 'Hide error \u2191' : 'Show error \u2193'}
        </Text>
      </Pressable>
      {open ? (
        <View style={s.errBlockWrap}>
          <View style={s.errBlock}>
            <Text style={s.errBlockText}>{errorText}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ── M6. GapIndicator ── */

export interface GapIndicatorProps {
  label: string;
}

export function GapIndicator({ label }: GapIndicatorProps) {
  return (
    <View style={s.gap}>
      <View style={s.gapLine} />
      <Text style={s.gapLabel}>{label}</Text>
      <View style={s.gapLine} />
    </View>
  );
}

/* ── Styles ── */

const s = StyleSheet.create({
  /* M1 — ToolCallRow */
  toolRow: {
    flexDirection: 'row',
    gap: 0,
    marginBottom: 2,
    position: 'relative',
  },
  timeCol: {
    width: 52,
    flexShrink: 0,
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    paddingTop: 14,
    textAlign: 'right',
    paddingRight: 8,
    color: C.textTertiary,
  },
  dotCol: {
    width: 16,
    flexShrink: 0,
    alignItems: 'center',
    paddingTop: 11,
    position: 'relative',
    zIndex: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginLeft: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bodyErr: {
    borderColor: component.toolCallRow.errorBorder,
    backgroundColor: component.toolCallRow.errorBg,
  },
  bodyAgent: {
    borderColor: component.toolCallRow.agentBorder,
    backgroundColor: component.toolCallRow.agentBg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  rowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  toolName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
    color: C.textPrimary,
  },
  toolPath: {
    fontFamily: "'Space Grotesk', monospace",
    fontSize: 11,
    color: C.textTertiary,
    flex: 1,
    minWidth: 0,
  },
  durWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  durLabel: {
    fontSize: 10,
    fontFamily: "'Space Grotesk', sans-serif",
    color: C.textTertiary,
    minWidth: 30,
    textAlign: 'right',
  },

  /* M2 — AgentRow */
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  agentName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },
  agentDur: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textTertiary,
    flexShrink: 0,
  },

  /* M3 — KanbanColumn */
  kanbanCol: {
    flex: 1,
    minWidth: 0,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  kanbanColHead: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.04,
    paddingTop: 3,
    paddingBottom: 2,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  kanbanColLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.04,
  },
  kanbanColCount: {
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.85,
  },
  kanbanColBody: {
    padding: 5,
    gap: 3,
  },

  /* M4 — TurnSummaryCard */
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  summaryStats: {
    flex: 1,
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    color: C.textSecondary,
  },
  statCalls: {
    color: C.textPrimary,
    fontWeight: '600',
  },
  statErrors: {
    color: semantic.errorText,
    fontWeight: '600',
  },
  expandBtn: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '600',
    color: C.textTertiary,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    flexShrink: 0,
  },
  toolPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 5,
  },

  /* M5 — ErrorBlock */
  errToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    paddingLeft: 27,
    opacity: 0.85,
  },
  errToggleText: {
    fontSize: 11,
    color: component.errorBlock.toggleColor,
  },
  errBlockWrap: {
    marginTop: 6,
    paddingLeft: 27,
  },
  errBlock: {
    backgroundColor: component.errorBlock.bg,
    borderWidth: 1,
    borderColor: component.errorBlock.border,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    maxHeight: 180,
    overflow: 'hidden',
  },
  errBlockText: {
    fontFamily: "'Space Grotesk', monospace",
    fontSize: 10,
    color: component.errorBlock.textColor,
    lineHeight: 15,
  },

  /* M6 — GapIndicator */
  gap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 12,
  },
  gapLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
  gapLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    color: C.textTertiary,
    letterSpacing: 0.3,
  },
});
