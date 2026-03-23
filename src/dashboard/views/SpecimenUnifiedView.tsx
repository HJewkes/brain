import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { C, palette, semantic } from '../components/shared/colors.js';
import { spacing, radii, elevation } from '../tokens.js';
import { AVATAR_COLORS } from '../utils/avatar.js';
import { columnColor, priorityColor, statusColor, priorityStripeColor } from '../utils/semantic-colors.js';

// Shared components
import {
  Badge,
  Avatar,
  Card,
  UserAvatar,
  ClaudeAvatar,
  Section,
  StatCard,
  StageBadge,
  TokenGauge,
  ActivitySparkline,
  ChartContainer,
  GridLines,
  DEFAULT_PADDING,
  DetailTopbar,
  DataTable,
  RankedList,
} from '../components/shared/index.js';
import type { DataTableColumn } from '../components/shared/index.js';

// Lucide icons for iconography section
import { User, Bot, GitBranch, Terminal, FileText, Search, Folder } from 'lucide-react';

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
function _Swatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.swatchCell}>
      <View style={[s.swatch, { backgroundColor: color }]} />
      <Text style={s.swatchLabel}>{label}</Text>
      <Text style={s.swatchHex}>{color}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// WCAG contrast ratio helpers
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  // Handle rgba strings — extract approximate solid color
  if (hex.startsWith('rgba')) return -1;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const [R, G, B] = [r, g, b].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  if (l1 < 0 || l2 < 0) return -1;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Color lineage components
// ---------------------------------------------------------------------------

interface ShadeEntry {
  name: string;
  value: string;
  note?: string;
}

