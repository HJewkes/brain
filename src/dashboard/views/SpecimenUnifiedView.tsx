import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { C } from '../components/shared/colors.js';
import { colors, spacing, radii, typography, elevation } from '../tokens.js';
import { AVATAR_COLORS } from '../utils/avatar.js';
import { columnColor, priorityColor, statusColor, priorityStripeColor } from '../utils/semantic-colors.js';

// Shared components
import {
  Badge,
  Avatar,
  Section,
  StatCard,
  StageBadge,
  TokenGauge,
  ActivitySparkline,
  ChartContainer,
  GridLines,
  DEFAULT_PADDING,
} from '../components/shared/index.js';

// Session atoms
import {
  Dot,
  SectionLabel,
  Separator,
  ProgressBar,
  MiniBar,
  ToolBadge,
  ToolPill,
  TaskChip,
  TaskPill,
  StatusBadge,
  TOOL_BADGE_STYLES,
} from '../components/session/index.js';
import type { ToolBadgeType, TaskPillState } from '../components/session/index.js';

// Session molecules
import {
  ToolCallRow,
  AgentRow,
  KanbanColumn,
  TurnSummaryCard,
  ErrorBlock,
  GapIndicator,
} from '../components/session/index.js';

// Session organisms
import {
  UserMessageCard,
  ClaudeResponseCard,
  ConversationTurn,
} from '../components/session/index.js';

// ---------------------------------------------------------------------------
// Specimen layout helpers
// ---------------------------------------------------------------------------

/** Category tier header — bold separator between major groups */
function TierHeader({ title }: { title: string }) {
  return (
    <View style={s.tierHeader}>
      <Text style={s.tierTitle}>{title}</Text>
    </View>
  );
}

/** Specimen section with a label and horizontal variant row */
function Spec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.spec}>
      <Text style={s.specTitle}>{title}</Text>
      <View style={s.specBody}>{children}</View>
    </View>
  );
}

/** Labeled variant strip — renders items in a horizontal row with small labels */
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

/** Color swatch */
function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.swatchCell}>
      <View style={[s.swatch, { backgroundColor: color }]} />
      <Text style={s.swatchLabel}>{label}</Text>
      <Text style={s.swatchHex}>{color}</Text>
    </View>
  );
}

/** Spacing bar sample */
function SpacingBar({ size, label }: { size: number; label: string }) {
  return (
    <View style={s.spacingRow}>
      <Text style={s.spacingLabel}>{label}</Text>
      <View style={[s.spacingBar, { width: size, height: size }]} />
      <Text style={s.spacingValue}>{size}px</Text>
    </View>
  );
}

