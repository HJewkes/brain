import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, palette, semantic, component } from '../shared/colors.js';
import { Pill } from '../shared/Pill.js';
import { Badge } from '../shared/Badge.js';

/* ── Color constants (re-exported for backward compat) ── */

/** @deprecated Use `palette.surface3` */
export const SURFACE4 = palette.surface3;
/** @deprecated Use `palette.brand.dim12` */
export const BRAND_DIM = palette.brand.dim12;

/** Tool badge config keyed by tool type. */
export const TOOL_BADGE_STYLES: Record<
  ToolBadgeType,
  { bg: string; fg: string; letter: string }
> = {
  read:  { bg: semantic.tool.read.bg,  fg: semantic.tool.read.fg,  letter: 'R' },
  write: { bg: semantic.tool.write.bg, fg: semantic.tool.write.fg, letter: 'W' },
  edit:  { bg: semantic.tool.edit.bg,  fg: semantic.tool.edit.fg,  letter: 'E' },
  bash:  { bg: semantic.tool.bash.bg,  fg: semantic.tool.bash.fg,  letter: '$' },
  grep:  { bg: semantic.tool.grep.bg,  fg: semantic.tool.grep.fg,  letter: '/' },
  glob:  { bg: semantic.tool.glob.bg,  fg: semantic.tool.glob.fg,  letter: '/' },
  agent: { bg: semantic.tool.agent.bg, fg: semantic.tool.agent.fg, letter: 'A' },
};

/** Tool pill colors keyed by category. */
export const TOOL_PILL_STYLES: Record<string, { bg: string; fg: string }> = {
  read:  { bg: semantic.toolPill.read.bg,  fg: semantic.toolPill.read.fg },
  write: { bg: semantic.toolPill.write.bg, fg: semantic.toolPill.write.fg },
  bash:  { bg: semantic.toolPill.bash.bg,  fg: semantic.toolPill.bash.fg },
  agent: { bg: semantic.toolPill.agent.bg, fg: semantic.toolPill.agent.fg },
};

/** Timeline dot colors keyed by type. */
export const TIMELINE_DOT_COLORS: Record<TimelineDotType, string> = {
  user:  component.timelineDot.user,
  ok:    component.timelineDot.ok,
  err:   component.timelineDot.err,
  agent: component.timelineDot.agent,
  info:  component.timelineDot.info,
};

/** Agent dot variants. */
export const AGENT_DOT_STYLES: Record<
  AgentDotState,
  { bg: string; shadow: string | undefined }
> = {
  live: { bg: component.agentDot.live.bg, shadow: `0 0 4px ${component.agentDot.live.glow}` },
  idle: { bg: component.agentDot.idle.bg, shadow: `0 0 4px ${component.agentDot.idle.glow}` },
  done: { bg: component.agentDot.done.bg, shadow: undefined },
};

/** Task pill state colors (sidebar kanban). */
export const TASK_PILL_COLORS: Record<
  TaskPillState,
  { bg: string; fg: string; border: string }
> = {
  ready:  component.taskPill.ready,
  active: component.taskPill.active,
  done:   component.taskPill.done,
};

/** Status badge variant colors. */
export const STATUS_BADGE_STYLES: Record<
  string,
  { bg: string; fg: string; border: string }
> = {
  complete: component.statusBadge.complete,
  error:    component.statusBadge.error,
  active:   component.statusBadge.active,
};

/* ── Types ── */

export type ToolBadgeType = 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'glob' | 'agent';
export type TimelineDotType = 'user' | 'ok' | 'err' | 'agent' | 'info';
export type MiniStatusOutcome = 'success' | 'error' | 'pending';
export type AgentDotState = 'live' | 'idle' | 'done';
export type TaskPillState = 'ready' | 'active' | 'done';

/* ── 0. Dot (base atom) ── */

interface DotProps {
  size?: number;
  color: string;
  border?: { width: number; color: string };
  glow?: string;
}

export function Dot({ size = 6, color, border, glow }: DotProps) {
  const radius = size / 2;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: color,
          flexShrink: 0,
        },
        border && { borderWidth: border.width, borderColor: border.color },
        glow ? ({ boxShadow: `0 0 4px ${glow}` } as object) : undefined,
      ]}
    />
  );
}

/* ── 1. StatusDot ── */

export function StatusDot({ color }: { color: string }) {
  return <Dot size={5} color={color} />;
}

/* ── 2. TimelineDot ── */

export function TimelineDot({ type }: { type: TimelineDotType }) {
  const isUser = type === 'user';
  return (
    <Dot
      size={isUser ? 10 : 8}
      color={TIMELINE_DOT_COLORS[type]}
      border={{ width: 2, color: C.bg }}
    />
  );
}

/* ── 3. MiniStatusDot ── */

const MINI_STATUS_COLORS: Record<MiniStatusOutcome, string> = {
  success: component.miniStatus.success,
  error:   component.miniStatus.error,
  pending: component.miniStatus.pending,
};

export function MiniStatusDot({ outcome }: { outcome: MiniStatusOutcome }) {
  return <Dot size={6} color={MINI_STATUS_COLORS[outcome]} />;
}