/** Pantone-style horizontal strip of shades for one color family */
function ColorFamily({ family, shades }: { family: string; shades: ShadeEntry[] }) {
  return (
    <View style={cs.familyBlock}>
      <Text style={cs.familyName}>{family}</Text>
      <View style={cs.shadeStrip}>
        {shades.map((shade, i) => (
          <View key={i} style={cs.shadeCell}>
            <View style={[cs.shadeSwatch, { backgroundColor: shade.value }]} />
            <Text style={cs.shadeName}>{shade.name}</Text>
            <Text style={cs.shadeHex}>{shade.value.length > 20 ? shade.value.slice(0, 20) + '...' : shade.value}</Text>
            {shade.note && <Text style={cs.shadeNote}>{shade.note}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Nested rectangles showing surface elevation levels */
function SurfaceDiagram({ layers }: { layers: Array<{ name: string; color: string; usage: string }> }) {
  return (
    <View style={cs.surfaceOuter}>
      {layers.map((layer, i) => (
        <View
          key={i}
          style={[
            cs.surfaceLayer,
            {
              backgroundColor: layer.color,
              marginLeft: i * 16,
              marginTop: i > 0 ? 4 : 0,
            },
          ]}
        >
          <View style={cs.surfaceLabelRow}>
            <Text style={cs.surfaceLabelName}>{layer.name}</Text>
            <Text style={cs.surfaceLabelHex}>{layer.color}</Text>
          </View>
          <Text style={cs.surfaceUsage}>{layer.usage}</Text>
        </View>
      ))}
    </View>
  );
}

/** FG/BG contrast pair with computed ratio */
function ContrastPair({ fg, bg, fgLabel, bgLabel }: {
  fg: string; bg: string; fgLabel: string; bgLabel: string;
}) {
  const ratio = contrastRatio(fg, bg);
  const ratioStr = ratio < 0 ? 'N/A' : `${ratio.toFixed(1)}:1`;
  const pass = ratio >= 4.5;
  const indicator = ratio < 0 ? '—' : pass ? ' PASS' : ' WARN';
  const indicatorColor = ratio < 0 ? C.textTertiary : pass ? palette.teal.base : palette.amber.base;

  return (
    <View style={cs.contrastRow}>
      <View style={[cs.contrastPreview, { backgroundColor: bg }]}>
        <Text style={[cs.contrastPreviewText, { color: fg }]}>Aa</Text>
      </View>
      <View style={cs.contrastMeta}>
        <Text style={cs.contrastLabel}>
          {fgLabel} on {bgLabel}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={cs.contrastRatio}>{ratioStr}</Text>
          <Text style={[cs.contrastIndicator, { color: indicatorColor }]}>{indicator}</Text>
        </View>
      </View>
    </View>
  );
}

/** Semantic mapping row: label + arrow + swatch + source */
function SemanticRow({ label, color, source }: { label: string; color: string; source: string }) {
  return (
    <View style={cs.semRow}>
      <Text style={cs.semLabel}>{label}</Text>
      <Text style={cs.semArrow}>{'<--'}</Text>
      <View style={[cs.semSwatch, { backgroundColor: color }]} />
      <Text style={cs.semSource}>{source}</Text>
    </View>
  );
}

/** Tree-style component token lineage trace */
function TokenLineage({ component: name, lines }: {
  component: string;
  lines: Array<{ prop: string; value: string; hex: string; source: string }>;
}) {
  return (
    <View style={cs.lineageBlock}>
      <Text style={cs.lineageName}>{name}</Text>
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1;
        const prefix = isLast ? '\u2514\u2500\u2500' : '\u251C\u2500\u2500';
        return (
          <View key={i} style={cs.lineageRow}>
            <Text style={cs.lineagePrefix}>{prefix}</Text>
            <Text style={cs.lineageProp}>{line.prop}:</Text>
            <View style={[cs.lineageSwatch, { backgroundColor: line.hex }]} />
            <Text style={cs.lineageValue}>{line.value}</Text>
            <Text style={cs.lineageSource}>{line.source}</Text>
          </View>
        );
      })}
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

      {/* ── Section 1: Base Color Library ── */}
      <Spec title="1a. Base Color Library">
        <ColorFamily
          family="BRAND (Orange)"
          shades={[
            { name: 'brand-900', value: '#D0620C', note: 'darkest' },
            { name: 'brand-700', value: '#FF7900', note: 'base — primary brand' },
            { name: 'brand-500', value: '#FFA860', note: 'light' },
            { name: 'brand-300', value: palette.brand.dim25, note: 'border' },
            { name: 'brand-200', value: palette.brand.dim12, note: 'badge bg' },
            { name: 'brand-100', value: palette.brand.dim06, note: 'card bg' },
          ]}
        />
        <ColorFamily
          family="TEAL (Success)"
          shades={[
            { name: 'teal-900', value: '#0D7D71', note: 'darkest' },
            { name: 'teal-700', value: '#14B8A6', note: 'base — success/done' },
            { name: 'teal-300', value: palette.teal.dim25, note: 'border' },
            { name: 'teal-200', value: palette.teal.dim12, note: 'badge bg' },
            { name: 'teal-100', value: palette.teal.dim10, note: 'dim bg' },
          ]}
        />
        <ColorFamily
          family="RED (Error)"
          shades={[
            { name: 'red-900', value: '#9B0308', note: 'darkest' },
            { name: 'red-700', value: '#DC050C', note: 'base — error/blocked' },
            { name: 'red-500', value: '#F87171', note: 'light — error text' },
            { name: 'red-300', value: palette.red.dim25, note: 'border' },
            { name: 'red-200', value: palette.red.dim12, note: 'badge bg' },
            { name: 'red-100', value: palette.red.dim05, note: 'dim bg' },
          ]}
        />
        <ColorFamily
          family="AMBER / GOLD (Warning)"
          shades={[
            { name: 'amber-700', value: '#F4A736', note: 'base — warning/edit' },
            { name: 'amber-400', value: palette.amber.dim40, note: 'glow' },
            { name: 'amber-200', value: palette.amber.dim15, note: 'badge bg' },
            { name: 'gold-700', value: '#D4A520', note: 'base — ready/queued' },
            { name: 'gold-200', value: palette.gold.dim12, note: 'badge bg' },
          ]}
        />
        <ColorFamily
          family="BLUE (Info)"
          shades={[
            { name: 'blue-900', value: '#1965B0', note: 'dark — chart/read bg' },
            { name: 'blue-700', value: '#2196F3', note: 'base — info/inprogress' },
            { name: 'blue-400', value: '#7BAFDE', note: 'light — read tool fg' },
          ]}
        />
        <ColorFamily
          family="USER BLUE (Messages)"
          shades={[
            { name: 'userblue-700', value: '#5B9BD5', note: 'base — user accent' },
            { name: 'userblue-500', value: palette.userBlue.border50, note: 'border 50%' },
            { name: 'userblue-300', value: palette.userBlue.dim35, note: 'minimap tick' },
            { name: 'userblue-100', value: palette.userBlue.bgDark, note: 'card bg' },
          ]}
        />
        <ColorFamily
          family="STEEL (Secondary)"
          shades={[
            { name: 'steel-700', value: '#406D87', note: 'base — workstream badge' },
            { name: 'steel-300', value: palette.steel.dim30, note: 'border' },
            { name: 'steel-200', value: palette.steel.dim15, note: 'badge bg' },
          ]}
        />
        <ColorFamily
          family="PURPLE (Review)"
          shades={[
            { name: 'purple-700', value: '#A855F7', note: 'base — review/grep' },
            { name: 'purple-500', value: '#C084FC', note: 'light — grep fg' },
            { name: 'purple-200', value: palette.purple.dim20, note: 'bg' },
          ]}
        />
        <ColorFamily
          family="GREEN (Live)"
          shades={[
            { name: 'green-700', value: '#22c55e', note: 'base — live dot' },
            { name: 'green-400', value: palette.green.dim50, note: 'glow' },
          ]}
        />
        <ColorFamily
          family="CHARCOAL / NEUTRAL"
          shades={[
            { name: 'charcoal-900', value: '#101010', note: 'page bg' },
            { name: 'charcoal-800', value: '#161616', note: 'surface1' },
            { name: 'charcoal-750', value: '#191919', note: 'surface2' },
            { name: 'charcoal-700', value: '#1e1e1e', note: 'surface3' },
            { name: 'charcoal-600', value: '#2a2a2a', note: 'border' },
            { name: 'charcoal-400', value: '#4B5563', note: 'gray darker' },
            { name: 'charcoal-300', value: '#6B7280', note: 'textTertiary' },
            { name: 'charcoal-200', value: '#9CA3AF', note: 'textSecondary' },
            { name: 'charcoal-100', value: '#F3F4F6', note: 'textPrimary' },
          ]}
        />
      </Spec>

      {/* ── Section 2: Surface & Background System ── */}
      <Spec title="1b. Surface & Background System">
        <SurfaceDiagram
          layers={[
            { name: 'bg', color: palette.bg, usage: 'Page background, scrollable area' },
            { name: 'surface1', color: palette.surface1, usage: 'Sidebar, session sidebar, stat cards, drawers' },
            { name: 'surface2', color: palette.surface2, usage: 'Plain cards, nested panels, tool rows' },
            { name: 'surface3', color: palette.surface3, usage: 'Tooltips, dropdowns, gauge tracks, floating UI' },
          ]}
        />
      </Spec>

      {/* ── Section 3: FG/BG Contrast Pairing ── */}
      <Spec title="1c. Foreground / Background Contrast Pairs">
        <View style={cs.contrastGrid}>
          <ContrastPair fg="#F3F4F6" bg="#101010" fgLabel="textPrimary" bgLabel="bg" />
          <ContrastPair fg="#9CA3AF" bg="#161616" fgLabel="textSecondary" bgLabel="surface1" />
          <ContrastPair fg="#6B7280" bg="#101010" fgLabel="textTertiary" bgLabel="bg" />
          <ContrastPair fg="#FF7900" bg="#101010" fgLabel="brand" bgLabel="bg" />
          <ContrastPair fg="#14B8A6" bg="#161616" fgLabel="teal (success)" bgLabel="surface1" />
          <ContrastPair fg="#DC050C" bg="#191919" fgLabel="red (error)" bgLabel="surface2" />
          <ContrastPair fg="#F4A736" bg="#101010" fgLabel="amber (warning)" bgLabel="bg" />
          <ContrastPair fg="#2196F3" bg="#161616" fgLabel="blue (info)" bgLabel="surface1" />
          <ContrastPair fg="#A855F7" bg="#101010" fgLabel="purple (review)" bgLabel="bg" />
          <ContrastPair fg="#F87171" bg="#191919" fgLabel="red light (error text)" bgLabel="surface2" />
          <ContrastPair fg="#5B9BD5" bg="#101010" fgLabel="userBlue" bgLabel="bg" />
        </View>
      </Spec>

      {/* ── Section 4: Semantic Color Mapping ── */}
      <Spec title="1d. Semantic Color Mapping — Status">
        <View style={cs.semGroup}>
          <SemanticRow label="success / done / completed" color={palette.teal.base} source="Teal-700 (#14B8A6)" />
          <SemanticRow label="active / running" color={palette.brand.base} source="Brand-700 (#FF7900)" />
          <SemanticRow label="error / failed / blocked" color={palette.red.base} source="Red-700 (#DC050C)" />
          <SemanticRow label="warning / idle / ready" color={palette.amber.base} source="Amber-700 (#F4A736)" />
          <SemanticRow label="info / in-progress" color={palette.blue.base} source="Blue-700 (#2196F3)" />
          <SemanticRow label="review" color={palette.purple.base} source="Purple-700 (#A855F7)" />
          <SemanticRow label="live (agent dot)" color={palette.green.base} source="Green-700 (#22c55e)" />
          <SemanticRow label="pending" color={palette.gray.dark} source="Charcoal-300 (#6B7280)" />
        </View>
      </Spec>

      <Spec title="1d. Semantic Color Mapping — Tool Types">
        <View style={cs.semGroup}>
          <SemanticRow label="read" color={palette.blue.light} source="Blue-400 (#7BAFDE)" />
          <SemanticRow label="write" color={palette.teal.base} source="Teal-700 (#14B8A6)" />
          <SemanticRow label="edit" color={palette.amber.base} source="Amber-700 (#F4A736)" />
          <SemanticRow label="bash" color={palette.gray.base} source="Charcoal-200 (#9CA3AF)" />
          <SemanticRow label="grep / glob" color={palette.purple.light} source="Purple-500 (#C084FC)" />
          <SemanticRow label="agent" color={palette.brand.base} source="Brand-700 (#FF7900)" />
        </View>
      </Spec>

      <Spec title="1d. Semantic Color Mapping — Roles">
        <View style={cs.semGroup}>
          <SemanticRow label="user" color={palette.userBlue.base} source="UserBlue-700 (#5B9BD5)" />
          <SemanticRow label="claude" color={palette.brand.base} source="Brand-700 (#FF7900)" />
        </View>
      </Spec>

      <Spec title="1d. Semantic Color Mapping — Column / Stage">
        <View style={cs.semGroup}>
          <SemanticRow label="blocked" color={palette.red.base} source="Red-700 (#DC050C)" />
          <SemanticRow label="ready" color={palette.gold.base} source="Gold-700 (#D4A520)" />
          <SemanticRow label="in-progress" color={palette.blue.base} source="Blue-700 (#2196F3)" />
          <SemanticRow label="review" color={palette.purple.base} source="Purple-700 (#A855F7)" />
          <SemanticRow label="done" color={palette.teal.base} source="Teal-700 (#14B8A6)" />
        </View>
      </Spec>

      {/* ── Section 5: Component Token Lineage ── */}
      <Spec title="1e. Component Token Lineage">
        <TokenLineage
          component="UserMessageCard"
          lines={[
            { prop: 'bg', value: 'role.user.bg', hex: 'rgba(20,50,90,0.35)', source: 'UserBlue family, bgDark' },
            { prop: 'border', value: 'role.user.border', hex: 'rgba(91,155,213,0.50)', source: 'UserBlue family, border50' },
            { prop: 'left accent', value: 'role.user.accent', hex: '#5B9BD5', source: 'UserBlue-700 base' },
            { prop: 'label text', value: 'role.user.text', hex: '#7BAFDE', source: 'Blue-400 light' },
            { prop: 'body text', value: 'text.primary', hex: '#F3F4F6', source: 'Charcoal-100' },
          ]}
        />
        <TokenLineage
          component="ClaudeResponseCard"
          lines={[
            { prop: 'bg', value: 'role.claude.bg', hex: '#1a1400', source: 'Brand family, shade 100' },
            { prop: 'border', value: 'role.claude.border', hex: 'rgba(255,121,0,0.25)', source: 'Brand-300 dim25' },
            { prop: 'left accent', value: 'brand.base', hex: '#FF7900', source: 'Brand-700 base' },
            { prop: 'label text', value: 'role.claude.text', hex: '#FF7900', source: 'Brand-700 base' },
            { prop: 'body text', value: 'text.primary', hex: '#F3F4F6', source: 'Charcoal-100' },
          ]}
        />
        <TokenLineage
          component="Badge (success variant)"
          lines={[
            { prop: 'fg', value: 'teal.base', hex: '#14B8A6', source: 'Teal-700 base' },
            { prop: 'bg', value: 'teal @ 0.12', hex: 'rgba(20,184,166,0.12)', source: 'Teal-200 dim12' },
            { prop: 'border', value: 'teal @ 0.25', hex: 'rgba(20,184,166,0.25)', source: 'Teal-300 dim25' },
          ]}
        />
        <TokenLineage
          component="ToolCallRow (error variant)"
          lines={[
            { prop: 'bg', value: 'toolCallRow.errorBg', hex: 'rgba(220,5,12,0.05)', source: 'Red-100 dim05' },
            { prop: 'border', value: 'toolCallRow.errorBorder', hex: 'rgba(220,5,12,0.25)', source: 'Red-300 dim25' },
            { prop: 'dot', value: 'red.base', hex: '#DC050C', source: 'Red-700 base' },
            { prop: 'badge fg', value: 'tool.bash.fg', hex: '#9CA3AF', source: 'Charcoal-200 gray.base' },
            { prop: 'text', value: 'text.primary', hex: '#F3F4F6', source: 'Charcoal-100' },
          ]}
        />
        <TokenLineage
          component="KanbanCard (active)"
          lines={[
            { prop: 'header bg', value: 'kanbanHead.active.bg', hex: 'rgba(255,121,0,0.12)', source: 'Brand-200 dim12' },
            { prop: 'header fg', value: 'kanbanHead.active.fg', hex: '#FF7900', source: 'Brand-700 base' },
            { prop: 'pill bg', value: 'taskPill.active.bg', hex: 'rgba(255,121,0,0.15)', source: 'Brand-200 dim15' },
            { prop: 'pill fg', value: 'taskPill.active.fg', hex: '#FF7900', source: 'Brand-700 base' },
            { prop: 'pill border', value: 'taskPill.active.border', hex: '#FF7900', source: 'Brand-700 base' },
          ]}
        />
      </Spec>

      {/* ── Spacing, Radius, Typography, Elevation (unchanged) ── */}
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
            { label: 'border', node: <Dot size={8} color={palette.userBlue.base} border={{ width: 2, color: C.bg }} /> },
            { label: 'glow', node: <Dot size={7} color={palette.green.base} glow={palette.green.dim50} /> },
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
          <MiniBar label="Read" pct={65} count={142} color={semantic.tool.read.fg} />
          <MiniBar label="Write" pct={30} count={66} color={semantic.tool.write.fg} />
          <MiniBar label="Bash" pct={45} count={98} color={semantic.tool.edit.fg} />
          <MiniBar label="Agent" pct={15} count={32} color={semantic.tool.agent.fg} />
          <MiniBar label="Grep" pct={20} count={44} color={semantic.tool.grep.fg} />
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
          items={AVATAR_NAMES.map((name, _i) => ({
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

      {/* ═══════════════════════ 5b. ICONOGRAPHY ═══════════════════════ */}
      <TierHeader title="5b. Iconography" />

      <Spec title="Role avatars — UserAvatar / ClaudeAvatar at 16, 20, 24, 32">
        <View style={{ gap: 16 }}>
          <View style={s.avatarRow}>
            <Text style={s.avatarRowLabel}>UserAvatar</Text>
            <Variants
              items={[16, 20, 24, 32].map((sz) => ({
                label: `${sz}px`,
                node: <UserAvatar size={sz} />,
              }))}
            />
          </View>
          <View style={s.avatarRow}>
            <Text style={s.avatarRowLabel}>ClaudeAvatar</Text>
            <Variants
              items={[16, 20, 24, 32].map((sz) => ({
                label: `${sz}px`,
                node: <ClaudeAvatar size={sz} />,
              }))}
            />
          </View>
        </View>
      </Spec>

      <Spec title="Lucide icons — useful glyphs at 16px">
        <Variants
          items={[
            { label: 'User', node: <User size={16} color={C.textSecondary} /> },
            { label: 'Bot', node: <Bot size={16} color={C.textSecondary} /> },
            { label: 'GitBranch', node: <GitBranch size={16} color={C.textSecondary} /> },
            { label: 'Terminal', node: <Terminal size={16} color={C.textSecondary} /> },
            { label: 'FileText', node: <FileText size={16} color={C.textSecondary} /> },
            { label: 'Search', node: <Search size={16} color={C.textSecondary} /> },
            { label: 'Folder', node: <Folder size={16} color={C.textSecondary} /> },
          ]}
        />
      </Spec>

      {/* ═══════════════════════ 5c. CARD VARIANTS ═══════════════════════ */}
      <TierHeader title="5c. Card Variants" />

      <Spec title="Card — plain / accent (blue) / accent (orange) / subtle">
        <View style={{ maxWidth: 520, gap: 12 }}>
          <Card variant="plain">
            <Text style={{ color: C.textPrimary, fontSize: 13 }}>
              Plain card — surface2 background with standard border.
            </Text>
          </Card>
          <Card variant="accent" accentColor={palette.userBlue.base}>
            <Text style={{ color: C.textPrimary, fontSize: 13 }}>
              Accent card (blue) — colored left border, like UserMessageCard.
            </Text>
          </Card>
          <Card variant="accent" accentColor={C.brand} accentWidth={3} bg={semantic.role.claude.bg}>
            <Text style={{ color: C.textPrimary, fontSize: 13 }}>
              Accent card (orange) — brand left border, like ClaudeResponseCard.
            </Text>
          </Card>
          <Card variant="subtle" accentColor={C.brand}>
            <Text style={{ color: C.textPrimary, fontSize: 13 }}>
              Subtle card — semi-transparent bg with colored border, like TurnSummaryCard.
            </Text>
          </Card>
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

      {/* ═══════════════════════ 9. SHARED MOLECULES ═══════════════════════ */}
      <TierHeader title="9. Shared Molecules" />

      <Spec title="DetailTopbar">
        <View style={{ maxWidth: 720 }}>
          <DetailTopbar
            title="SNS-030"
            backLabel="Sessions"
            badge={{ label: 'Complete', color: palette.teal.base }}
            metadata={[{ label: 'Started', value: 'Mar 17, 2:30 PM' }, { label: 'Duration', value: '1h 14m' }]}
            searchQuery=""
            onSearchChange={() => {}}
          />
        </View>
      </Spec>

      <Spec title="DataTable">
        <View style={{ maxWidth: 560 }}>
          <DataTable<{ id: string; name: string; tasks: number; errors: number; rate: string }>
            columns={[
              { key: 'name', label: 'Name', flex: 2 },
              { key: 'tasks', label: 'Tasks', width: 70, align: 'right' },
              { key: 'errors', label: 'Errors', width: 70, align: 'right' },
              { key: 'rate', label: 'Rate', width: 80, align: 'right' },
            ] satisfies DataTableColumn[]}
            data={[
              { id: 'a1', name: 'agent-impl-001', tasks: 12, errors: 0, rate: '100%' },
              { id: 'a2', name: 'agent-review-002', tasks: 8, errors: 1, rate: '88%' },
              { id: 'a3', name: 'agent-test-003', tasks: 5, errors: 2, rate: '60%' },
              { id: 'a4', name: 'agent-coord-004', tasks: 3, errors: 0, rate: '100%' },
            ]}
            renderCell={(item, key) => {
              if (key === 'name') return <Text style={{ fontSize: 13, color: C.textPrimary }}>{item.name}</Text>;
              if (key === 'tasks') return <Text style={{ fontSize: 13, color: C.textSecondary, textAlign: 'right' }}>{item.tasks}</Text>;
              if (key === 'errors') return <Text style={{ fontSize: 13, color: item.errors > 0 ? C.error : C.textTertiary, textAlign: 'right' }}>{item.errors}</Text>;
              if (key === 'rate') return <Text style={{ fontSize: 13, color: C.textSecondary, textAlign: 'right' }}>{item.rate}</Text>;
              return null;
            }}
            highlightRow={item => item.errors === 0}
            getKey={item => item.id}
          />
        </View>
      </Spec>

      <Spec title="RankedList — errors with bars">
        <View style={{ maxWidth: 420 }}>
          <RankedList
            showBars
            items={[
              { label: 'Tool not found', value: 7, sublabel: 'Bash', color: palette.red.base, badge: 'critical', badgeHighlight: true },
              { label: 'File not found', value: 5, sublabel: 'Read', color: palette.amber.base, badge: 'warning' },
              { label: 'Type mismatch', value: 4, sublabel: 'TypeScript', color: palette.gold.base },
              { label: 'Network timeout', value: 2, sublabel: 'WebFetch', color: palette.teal.base },
              { label: 'Permission denied', value: 1, sublabel: 'Bash', color: palette.purple.base },
            ]}
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
    borderBottomColor: palette.brand.dim25,
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
    color: semantic.text.inverse,
    fontWeight: '600',
  },
});

// ---------------------------------------------------------------------------
// Color lineage styles
// ---------------------------------------------------------------------------

const cs = StyleSheet.create({
  /* ColorFamily */
  familyBlock: {
    marginBottom: 16,
  },
  familyName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 8,
    letterSpacing: 0.6,
  },
  shadeStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  shadeCell: {
    alignItems: 'center',
    gap: 3,
    width: 72,
  },
  shadeSwatch: {
    width: 32,
    height: 32,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  shadeName: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: C.textSecondary,
    textAlign: 'center',
  },
  shadeHex: {
    fontFamily: 'monospace',
    fontSize: 7,
    color: C.textTertiary,
    textAlign: 'center',
  },
  shadeNote: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 7,
    color: C.textTertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  /* SurfaceDiagram */
  surfaceOuter: {
    gap: 0,
  },
  surfaceLayer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  surfaceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  surfaceLabelName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 11,
    fontWeight: '600',
    color: C.textPrimary,
  },
  surfaceLabelHex: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
  },
  surfaceUsage: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 10,
    color: C.textSecondary,
    marginTop: 2,
  },

  /* ContrastPair */
  contrastGrid: {
    gap: 6,
  },
  contrastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  contrastPreview: {
    width: 36,
    height: 28,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contrastPreviewText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    fontWeight: '700',
  },
  contrastMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  contrastLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textSecondary,
    flex: 1,
  },
  contrastRatio: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '600',
    color: C.textPrimary,
    width: 44,
    textAlign: 'right',
  },
  contrastIndicator: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    width: 36,
  },

  /* SemanticRow */
  semGroup: {
    gap: 4,
  },
  semRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  semLabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 11,
    color: C.textSecondary,
    width: 180,
    flexShrink: 0,
  },
  semArrow: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
    width: 24,
    textAlign: 'center',
  },
  semSwatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  semSource: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
  },

  /* TokenLineage */
  lineageBlock: {
    marginBottom: 16,
    backgroundColor: palette.surface1,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  lineageName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 12,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 6,
  },
  lineageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  lineagePrefix: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textTertiary,
    width: 24,
  },
  lineageProp: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.textSecondary,
    width: 100,
  },
  lineageSwatch: {
    width: 12,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  lineageValue: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: C.textPrimary,
    width: 140,
  },
  lineageSource: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 9,
    color: C.textTertiary,
    fontStyle: 'italic',
  },
});