/** Radius preview box */
function RadiusBox({ radius, label }: { radius: number; label: string }) {
  return (
    <View style={s.radiusCell}>
      <View style={[s.radiusBox, { borderRadius: radius }]} />
      <Text style={s.radiusLabel}>{label}</Text>
      <Text style={s.radiusValue}>{radius}px</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Data for specimen
// ---------------------------------------------------------------------------

const TOOL_TYPES: ToolBadgeType[] = ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'agent'];
const TASK_STATES: TaskPillState[] = ['ready', 'active', 'done'];

const SAMPLE_SPARK_EVENTS = [
  { type: 'read', magnitude: 3 },
  { type: 'bash', magnitude: 5 },
  { type: 'write', magnitude: 2 },
  { type: 'read', magnitude: 4 },
  { type: 'error', magnitude: 1 },
  { type: 'read', magnitude: 6 },
  { type: 'bash', magnitude: 3 },
  { type: 'write', magnitude: 4 },
];

const AVATAR_NAMES = [
  'Alice Chen',
  'Bob Martinez',
  'Carol Johnson',
  'Dave Kim',
  'Eve Thompson',
  'Frank Lee',
  'Grace Wang',
];

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SpecimenUnifiedView() {
  return (
    <ScrollView style={s.root} contentContainerStyle={s.container}>
      {/* Page header */}
      <Text style={s.pageTitle}>Design System Components</Text>
      <Text style={s.pageSubtitle}>
        Unified specimen sheet — all shared components with variants
      </Text>

      {/* ═══════════════════════ 1. DESIGN TOKENS ═══════════════════════ */}
      <TierHeader title="1. Design Tokens" />

      <Spec title="Color palette">
        <View style={s.swatchGrid}>
          <Swatch color={colors.bg} label="bg" />
          <Swatch color={colors.surface1} label="surface1" />
          <Swatch color={colors.surface2} label="surface2" />
          <Swatch color={colors.surface3} label="surface3" />
          <Swatch color={colors.brand} label="brand" />
          <Swatch color={colors.steel} label="steel" />
          <Swatch color={colors.success} label="success" />
          <Swatch color={colors.error} label="error" />
          <Swatch color={colors.warning} label="warning" />
          <Swatch color={colors.info} label="info" />
          <Swatch color={colors.textPrimary} label="textPrimary" />
          <Swatch color={colors.textSecondary} label="textSecondary" />
          <Swatch color={colors.textTertiary} label="textTertiary" />
          <Swatch color={colors.border} label="border" />
        </View>
      </Spec>

      <Spec title="Spacing scale">
        {Object.entries(spacing).map(([k, v]) => (
          <SpacingBar key={k} size={v} label={`spacing.${k}`} />
        ))}
      </Spec>

      <Spec title="Border radius scale">
        <View style={s.variantStrip}>
          {Object.entries(radii).map(([k, v]) => (
            <RadiusBox key={k} radius={Math.min(v, 24)} label={k} />
          ))}
        </View>
      </Spec>

      <Spec title="Typography presets">
        <View style={s.typographyStack}>
          <View style={s.typographyRow}>
            <Text style={s.typoPreviewHeading}>Space Grotesk heading</Text>
            <Text style={s.typoMeta}>heading · 20px · bold 700</Text>
          </View>
          <View style={s.typographyRow}>
            <Text style={s.typoPreviewBody}>Inter body text sample</Text>
            <Text style={s.typoMeta}>body · 14px · regular 400</Text>
          </View>
          <View style={s.typographyRow}>
            <Text style={s.typoPreviewMono}>monospace code snippet</Text>
            <Text style={s.typoMeta}>mono · 12px · regular 400</Text>
          </View>
          <View style={s.typographyRow}>
            <Text style={s.typoPreviewXs}>xs label text</Text>
            <Text style={s.typoMeta}>xs · 11px</Text>
          </View>
          <View style={s.typographyRow}>
            <Text style={s.typoPreview3xl}>32px</Text>
            <Text style={s.typoMeta}>3xl · 32px · bold stat value</Text>
          </View>
        </View>
      </Spec>

      <Spec title="Elevation (surface layers)">
        <View style={s.variantStrip}>
          {Object.entries(elevation).map(([k, v]) => (
            <View key={k} style={s.elevationCell}>
              <View style={[s.elevationBox, { backgroundColor: v }]} />
              <Text style={s.elevationLabel}>{k}</Text>
              <Text style={s.elevationHex}>{v}</Text>
            </View>
          ))}
        </View>
      </Spec>

      {/* ═══════════════════════ 2. PRIMITIVE ATOMS ═══════════════════════ */}
      <TierHeader title="2. Primitive Atoms" />

      <Spec title="Dot — sizes, colors, border, glow">
        <Variants
          items={[
            { label: '5px', node: <Dot size={5} color={C.success} /> },
            { label: '6px', node: <Dot size={6} color={C.brand} /> },
            { label: '7px', node: <Dot size={7} color={C.info} /> },
            { label: '8px', node: <Dot size={8} color={C.warning} /> },
            { label: '10px', node: <Dot size={10} color={C.error} /> },
            { label: 'border', node: <Dot size={8} color="#5B9BD5" border={{ width: 2, color: C.bg }} /> },
            { label: 'glow', node: <Dot size={7} color="#22c55e" glow="rgba(34,197,94,0.5)" /> },
          ]}
        />
      </Spec>

      <Spec title="ProgressBar — heights and colors">
        <View style={{ gap: 8, width: 200 }}>
          <ProgressBar pct={35} height={3} color={C.success} />
          <ProgressBar pct={60} height={6} color={C.brand} />
          <ProgressBar pct={80} height={8} color={C.warning} />
          <ProgressBar pct={100} height={6} color={C.error} />
          <ProgressBar pct={45} height={6} color={C.info} />
        </View>
      </Spec>

      <Spec title="Separator">
        <View style={{ width: 200 }}>
          <Separator />
        </View>
      </Spec>

      <Spec title="SectionLabel">
        <Variants
          items={[
            { label: 'progress', node: <SectionLabel>PROGRESS</SectionLabel> },
            { label: 'agents', node: <SectionLabel>AGENTS</SectionLabel> },
            { label: 'tasks', node: <SectionLabel>TASKS</SectionLabel> },
          ]}
        />
      </Spec>

      {/* ═══════════════════════ 3. BADGES & PILLS ═══════════════════════ */}
      <TierHeader title="3. Badges & Pills" />

      <Spec title="Badge — semantic colors (md size)">
        <Variants
          items={[
            { label: 'success', node: <Badge label="success" color={C.success} /> },
            { label: 'error', node: <Badge label="error" color={C.error} /> },
            { label: 'warning', node: <Badge label="warning" color={C.warning} /> },
            { label: 'info', node: <Badge label="info" color={C.info} /> },
            { label: 'brand', node: <Badge label="brand" color={C.brand} /> },
            { label: 'steel', node: <Badge label="steel" color={C.steel} /> },
          ]}
        />
      </Spec>

      <Spec title="Badge — with dot + sm/md sizes">
        <Variants
          items={[
            { label: 'dot md', node: <Badge label="Active" color={C.success} dot /> },
            { label: 'dot sm', node: <Badge label="Active" color={C.success} dot size="sm" /> },
            { label: 'no dot', node: <Badge label="Active" color={C.success} /> },
            { label: 'sm', node: <Badge label="Review" color={C.info} size="sm" /> },
            { label: 'high-bg', node: <Badge label="Critical" color={C.error} bgOpacity={0.25} borderOpacity={0.5} /> },
          ]}
        />
      </Spec>

      <Spec title="ToolBadge — all 7 types">
        <Variants
          items={TOOL_TYPES.map((t) => ({
            label: t,
            node: <ToolBadge type={t} />,
          }))}
        />
      </Spec>

      <Spec title="ToolPill — 4 colored + default">
        <Variants
          items={[
            { label: 'read', node: <ToolPill label="Read ×8" type="read" /> },
            { label: 'write', node: <ToolPill label="Write ×4" type="write" /> },
            { label: 'bash', node: <ToolPill label="Bash ×6" type="bash" /> },
            { label: 'agent', node: <ToolPill label="Agent ×2" type="agent" /> },
            { label: 'default', node: <ToolPill label="Grep ×3" /> },
          ]}
        />
      </Spec>

      <Spec title="TaskPill — 3 states">
        <Variants
          items={TASK_STATES.map((st) => ({
            label: st,
            node: <TaskPill label="VNM-27.04" state={st} />,
          }))}
        />
      </Spec>

      <Spec title="TaskChip — normal + active">
        <Variants
          items={[
            { label: 'normal', node: <TaskChip label="VNM-21.04" /> },
            { label: 'active', node: <TaskChip label="VNM-27.03" active /> },
          ]}
        />
      </Spec>

      <Spec title="StageBadge — green / yellow / red / no-age">
        <Variants
          items={[
            { label: 'green (young)', node: <StageBadge stage="review" ageMinutes={15} p50={30} p85={60} /> },
            { label: 'yellow (med)', node: <StageBadge stage="inprogress" ageMinutes={45} p50={30} p85={60} /> },
            { label: 'red (old)', node: <StageBadge stage="blocked" ageMinutes={90} p50={30} p85={60} /> },
            { label: 'no age', node: <StageBadge stage="ready" /> },
          ]}
        />
      </Spec>

      <Spec title="StatusBadge (session) — complete / error / active">
        <Variants
          items={[
            { label: 'complete', node: <StatusBadge label="complete" variant="complete" /> },
            { label: 'error', node: <StatusBadge label="error" variant="error" /> },
            { label: 'active', node: <StatusBadge label="active" variant="active" /> },
          ]}
        />
      </Spec>

      <Spec title="Semantic color utils">
        <View style={{ gap: 10 }}>
          <View style={s.semanticRow}>
            <Text style={s.semanticLabel}>columnColor</Text>
            <Variants
              items={['blocked', 'ready', 'inprogress', 'review', 'done'].map((col) => ({
                label: col,
                node: <Badge label={col} color={columnColor(col)} />,
              }))}
            />
          </View>
          <View style={s.semanticRow}>
            <Text style={s.semanticLabel}>priorityColor</Text>
            <Variants
              items={['critical', 'high', 'medium', 'low'].map((p) => ({
                label: p,
                node: <Badge label={p} color={priorityColor(p)} />,
              }))}
            />
          </View>
          <View style={s.semanticRow}>
            <Text style={s.semanticLabel}>statusColor</Text>
            <Variants
              items={['active', 'completed', 'error', 'running'].map((s) => ({
                label: s,
                node: <Dot size={8} color={statusColor(s)} />,
              }))}
            />
          </View>
          <View style={s.semanticRow}>
            <Text style={s.semanticLabel}>priorityStripeColor</Text>
            <Variants
              items={['critical', 'high', 'medium', 'low'].map((p) => ({
                label: p,
                node: <View style={[s.stripePreview, { backgroundColor: priorityStripeColor(p) }]} />,
              }))}
            />
          </View>
        </View>
      </Spec>

      {/* ═══════════════════════ 4. DATA DISPLAY ═══════════════════════ */}
      <TierHeader title="4. Data Display" />

      <Spec title="StatCard — with delta, with sparkline, without">
        <View style={s.statCardRow}>
          <View style={{ flex: 1, minWidth: 160 }}>
            <StatCard label="Sessions" value="142" delta="+12%" deltaPositive />
          </View>
          <View style={{ flex: 1, minWidth: 160 }}>
            <StatCard
              label="Tool Calls"
              value="1,847"
              delta="-3%"
              deltaPositive={false}
              sparkData={[12, 18, 15, 22, 19, 28, 25, 30, 26, 35]}
            />
          </View>
          <View style={{ flex: 1, minWidth: 160 }}>
            <StatCard label="Agents" value="23" />
          </View>
        </View>
      </Spec>

      <Spec title="TokenGauge — low usage / high usage">
        <View style={{ gap: 16, maxWidth: 340 }}>
          <TokenGauge tokensIn={15000} tokensOut={4000} maxTokens={200000} />
          <TokenGauge tokensIn={140000} tokensOut={45000} maxTokens={200000} />
        </View>
      </Spec>

      <Spec title="MiniBar — multiple rows">
        <View style={{ width: 220 }}>
          <MiniBar label="Read" pct={65} count={142} color="#7BAFDE" />
          <MiniBar label="Write" pct={30} count={66} color="#14B8A6" />
          <MiniBar label="Bash" pct={45} count={98} color="#F4A736" />
          <MiniBar label="Agent" pct={15} count={32} color="#FF7900" />
          <MiniBar label="Grep" pct={20} count={44} color="#C084FC" />
        </View>
      </Spec>

      <Spec title="ActivitySparkline — sample events">
        <View style={{ width: 200 }}>
          <ActivitySparkline events={SAMPLE_SPARK_EVENTS} />
        </View>
      </Spec>

      {/* ═══════════════════════ 5. AVATARS ═══════════════════════ */}
      <TierHeader title="5. Avatars" />

      <Spec title="Avatar — sizes 20 / 26 / 32 / 40">
        <View style={{ gap: 16 }}>
          <View style={s.avatarRow}>
            <Text style={s.avatarRowLabel}>circle (rounded=true)</Text>
            <Variants
              items={[20, 26, 32, 40].map((sz) => ({
                label: `${sz}px`,
                node: <Avatar name="Alice Chen" size={sz} rounded />,
              }))}
            />
          </View>
          <View style={s.avatarRow}>
            <Text style={s.avatarRowLabel}>rounded-rect (rounded=false)</Text>
            <Variants
              items={[20, 26, 32, 40].map((sz) => ({
                label: `${sz}px`,
                node: <Avatar name="Bob Martinez" size={sz} rounded={false} />,
              }))}
            />
          </View>
        </View>
      </Spec>

      <Spec title="Avatar — all 7 AVATAR_COLORS">
        <Variants
          items={AVATAR_NAMES.map((name, i) => ({
            label: name.split(' ')[0],
            node: <Avatar name={name} size={32} />,
          }))}
        />
        <View style={s.avatarColorChips}>
          {AVATAR_COLORS.map((color, i) => (
            <View key={i} style={[s.avatarColorChip, { backgroundColor: color }]}>
              <Text style={s.avatarColorChipText}>{color}</Text>
            </View>
          ))}
        </View>
      </Spec>

      {/* ═══════════════════════ 6. LAYOUT COMPONENTS ═══════════════════════ */}
      <TierHeader title="6. Layout Components" />

      <Spec title="Section — card variant">
        <View style={{ maxWidth: 400 }}>
          <Section title="Card Section Title" subtitle="Optional subtitle text">
            <Text style={{ color: C.textSecondary, fontSize: 13 }}>
              Card variant wraps content in a bordered surface panel.
            </Text>
          </Section>
        </View>
      </Spec>

      <Spec title="Section — inline variant">
        <View style={{ maxWidth: 500 }}>
          <Section title="Inline Section" subtitle="no card chrome" variant="inline">
            <Text style={{ color: C.textSecondary, fontSize: 13 }}>
              Inline variant renders a title + horizontal rule.
            </Text>
          </Section>
        </View>
      </Spec>

      <Spec title="ChartContainer + GridLines — empty chart frame">
        <View style={{ maxWidth: 400 }}>
          <ChartContainer width={380} height={80} padding={DEFAULT_PADDING}>
            <GridLines
              horizontal={4}
              vertical={6}
              width={380}
              height={80}
              padding={DEFAULT_PADDING}
            />
          </ChartContainer>
        </View>
      </Spec>

      {/* ═══════════════════════ 7. SESSION MOLECULES ═══════════════════════ */}
      <TierHeader title="7. Session Molecules" />

      <Spec title="ToolCallRow — normal / error / agent">
        <View style={{ maxWidth: 600, gap: 2 }}>
          <ToolCallRow
            time="14:32:01"
            dotType="ok"
            badgeType="read"
            name="Read"
            path="src/services/brain-db.ts"
            durationLabel="1.2s"
            durationPct={40}
            durationColor={C.success}
            status="success"
            variant="normal"
          />
          <ToolCallRow
            time="14:32:05"
            dotType="err"
            badgeType="bash"
            name="Bash"
            path="npm test"
            durationLabel="4.8s"
            durationPct={80}
            durationColor={C.error}
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
            durationColor={C.brand}
            status="success"
            variant="agent"
          />
        </View>
      </Spec>

      <Spec title="AgentRow — live / idle / done">
        <View style={{ width: 220 }}>
          <AgentRow state="live" name="test-runner" duration="2m 14s" />
          <AgentRow state="idle" name="code-reviewer" duration="45s" />
          <AgentRow state="done" name="lint-fixer" duration="1m 02s" />
        </View>
      </Spec>

      <Spec title="KanbanColumn — ready / active / done">
        <View style={{ flexDirection: 'row', gap: 8, maxWidth: 440 }}>
          <View style={{ flex: 1 }}>
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
          <View style={{ flex: 1 }}>
            <KanbanColumn
              variant="active"
              label="Active"
              count={1}
              tasks={[{ label: 'VNM-27.04', state: 'active' }]}
            />
          </View>
          <View style={{ flex: 1 }}>
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
      </Spec>

      <Spec title="TurnSummaryCard — normal + error">
        <View style={{ maxWidth: 520, gap: 8 }}>
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
      </Spec>

      <Spec title="ErrorBlock">
        <View style={{ maxWidth: 520 }}>
          <ErrorBlock
            errorText={
              "Error: Cannot find module './missing-file.js'\n" +
              '    at Module._resolveFilename (node:internal/modules/cjs/loader:1048:15)\n' +
              '    at Module._load (node:internal/modules/cjs/loader:901:27)'
            }
          />
        </View>
      </Spec>

      <Spec title="GapIndicator">
        <View style={{ maxWidth: 520 }}>
          <GapIndicator label="23m gap" />
        </View>
      </Spec>

      {/* ═══════════════════════ 8. SESSION ORGANISMS ═══════════════════════ */}
      <TierHeader title="8. Session Organisms" />

      <Spec title="UserMessageCard">
        <View style={{ maxWidth: 620 }}>
          <UserMessageCard
            text="Let's fix the session ingestion pipeline. The structured-events.json generation is not wired up yet and we need it for the dashboard."
            timestamp="14:32:01"
          />
        </View>
      </Spec>

      <Spec title="ClaudeResponseCard — normal + error">
        <View style={{ maxWidth: 620, gap: 12 }}>
          <ClaudeResponseCard
            text="I'll wire up the structured events generation into the ingestion pipeline. This requires changes to **pipeline.ts** and **accumulator.ts** to emit the `structured-events.json` file alongside the existing session data."
            timestamp="14:32:05"
            summary={{
              callCount: 12,
              errorCount: 0,
              duration: '45s',
              pills: [
                { label: 'Read ×4', type: 'read' },
                { label: 'Edit ×3', type: 'write' },
                { label: 'Bash ×5', type: 'bash' },
              ],
            }}
          />
          <ClaudeResponseCard
            text="The test is failing because the mock doesn't include the new `tokenSnapshots` field. Let me fix the test fixture."
            timestamp="14:33:20"
            hasErrors
            summary={{
              callCount: 8,
              errorCount: 2,
              duration: '1m 12s',
              pills: [
                { label: 'Bash ×6', type: 'bash' },
                { label: 'Edit ×2', type: 'write' },
              ],
              hasErrors: true,
            }}
          />
        </View>
      </Spec>

      <Spec title="ConversationTurn">
        <View style={{ maxWidth: 660 }}>
          <ConversationTurn
            userMessage="Can you run the tests and check if the pipeline changes work?"
            userTimestamp="14:35:00"
            assistantResponse="Running the full test suite now. I'll also verify the structured events output format matches the `SessionDetailData` type from the canonical types."
            assistantTimestamp="14:35:02"
            summary={{
              callCount: 3,
              errorCount: 0,
              duration: '18s',
              pills: [
                { label: 'Bash ×2', type: 'bash' },
                { label: 'Read ×1', type: 'read' },
              ],
            }}
          />
        </View>
      </Spec>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    padding: 28,
    paddingBottom: 80,
    maxWidth: 900,
  },

  /* Page header */
  pageTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 24,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    color: C.textTertiary,
    marginBottom: 32,
  },

  /* Tier header */
  tierHeader: {
    marginTop: 36,
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(255,121,0,0.25)',
  },
  tierTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 15,
    fontWeight: '700',
    color: C.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },

  /* Spec block */
  spec: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  specTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 12,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  specBody: {
    gap: 8,
  },

  /* Variants strip */
  variantStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'flex-end',
  },
  variantCell: {
    alignItems: 'center',
    gap: 5,
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

  /* Swatch grid */
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  swatchCell: {
    alignItems: 'center',
    gap: 4,
    width: 70,
  },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  swatchLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textSecondary,
    textAlign: 'center',
  },
  swatchHex: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: C.textTertiary,
    textAlign: 'center',
  },

  /* Spacing */
  spacingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  spacingLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textSecondary,
    width: 100,
  },
  spacingBar: {
    backgroundColor: C.steel,
    borderRadius: 2,
  },
  spacingValue: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
    width: 32,
  },

  /* Radius */
  radiusCell: {
    alignItems: 'center',
    gap: 5,
  },
  radiusBox: {
    width: 48,
    height: 48,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.steel,
  },
  radiusLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textSecondary,
  },
  radiusValue: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: C.textTertiary,
  },

  /* Typography */
  typographyStack: {
    gap: 12,
  },
  typographyRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 16,
  },
  typoPreviewHeading: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 20,
    fontWeight: '700',
    color: C.textPrimary,
    width: 260,
  },
  typoPreviewBody: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    color: C.textPrimary,
    width: 260,
  },
  typoPreviewMono: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: C.textSecondary,
    width: 260,
  },
  typoPreviewXs: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    color: C.textTertiary,
    width: 260,
  },
  typoPreview3xl: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 32,
    fontWeight: '700',
    color: C.textPrimary,
    lineHeight: 32,
    width: 260,
  },
  typoMeta: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
  },

  /* Elevation */
  elevationCell: {
    alignItems: 'center',
    gap: 5,
  },
  elevationBox: {
    width: 64,
    height: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  elevationLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textSecondary,
  },
  elevationHex: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: C.textTertiary,
  },

  /* StatCard row */
  statCardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  /* Semantic color utils */
  semanticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  semanticLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
    width: 130,
    flexShrink: 0,
  },
  stripePreview: {
    width: 4,
    height: 20,
    borderRadius: 2,
  },

  /* Avatars */
  avatarRow: {
    gap: 8,
  },
  avatarRowLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 10,
    color: C.textTertiary,
    marginBottom: 6,
  },
  avatarColorChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  avatarColorChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  avatarColorChipText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#fff',
    fontWeight: '600',
  },
});