/* ── 4. SectionLabel ── */

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/* ── 5. ToolBadge ── */

export function ToolBadge({ type }: { type: ToolBadgeType }) {
  const config = TOOL_BADGE_STYLES[type];
  return (
    <View
      style={[
        styles.toolBadge,
        { backgroundColor: config.bg },
        type === 'agent' && styles.toolBadgeRound,
      ]}
    >
      <Text style={[styles.toolBadgeLetter, { color: config.fg }]}>
        {config.letter}
      </Text>
    </View>
  );
}

/* ── 6. ToolPill ── */

export function ToolPill({
  label,
  type,
}: {
  label: string;
  type?: string;
}) {
  const config = type ? TOOL_PILL_STYLES[type] : undefined;
  return (
    <Pill
      label={label}
      color={config ? config.fg : C.textTertiary}
      bg={config ? config.bg : palette.surface3}
      rounded
      size="sm"
    />
  );
}

/* ── 7. TaskChip ── */

export function TaskChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pill
      label={label}
      color={component.taskChip.color}
      bg={active ? component.taskChip.activeBg : component.taskChip.bg}
      borderColor={active ? palette.brand.base : component.taskChip.borderColor}
      rounded={false}
      size="md"
      onPress={onPress}
    />
  );
}

/* ── 8. TaskPill ── */

export function TaskPill({
  label,
  state,
}: {
  label: string;
  state: TaskPillState;
}) {
  const cfg = TASK_PILL_COLORS[state];
  return (
    <Pill
      label={label}
      color={cfg.fg}
      bg={cfg.bg}
      borderLeftColor={cfg.border}
      borderLeftWidth={2}
      rounded={false}
      size="xs"
    />
  );
}

/* ── 9. AgentDot ── */

export function AgentDot({ state }: { state: AgentDotState }) {
  const config = AGENT_DOT_STYLES[state];
  return <Dot size={7} color={config.bg} glow={config.shadow ?? undefined} />;
}

/* ── 10. Separator ── */

export function Separator() {
  return <View style={styles.separator} />;
}

/* ── 11. ProgressBar (unified) ── */

interface ProgressBarProps {
  /** Fill percentage 0-100 */
  pct: number;
  /** Bar height in px, default 6 */
  height?: number;
  /** Fill color, default C.brand */
  color?: string;
  /** Track color, default palette.surface3 */
  trackColor?: string;
  /** Fixed track width (e.g. 60 for DurationBar), undefined = flex */
  trackWidth?: number;
}

export function ProgressBar({
  pct,
  height = 6,
  color = C.brand,
  trackColor = palette.surface3,
  trackWidth,
}: ProgressBarProps) {
  const clampedPct = Math.min(Math.max(pct, 0), 100);
  const trackStyle = {
    height,
    backgroundColor: trackColor,
    borderRadius: height / 2,
    overflow: 'hidden' as const,
    ...(trackWidth !== undefined ? { width: trackWidth, flexShrink: 0 as const } : { flex: 1 }),
  };
  const fillStyle = {
    height,
    width: `${clampedPct}%` as unknown as number,
    backgroundColor: color,
    borderRadius: height / 2,
  };
  return (
    <View style={trackStyle}>
      <View style={fillStyle} />
    </View>
  );
}

/* ── 12. DurationBar (thin wrapper over ProgressBar) ── */

export function DurationBar({
  widthPct,
  color,
}: {
  widthPct: number;
  color: string;
}) {
  return <ProgressBar pct={widthPct} height={3} color={color} trackWidth={60} />;
}

/* ── 13. MiniBar ── */

export function MiniBar({
  label,
  pct,
  count,
  color,
}: {
  label: string;
  pct: number;
  count: number;
  color: string;
}) {
  return (
    <View style={styles.miniBarRow}>
      <Text style={styles.miniBarLabel}>{label}</Text>
      <ProgressBar pct={pct} color={color} />
      <Text style={styles.miniBarCount}>{count}</Text>
    </View>
  );
}

/* ── 14. StatusBadge ── */

export function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: string;
}) {
  const config = STATUS_BADGE_STYLES[variant] ?? STATUS_BADGE_STYLES.complete;
  return (
    <Badge
      label={label}
      color={config.fg}
      dot
    />
  );
}

/* ── Styles ── */

const styles = StyleSheet.create({
  /* 4. SectionLabel */
  sectionLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '700',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },

  /* 5. ToolBadge */
  toolBadge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toolBadgeRound: {
    borderRadius: 10,
  },
  toolBadgeLetter: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '700',
  },

  /* 6–8: ToolPill, TaskChip, TaskPill — now composed via Pill */

  /* 10. Separator */
  separator: {
    height: 1,
    backgroundColor: C.border,
  },

  /* 13. MiniBar */
  miniBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  miniBarLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    fontWeight: '500',
    color: C.textSecondary,
    width: 38,
    flexShrink: 0,
  },
  miniBarCount: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    color: C.textTertiary,
    width: 22,
    textAlign: 'right',
    flexShrink: 0,
  },

  /* 14: StatusBadge — now composed via Badge */
});
