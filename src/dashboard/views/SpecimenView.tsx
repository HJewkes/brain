import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { C } from '../components/shared/colors.js';
import {
  Dot,
  StatusDot,
  TimelineDot,
  MiniStatusDot,
  SectionLabel,
  ToolBadge,
  ToolPill,
  TaskChip,
  TaskPill,
  AgentDot,
  Separator,
  DurationBar,
  ProgressBar,
  MiniBar,
  StatusBadge,
} from '../components/session/index.js';
import type {
  ToolBadgeType,
  TimelineDotType,
  MiniStatusOutcome,
  AgentDotState,
  TaskPillState,
} from '../components/session/index.js';
import {
  ToolCallRow,
  AgentRow,
  KanbanColumn,
  TurnSummaryCard,
  ErrorBlock,
  GapIndicator,
} from '../components/session/index.js';
import {
  UserMessageCard,
  ClaudeResponseCard,
  ConversationTurn,
} from '../components/session/index.js';

/* ── Specimen helpers ── */

/** Section wrapper with title */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** Labeled row: "ground truth" HTML on left, React component on right */
function CompareRow({
  label,
  html,
  react,
}: {
  label: string;
  html: React.ReactNode;
  react: React.ReactNode;
}) {
  return (
    <View style={s.compareRow}>
      <Text style={s.compareLabel}>{label}</Text>
      <View style={s.comparePair}>
        <View style={s.compareCol}>
          <Text style={s.compareColLabel}>HTML prototype</Text>
          <View style={s.compareCell}>{html}</View>
        </View>
        <View style={s.compareDivider} />
        <View style={s.compareCol}>
          <Text style={s.compareColLabel}>React (RNW)</Text>
          <View style={s.compareCell}>{react}</View>
        </View>
      </View>
    </View>
  );
}

/** Magnified preview for tiny elements — renders HTML dots at explicit larger sizes */
function MagnifiedDots({
  items,
  size,
}: {
  items: Array<{ label: string; color: string; border?: string }>;
  size: number;
}) {
  return (
    <View style={s.magnifiedStrip}>
      <Text style={s.magnifiedLabel}>magnified {size}px</Text>
      {items.map((item, i) => (
        <View key={i} style={s.magnifiedCell}>
          <div
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              background: item.color,
              border: item.border ?? 'none',
              display: 'inline-block',
            }}
          />
          <Text style={s.variantLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Variant strip: renders several items in a horizontal row with small labels beneath */
function Variants({ items }: { items: Array<{ label: string; node: React.ReactNode }> }) {
  return (
    <View style={s.variantStrip}>
      {items.map((item, i) => (
        <View key={i} style={s.variantCell}>
          <View style={s.variantContent}>{item.node}</View>
          <Text style={s.variantLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/* ── HTML ground-truth primitives ── */
/* These render raw DOM elements with inline styles matching the prototype CSS exactly */

function HtmlDot({ size, color, border }: { size: number; color: string; border?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        border: border ?? 'none',
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}

function HtmlBadge({ letter, bg, fg }: { letter: string; bg: string; fg: string }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        background: bg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 10,
          fontWeight: 700,
          color: fg,
        }}
      >
        {letter}
      </span>
    </div>
  );
}

function HtmlPill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 99,
        background: bg,
        color: fg,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  );
}

function HtmlTaskPill({ label, bg, fg, border }: { label: string; bg: string; fg: string; border: string }) {
  return (
    <span
      style={{
        fontFamily: "'Space Grotesk', monospace",
        fontSize: 9,
        fontWeight: 600,
        padding: '1px 4px',
        borderRadius: 3,
        borderLeft: `2px solid ${border}`,
        background: bg,
        color: fg,
        lineHeight: '13.5px',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  );
}

function HtmlTaskChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 10,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 4,
        background: 'rgba(255,121,0,0.12)',
        color: '#FF7900',
        border: '1px solid rgba(255,121,0,0.25)',
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  );
}

function HtmlBar({ widthPct, color, height }: { widthPct: number; color: string; height: number }) {
  return (
    <div style={{ width: 80, display: 'inline-block' }}>
      <div
        style={{
          width: `${Math.min(Math.max(widthPct, 1), 100)}%`,
          height,
          borderRadius: 2,
          background: color,
          maxWidth: 60,
          minWidth: 2,
        }}
      />
    </div>
  );
}

function HtmlProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ width: 120, display: 'inline-block' }}>
      <div
        style={{
          height: 6,
          background: '#1f1f1f',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: 6,
            background: '#FF7900',
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}

function HtmlSeparator() {
  return <div style={{ height: 1, background: '#2a2a2a', width: 120 }} />;
}

function HtmlSectionLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 10,
        fontWeight: 700,
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {text}
    </span>
  );
}

function HtmlStatusBadge({ label, bg, fg, border }: { label: string; bg: string; fg: string; border: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "'Space Grotesk', sans-serif",
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
      {label}
    </span>
  );
}

function HtmlMiniBar({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, width: 180 }}>
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, fontWeight: 500, color: '#9CA3AF', width: 38, flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 6, background: '#1f1f1f', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: 6, borderRadius: 3, background: color }} />
      </div>
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, color: '#6B7280', width: 22, textAlign: 'right', flexShrink: 0 }}>
        {count}
      </span>
    </div>
  );
}

