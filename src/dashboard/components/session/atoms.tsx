import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';

/* ── Color constants ── */

export const SURFACE4 = '#1f1f1f';
export const BRAND_DIM = 'rgba(255,121,0,0.12)';

/** Tool badge config keyed by tool type. */
export const TOOL_BADGE_STYLES: Record<
  ToolBadgeType,
  { bg: string; fg: string; letter: string }
> = {
  read:  { bg: 'rgba(25,101,176,0.2)',  fg: '#7BAFDE', letter: 'R' },
  write: { bg: 'rgba(20,184,166,0.2)',   fg: '#14B8A6', letter: 'W' },
  edit:  { bg: 'rgba(244,167,54,0.2)',   fg: '#F4A736', letter: 'E' },
  bash:  { bg: 'rgba(107,114,128,0.2)',  fg: '#9CA3AF', letter: '$' },
  grep:  { bg: 'rgba(130,60,160,0.2)',   fg: '#C084FC', letter: '/' },
  glob:  { bg: 'rgba(130,60,160,0.2)',   fg: '#C084FC', letter: '/' },
  agent: { bg: BRAND_DIM,                fg: '#FF7900', letter: 'A' },
};

/** Tool pill colors keyed by category. */
export const TOOL_PILL_STYLES: Record<string, { bg: string; fg: string }> = {
  read:  { bg: 'rgba(25,101,176,0.2)',  fg: '#7BAFDE' },
  write: { bg: 'rgba(20,184,166,0.2)',  fg: '#14B8A6' },
  bash:  { bg: 'rgba(244,167,54,0.15)', fg: '#F4A736' },
  agent: { bg: BRAND_DIM,               fg: '#FF7900' },
};

/** Timeline dot colors keyed by type. */
export const TIMELINE_DOT_COLORS: Record<TimelineDotType, string> = {
  user:  '#5B9BD5',
  ok:    '#14B8A6',
  err:   '#DC050C',
  agent: '#FF7900',
  info:  C.textTertiary,
};

/** Agent dot variants. */
export const AGENT_DOT_STYLES: Record<
  AgentDotState,
  { bg: string; shadow: string | undefined }
> = {
  live: { bg: '#22c55e', shadow: '0 0 4px rgba(34,197,94,0.5)' },
  idle: { bg: '#F4A736', shadow: '0 0 4px rgba(244,167,54,0.4)' },
  done: { bg: C.textTertiary, shadow: undefined },
};

/** Task pill state colors (sidebar kanban). */
export const TASK_PILL_COLORS: Record<
  TaskPillState,
  { bg: string; fg: string; border: string }
> = {
  ready:  { bg: 'rgba(212,165,32,0.15)', fg: '#D4A520', border: '#D4A520' },
  active: { bg: 'rgba(255,121,0,0.15)',  fg: '#FF7900', border: '#FF7900' },
  done:   { bg: 'rgba(20,184,166,0.12)', fg: '#14B8A6', border: '#14B8A6' },
};

/** Status badge variant colors. */
export const STATUS_BADGE_STYLES: Record<
  string,
  { bg: string; fg: string; border: string }
> = {
  complete: {
    bg: 'rgba(20,184,166,0.12)',
    fg: '#14B8A6',
    border: 'rgba(20,184,166,0.25)',
  },
  error: {
    bg: 'rgba(220,5,12,0.12)',
    fg: '#DC050C',
    border: 'rgba(220,5,12,0.25)',
  },
  active: {
    bg: BRAND_DIM,
    fg: '#FF7900',
    border: 'rgba(255,121,0,0.25)',
  },
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
  success: '#14B8A6',
  error: '#DC050C',
  pending: C.textTertiary,
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
    <View
      style={[
        styles.toolPill,
        config
          ? { backgroundColor: config.bg }
          : { backgroundColor: SURFACE4 },
      ]}
    >
      <Text
        style={[
          styles.toolPillText,
          { color: config ? config.fg : C.textTertiary },
        ]}
      >
        {label}
      </Text>
    </View>
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
    <Pressable
      onPress={onPress}
      style={[styles.taskChip, active === true && styles.taskChipActive]}
    >
      <Text style={styles.taskChipText}>{label}</Text>
    </Pressable>
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
  const colors = TASK_PILL_COLORS[state];
  return (
    <View
      style={[
        styles.taskPill,
        { backgroundColor: colors.bg, borderLeftColor: colors.border },
      ]}
    >
      <Text style={[styles.taskPillText, { color: colors.fg }]}>{label}</Text>
    </View>
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
  /** Track color, default SURFACE4 */
  trackColor?: string;
  /** Fixed track width (e.g. 60 for DurationBar), undefined = flex */
  trackWidth?: number;
}

export function ProgressBar({
  pct,
  height = 6,
  color = C.brand,
  trackColor = SURFACE4,
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
    <View
      style={[
        styles.statusBadge,
        {
          backgroundColor: config.bg,
          borderColor: config.border,
        },
      ]}
    >
      <StatusDot color={config.fg} />
      <Text style={[styles.statusBadgeText, { color: config.fg }]}>
        {label}
      </Text>
    </View>
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

  /* 6. ToolPill */
  toolPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 99,
  },
  toolPillText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '600',
  },

  /* 7. TaskChip */
  taskChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: BRAND_DIM,
    borderWidth: 1,
    borderColor: 'rgba(255,121,0,0.25)',
    flexShrink: 0,
  },
  taskChipActive: {
    backgroundColor: 'rgba(255,121,0,0.25)',
    borderColor: '#FF7900',
  },
  taskChipText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '600',
    color: '#FF7900',
  },

  /* 8. TaskPill */
  taskPill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderLeftWidth: 2,
  },
  taskPillText: {
    fontFamily: "'Space Grotesk', monospace",
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 13.5,
  },

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

  /* 14. StatusBadge */
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
    flexShrink: 0,
  },
  statusBadgeText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    fontWeight: '600',
  },
});