/* ── Main view ── */

const TOOL_TYPES: ToolBadgeType[] = ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'agent'];
const DOT_TYPES: TimelineDotType[] = ['user', 'ok', 'err', 'agent', 'info'];
const STATUS_OUTCOMES: MiniStatusOutcome[] = ['success', 'error', 'pending'];
const AGENT_STATES: AgentDotState[] = ['live', 'idle', 'done'];
const TASK_STATES: TaskPillState[] = ['ready', 'active', 'done'];
const DOT_COLORS = ['#14B8A6', '#DC050C', '#FF7900', '#5B9BD5', '#6B7280'];

const TOOL_BADGE_STYLES: Record<string, { bg: string; fg: string; letter: string }> = {
  read:  { bg: 'rgba(25,101,176,0.2)',  fg: '#7BAFDE', letter: 'R' },
  write: { bg: 'rgba(20,184,166,0.2)',   fg: '#14B8A6', letter: 'W' },
  edit:  { bg: 'rgba(244,167,54,0.2)',   fg: '#F4A736', letter: 'E' },
  bash:  { bg: 'rgba(107,114,128,0.2)',  fg: '#9CA3AF', letter: '$' },
  grep:  { bg: 'rgba(130,60,160,0.2)',   fg: '#C084FC', letter: '/' },
  glob:  { bg: 'rgba(130,60,160,0.2)',   fg: '#C084FC', letter: '/' },
  agent: { bg: 'rgba(255,121,0,0.12)',   fg: '#FF7900', letter: 'A' },
};

const TOOL_PILL_COLORS: Record<string, { bg: string; fg: string }> = {
  read:  { bg: 'rgba(25,101,176,0.2)',  fg: '#7BAFDE' },
  write: { bg: 'rgba(20,184,166,0.2)',  fg: '#14B8A6' },
  bash:  { bg: 'rgba(244,167,54,0.15)', fg: '#F4A736' },
  agent: { bg: 'rgba(255,121,0,0.12)',  fg: '#FF7900' },
};

const TASK_PILL_STYLE: Record<TaskPillState, { bg: string; fg: string; border: string }> = {
  ready:  { bg: 'rgba(212,165,32,0.15)', fg: '#D4A520', border: '#D4A520' },
  active: { bg: 'rgba(255,121,0,0.15)',  fg: '#FF7900', border: '#FF7900' },
  done:   { bg: 'rgba(20,184,166,0.12)', fg: '#14B8A6', border: '#14B8A6' },
};

const STATUS_BADGE_CFG: Record<string, { bg: string; fg: string; border: string }> = {
  complete: { bg: 'rgba(20,184,166,0.12)', fg: '#14B8A6', border: 'rgba(20,184,166,0.25)' },
  error: { bg: 'rgba(220,5,12,0.12)', fg: '#DC050C', border: 'rgba(220,5,12,0.25)' },
  active: { bg: 'rgba(255,121,0,0.12)', fg: '#FF7900', border: 'rgba(255,121,0,0.25)' },
};

export function SpecimenView() {
  return (
    <ScrollView style={s.root} contentContainerStyle={s.container}>
      <Text style={s.pageTitle}>Component Specimen Sheet</Text>
      <Text style={s.pageSubtitle}>
        HTML prototype (ground truth) vs React (RNW) — side by side
      </Text>

      {/* ════════════════════ ATOMS ════════════════════ */}
      <Text style={s.tier}>Atoms (15)</Text>

      {/* A0. Dot (base atom) */}
      <Section title="A0. Dot">
        <CompareRow
          label="Unified dot: size, color, border, glow"
          html={
            <Variants
              items={[
                { label: '5px plain', node: <HtmlDot size={5} color="#14B8A6" /> },
                { label: '8px border', node: <HtmlDot size={8} color="#5B9BD5" border={`2px solid ${C.bg}`} /> },
                { label: '7px glow', node: <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 4px rgba(34,197,94,0.5)', display: 'inline-block' }} /> },
              ]}
            />
          }
          react={
            <Variants
              items={[
                { label: '5px plain', node: <Dot size={5} color="#14B8A6" /> },
                { label: '8px border', node: <Dot size={8} color="#5B9BD5" border={{ width: 2, color: C.bg }} /> },
                { label: '7px glow', node: <Dot size={7} color="#22c55e" glow="rgba(34,197,94,0.5)" /> },
              ]}
            />
          }
        />
      </Section>

      {/* A1. StatusDot */}
      <Section title="A1. StatusDot">
        <CompareRow
          label="5px colored dots (actual size + magnified below)"
          html={
            <Variants
              items={DOT_COLORS.map((c) => ({
                label: c.slice(0, 7),
                node: <HtmlDot size={5} color={c} />,
              }))}
            />
          }
          react={
            <Variants
              items={DOT_COLORS.map((c) => ({
                label: c.slice(0, 7),
                node: <StatusDot color={c} />,
              }))}
            />
          }
        />
        <MagnifiedDots
          size={24}
          items={DOT_COLORS.map((c) => ({ label: c.slice(0, 7), color: c }))}
        />
      </Section>

      {/* A2. TimelineDot */}
      <Section title="A2. TimelineDot">
        <CompareRow
          label="8px dots (user=10px) with border"
          html={
            <Variants
              items={DOT_TYPES.map((t) => {
                const colors: Record<string, string> = {
                  user: '#5B9BD5', ok: '#14B8A6', err: '#DC050C',
                  agent: '#FF7900', info: '#6B7280',
                };
                const size = t === 'user' ? 10 : 8;
                return {
                  label: t,
                  node: <HtmlDot size={size} color={colors[t]} border={`2px solid ${C.bg}`} />,
                };
              })}
            />
          }
          react={
            <Variants items={DOT_TYPES.map((t) => ({ label: t, node: <TimelineDot type={t} /> }))} />
          }
        />
        <MagnifiedDots
          size={32}
          items={DOT_TYPES.map((t) => {
            const colors: Record<string, string> = {
              user: '#5B9BD5', ok: '#14B8A6', err: '#DC050C',
              agent: '#FF7900', info: '#6B7280',
            };
            return { label: t, color: colors[t], border: `4px solid ${C.bg}` };
          })}
        />
      </Section>

      {/* A3. MiniStatusDot */}
      <Section title="A3. MiniStatusDot">
        <CompareRow
          label="6px outcome dots"
          html={
            <Variants
              items={STATUS_OUTCOMES.map((o) => {
                const colors: Record<string, string> = { success: '#14B8A6', error: '#DC050C', pending: '#6B7280' };
                return { label: o, node: <HtmlDot size={6} color={colors[o]} /> };
              })}
            />
          }
          react={
            <Variants items={STATUS_OUTCOMES.map((o) => ({ label: o, node: <MiniStatusDot outcome={o} /> }))} />
          }
        />
        <MagnifiedDots
          size={24}
          items={[
            { label: 'success', color: '#14B8A6' },
            { label: 'error', color: '#DC050C' },
            { label: 'pending', color: '#6B7280' },
          ]}
        />
      </Section>

      {/* A4. SectionLabel */}
      <Section title="A4. SectionLabel">
        <CompareRow
          label="Uppercase widget header"
          html={<HtmlSectionLabel text="PROGRESS" />}
          react={<SectionLabel>PROGRESS</SectionLabel>}
        />
      </Section>

      {/* A5. ToolBadge */}
      <Section title="A5. ToolBadge">
        <CompareRow
          label="20×20 tool type badges"
          html={
            <Variants
              items={TOOL_TYPES.map((t) => {
                const cfg = TOOL_BADGE_STYLES[t];
                return { label: t, node: <HtmlBadge letter={cfg.letter} bg={cfg.bg} fg={cfg.fg} /> };
              })}
            />
          }
          react={
            <Variants items={TOOL_TYPES.map((t) => ({ label: t, node: <ToolBadge type={t} /> }))} />
          }
        />
      </Section>

      {/* A6. ToolPill */}
      <Section title="A6. ToolPill">
        <CompareRow
          label="Rounded category pills"
          html={
            <Variants
              items={[
                ...Object.entries(TOOL_PILL_COLORS).map(([type, cfg]) => ({
                  label: type,
                  node: <HtmlPill label={`${type} ×12`} bg={cfg.bg} fg={cfg.fg} />,
                })),
                { label: 'default', node: <HtmlPill label="other ×3" bg="#1f1f1f" fg="#6B7280" /> },
              ]}
            />
          }
          react={
            <Variants
              items={[
                ...['read', 'write', 'bash', 'agent'].map((t) => ({
                  label: t,
                  node: <ToolPill label={`${t} ×12`} type={t} />,
                })),
                { label: 'default', node: <ToolPill label="other ×3" /> },
              ]}
            />
          }
        />
      </Section>

      {/* A7. TaskChip */}
      <Section title="A7. TaskChip">
        <CompareRow
          label="Clickable task reference chips"
          html={
            <Variants
              items={[
                { label: 'normal', node: <HtmlTaskChip label="VNM-21.04" /> },
                { label: 'active', node: <HtmlTaskChip label="VNM-27.03" /> },
              ]}
            />
          }
          react={
            <Variants
              items={[
                { label: 'normal', node: <TaskChip label="VNM-21.04" /> },
                { label: 'active', node: <TaskChip label="VNM-27.03" active /> },
              ]}
            />
          }
        />
      </Section>

      {/* A8. TaskPill */}
      <Section title="A8. TaskPill">
        <CompareRow
          label="State-colored kanban pills"
          html={
            <Variants
              items={TASK_STATES.map((st) => {
                const cfg = TASK_PILL_STYLE[st];
                return { label: st, node: <HtmlTaskPill label={`VNM-27.${st === 'ready' ? '05' : st === 'active' ? '06' : '01'}`} bg={cfg.bg} fg={cfg.fg} border={cfg.border} /> };
              })}
            />
          }
          react={
            <Variants
              items={TASK_STATES.map((st) => ({
                label: st,
                node: <TaskPill label={`VNM-27.${st === 'ready' ? '05' : st === 'active' ? '06' : '01'}`} state={st} />,
              }))}
            />
          }
        />
      </Section>

      {/* A9. AgentDot */}
      <Section title="A9. AgentDot">
        <CompareRow
          label="7px agent state dots with glow"
          html={
            <Variants
              items={AGENT_STATES.map((st) => {
                const colors: Record<string, string> = { live: '#22c55e', idle: '#F4A736', done: '#6B7280' };
                const shadows: Record<string, string> = { live: '0 0 4px rgba(34,197,94,0.5)', idle: '0 0 4px rgba(244,167,54,0.4)', done: 'none' };
                return {
                  label: st,
                  node: (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: colors[st], boxShadow: shadows[st], display: 'inline-block' }} />
                  ),
                };
              })}
            />
          }
          react={
            <Variants items={AGENT_STATES.map((st) => ({ label: st, node: <AgentDot state={st} /> }))} />
          }
        />
        <MagnifiedDots
          size={28}
          items={[
            { label: 'live', color: '#22c55e' },
            { label: 'idle', color: '#F4A736' },
            { label: 'done', color: '#6B7280' },
          ]}
        />
      </Section>

      {/* A10. Separator */}
      <Section title="A10. Separator">
        <CompareRow
          label="1px horizontal rule"
          html={<HtmlSeparator />}
          react={<View style={{ width: 120 }}><Separator /></View>}
        />
      </Section>

      {/* A11. DurationBar */}
      <Section title="A11. DurationBar">
        <CompareRow
          label="3px tall proportional bars"
          html={
            <Variants
              items={[
                { label: '25%', node: <HtmlBar widthPct={25} color="#14B8A6" height={3} /> },
                { label: '60%', node: <HtmlBar widthPct={60} color="#F4A736" height={3} /> },
                { label: '100%', node: <HtmlBar widthPct={100} color="#DC050C" height={3} /> },
              ]}
            />
          }
          react={
            <Variants
              items={[
                { label: '25%', node: <View style={{ width: 80 }}><DurationBar widthPct={25} color="#14B8A6" /></View> },
                { label: '60%', node: <View style={{ width: 80 }}><DurationBar widthPct={60} color="#F4A736" /></View> },
                { label: '100%', node: <View style={{ width: 80 }}><DurationBar widthPct={100} color="#DC050C" /></View> },
              ]}
            />
          }
        />
      </Section>

      {/* A12. ProgressBar */}
      <Section title="A12. ProgressBar">
        <CompareRow
          label="6px track with fill"
          html={
            <Variants
              items={[
                { label: '0%', node: <HtmlProgressBar pct={0} /> },
                { label: '45%', node: <HtmlProgressBar pct={45} /> },
                { label: '100%', node: <HtmlProgressBar pct={100} /> },
              ]}
            />
          }
          react={
            <Variants
              items={[
                { label: '0%', node: <View style={{ width: 120 }}><ProgressBar pct={0} /></View> },
                { label: '45%', node: <View style={{ width: 120 }}><ProgressBar pct={45} /></View> },
                { label: '100%', node: <View style={{ width: 120 }}><ProgressBar pct={100} /></View> },
              ]}
            />
          }
        />
      </Section>

      {/* A13. MiniBar */}
      <Section title="A13. MiniBar">
        <CompareRow
          label="Label + track + count row"
          html={
            <View>
              <HtmlMiniBar label="Read" pct={65} count={142} color="#7BAFDE" />
              <HtmlMiniBar label="Write" pct={30} count={66} color="#14B8A6" />
              <HtmlMiniBar label="Bash" pct={45} count={98} color="#F4A736" />
            </View>
          }
          react={
            <View style={{ width: 180 }}>
              <MiniBar label="Read" pct={65} count={142} color="#7BAFDE" />
              <MiniBar label="Write" pct={30} count={66} color="#14B8A6" />
              <MiniBar label="Bash" pct={45} count={98} color="#F4A736" />
            </View>
          }
        />
      </Section>

      {/* A14. StatusBadge */}
      <Section title="A14. StatusBadge">
        <CompareRow
          label="Pill with status dot + text"
          html={
            <Variants
              items={Object.entries(STATUS_BADGE_CFG).map(([variant, cfg]) => ({
                label: variant,
                node: <HtmlStatusBadge label={variant} bg={cfg.bg} fg={cfg.fg} border={cfg.border} />,
              }))}
            />
          }
          react={
            <Variants
              items={['complete', 'error', 'active'].map((v) => ({
                label: v,
                node: <StatusBadge label={v} variant={v} />,
              }))}
            />
          }
        />
      </Section>

      {/* ════════════════════ MOLECULES ════════════════════ */}
      <Text style={s.tier}>Molecules (6)</Text>

      {/* M1. ToolCallRow */}
      <Section title="M1. ToolCallRow">
        <View style={s.moleculeWrap}>
          <ToolCallRow
            time="14:32:01"
            dotType="ok"
            badgeType="read"
            name="Read"
            path="src/services/brain-db.ts"
            durationLabel="1.2s"
            durationPct={40}
            durationColor="#14B8A6"
            status="success"
          />
          <ToolCallRow
            time="14:32:05"
            dotType="err"
            badgeType="bash"
            name="Bash"
            path="npm test"
            durationLabel="4.8s"
            durationPct={80}
            durationColor="#DC050C"
            status="error"
            variant="error"
          />
          <ToolCallRow
            time="14:32:10"
            dotType="agent"
            badgeType="agent"
            name="Agent"
            path="test-runner"
            durationLabel="12.3s"
            durationPct={95}
            durationColor="#FF7900"
            status="success"
            variant="agent"
          />
        </View>
      </Section>

      {/* M2. AgentRow */}
      <Section title="M2. AgentRow">
        <View style={s.moleculeWrap}>
          <View style={{ width: 200 }}>
            <AgentRow state="live" name="test-runner" duration="2m 14s" />
            <AgentRow state="idle" name="code-reviewer" duration="45s" />
            <AgentRow state="done" name="lint-fixer" duration="1m 02s" />
          </View>
        </View>
      </Section>

      {/* M3. KanbanColumn */}
      <Section title="M3. KanbanColumn">
        <View style={[s.moleculeWrap, { flexDirection: 'row', gap: 8 }]}>
          <View style={{ width: 120 }}>
            <KanbanColumn
              variant="ready"
              label="Ready"
              count={3}
              tasks={[
                { label: 'VNM-21.05', state: 'ready' },
                { label: 'VNM-21.06', state: 'ready' },
                { label: 'VNM-22.03', state: 'ready' },
              ]}
            />
          </View>
          <View style={{ width: 120 }}>
            <KanbanColumn
              variant="active"
              label="Active"
              count={1}
              tasks={[{ label: 'VNM-27.04', state: 'active' }]}
            />
          </View>
          <View style={{ width: 120 }}>
            <KanbanColumn
              variant="done"
              label="Done"
              count={2}
              tasks={[
                { label: 'VNM-27.01', state: 'done' },
                { label: 'VNM-27.02', state: 'done' },
              ]}
            />
          </View>
        </View>
      </Section>

      {/* M4. TurnSummaryCard */}
      <Section title="M4. TurnSummaryCard">
        <View style={s.moleculeWrap}>
          <View style={{ maxWidth: 500 }}>
            <TurnSummaryCard
              callCount={23}
              errorCount={0}
              duration="1m 14s"
              pills={[
                { label: 'Read ×8', type: 'read' },
                { label: 'Write ×4', type: 'write' },
                { label: 'Bash ×6', type: 'bash' },
                { label: 'Agent ×2', type: 'agent' },
                { label: 'Grep ×3' },
              ]}
            />
          </View>
          <View style={{ maxWidth: 500, marginTop: 8 }}>
            <TurnSummaryCard
              callCount={15}
              errorCount={3}
              duration="2m 08s"
              hasErrors
              pills={[
                { label: 'Bash ×10', type: 'bash' },
                { label: 'Read ×5', type: 'read' },
              ]}
            />
          </View>
        </View>
      </Section>

      {/* M5. ErrorBlock */}
      <Section title="M5. ErrorBlock">
        <View style={s.moleculeWrap}>
          <View style={{ maxWidth: 500 }}>
            <ErrorBlock errorText="Error: Cannot find module './missing-file.js'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1048:15)\n    at Module._load (node:internal/modules/cjs/loader:901:27)" />
          </View>
        </View>
      </Section>

      {/* M6. GapIndicator */}
      <Section title="M6. GapIndicator">
        <View style={s.moleculeWrap}>
          <View style={{ maxWidth: 500 }}>
            <GapIndicator label="23m gap" />
          </View>
        </View>
      </Section>

      {/* ════════════════════ ORGANISMS ════════════════════ */}
      <Text style={s.tier}>Organisms (3)</Text>

      {/* O1. UserMessageCard */}
      <Section title="O1. UserMessageCard">
        <View style={s.moleculeWrap}>
          <View style={{ maxWidth: 600 }}>
            <UserMessageCard
              text="Let's fix the session ingestion pipeline. The structured-events.json generation is not wired up yet and we need it for the dashboard."
              timestamp="14:32:01"
            />
          </View>
        </View>
      </Section>

      {/* O2. ClaudeResponseCard */}
      <Section title="O2. ClaudeResponseCard">
        <View style={s.moleculeWrap}>
          <View style={{ maxWidth: 600 }}>
            <ClaudeResponseCard
              text="I'll wire up the structured events generation into the ingestion pipeline. This requires changes to **pipeline.ts** and **accumulator.ts** to emit the `structured-events.json` file alongside the existing session data."
              timestamp="14:32:05"
              summary={{
                callCount: 12,
                errorCount: 0,
                duration: "45s",
                pills: [
                  { label: 'Read ×4', type: 'read' },
                  { label: 'Edit ×3', type: 'write' },
                  { label: 'Bash ×5', type: 'bash' },
                ],
              }}
            />
          </View>
          <View style={{ maxWidth: 600, marginTop: 12 }}>
            <ClaudeResponseCard
              text="The test is failing because the mock doesn't include the new `tokenSnapshots` field. Let me fix the test fixture."
              timestamp="14:33:20"
              hasErrors
              summary={{
                callCount: 8,
                errorCount: 2,
                duration: "1m 12s",
                pills: [
                  { label: 'Bash ×6', type: 'bash' },
                  { label: 'Edit ×2', type: 'write' },
                ],
                hasErrors: true,
              }}
            />
          </View>
        </View>
      </Section>

      {/* O3. ConversationTurn */}
      <Section title="O3. ConversationTurn">
        <View style={s.moleculeWrap}>
          <View style={{ maxWidth: 650 }}>
            <ConversationTurn
              userMessage="Can you run the tests and check if the pipeline changes work?"
              userTimestamp="14:35:00"
              assistantResponse="Running the full test suite now. I'll also verify the structured events output format matches the `SessionDetailData` type from the canonical types."
              assistantTimestamp="14:35:02"
              summary={{
                callCount: 3,
                errorCount: 0,
                duration: "18s",
                pills: [
                  { label: 'Bash ×2', type: 'bash' },
                  { label: 'Read ×1', type: 'read' },
                ],
              }}
            />
          </View>
        </View>
      </Section>
    </ScrollView>
  );
}

/* ── Styles ── */

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    padding: 24,
    paddingBottom: 80,
  },
  pageTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 22,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    color: C.textTertiary,
    marginBottom: 28,
  },
  tier: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 14,
    fontWeight: '700',
    color: C.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 32,
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,121,0,0.2)',
  },

  /* Section */
  section: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sectionTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 12,
  },

  /* CompareRow */
  compareRow: {
    marginBottom: 8,
  },
  compareLabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    color: C.textTertiary,
    marginBottom: 8,
  },
  comparePair: {
    flexDirection: 'row',
    gap: 1,
  },
  compareCol: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
    padding: 12,
  },
  compareColLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    fontWeight: '700',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  compareCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  compareDivider: {
    width: 1,
    backgroundColor: C.border,
  },

  /* Magnified strip for tiny elements */
  magnifiedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  magnifiedLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    fontWeight: '600',
    color: C.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 4,
  },
  magnifiedCell: {
    alignItems: 'center',
    gap: 4,
  },

  /* Variant strip */
  variantStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    alignItems: 'flex-end',
  },
  variantCell: {
    alignItems: 'center',
    gap: 6,
  },
  variantContent: {
    minHeight: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  variantLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 8,
    color: C.textTertiary,
    textAlign: 'center',
  },

  /* Molecule wrapper */
  moleculeWrap: {
    paddingVertical: 8,
  },
});
