import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { C } from '../components/shared/colors.js';
import { columnColor, priorityColor, priorityStripeColor } from '../utils/semantic-colors.js';
import { AVATAR_COLORS } from '../utils/avatar.js';
import { StatCard } from '../components/shared/StatCard.js';
import { StageBadge } from '../components/shared/StageBadge.js';
import { TokenGauge } from '../components/shared/TokenGauge.js';
import { ActivitySparkline } from '../components/shared/ActivitySparkline.js';
import type { SparkEvent } from '../components/shared/ActivitySparkline.js';

/* ── Specimen helpers (same pattern as SpecimenView.tsx) ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

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

function ComponentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.componentRow}>
      <Text style={s.componentLabel}>{label}</Text>
      <View style={s.componentBody}>{children}</View>
    </View>
  );
}

/* ── Sample data ── */

const SPARK_DATA = [3, 7, 4, 8, 2, 6, 9, 5, 11, 7, 3, 8, 12, 6, 4];

const SPARK_EVENTS: SparkEvent[] = [
  { type: 'read', magnitude: 3 },
  { type: 'write', magnitude: 5 },
  { type: 'bash', magnitude: 2 },
  { type: 'read', magnitude: 7 },
  { type: 'write', magnitude: 1 },
  { type: 'bash', magnitude: 4 },
  { type: 'read', magnitude: 6 },
  { type: 'error', magnitude: 8 },
  { type: 'search', magnitude: 3 },
  { type: 'read', magnitude: 5 },
  { type: 'write', magnitude: 9 },
  { type: 'bash', magnitude: 2 },
];

const COL_LABEL: Record<string, string> = {
  blocked: 'Blocked',
  ready: 'Ready',
  inprogress: 'In Progress',
  review: 'PR / Review',
  done: 'Done',
};


/* ── Inline specimen primitives (self-contained, no external deps needed) ── */

function SpecimenPriorityStripe({ priority, color }: { priority: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{
        width: 3, height: 44, backgroundColor: color, borderRadius: 2,
      }} />
      <View style={{
        backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
        borderRadius: 8, padding: 10, paddingLeft: 14, width: 140,
      }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: C.brand, fontFamily: 'Space Grotesk, monospace' }}>
          VNM-21.04
        </Text>
        <Text style={{ fontSize: 10, color: C.textSecondary, marginTop: 2 }}>
          {priority} priority
        </Text>
      </View>
    </View>
  );
}

function SpecimenBadge({ label, bg, fg, border }: { label: string; bg: string; fg: string; border?: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
      backgroundColor: bg, borderWidth: 1, borderColor: border ?? 'transparent',
    }}>
      <Text style={{ fontSize: 11, fontWeight: '500', color: fg }}>{label}</Text>
    </View>
  );
}

function SpecimenBadgeWithDot({ label, dotColor, bg, fg, border }: { label: string; dotColor: string; bg: string; fg: string; border?: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
      backgroundColor: bg, borderWidth: 1, borderColor: border ?? 'transparent',
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} />
      <Text style={{ fontSize: 11, fontWeight: '500', color: fg }}>{label}</Text>
    </View>
  );
}

function SpecimenColumnHeader({ col }: { col: string }) {
  const accent = columnColor(col);
  const label = COL_LABEL[col] ?? col;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: C.surface2, borderRadius: 10,
      borderWidth: 1, borderColor: C.border,
      borderTopWidth: 2, borderTopColor: accent,
      width: 160,
    }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
      <Text style={{
        fontSize: 12, fontWeight: '600', color: C.textPrimary,
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {label}
      </Text>
      <View style={{ backgroundColor: C.surface3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
        <Text style={{ fontSize: 11, color: C.textSecondary, fontWeight: '500' }}>3</Text>
      </View>
    </View>
  );
}

function SpecimenAvatar({ name, color, size }: { name: string; color: string; size: number }) {
  const ini = name.slice(0, 2).toUpperCase();
  return (
    <View style={{
      width: size, height: size, borderRadius: size > 30 ? 10 : size / 2,
      backgroundColor: color, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontSize: size * 0.3, fontWeight: '700', color: '#fff', fontFamily: 'Space Grotesk, sans-serif' }}>
        {ini}
      </Text>
    </View>
  );
}

function SpecimenAgentCard({ name, status, color }: { name: string; status: string; color: string }) {
  const statusColor = status === 'active' ? C.success : status === 'idle' ? C.textTertiary : C.textTertiary;
  return (
    <View style={{
      backgroundColor: C.surface1, borderWidth: 1, borderColor: C.border,
      borderRadius: 10, padding: 14, alignItems: 'center', gap: 6, width: 130,
    }}>
      <View style={{ position: 'relative' }}>
        <SpecimenAvatar name={name} color={color} size={40} />
        <View style={{
          position: 'absolute', bottom: -1, right: -1,
          width: 10, height: 10, borderRadius: 5,
          backgroundColor: statusColor, borderWidth: 2, borderColor: C.surface1,
        }} />
      </View>
      <Text style={{ fontSize: 12, fontWeight: '600', color: C.textPrimary }}>{name}</Text>
      <Text style={{ fontSize: 10, color: C.textTertiary, textTransform: 'uppercase' }}>{status}</Text>
    </View>
  );
}

function SpecimenTopoNode({ name, role, color, isActive }: { name: string; role: string; color: string; isActive: boolean }) {
  const statusDotColor = isActive ? C.success : C.textTertiary;
  return (
    <View style={{
      backgroundColor: C.surface1, borderWidth: 1, borderColor: C.border,
      borderRadius: 10, padding: 16, alignItems: 'center', gap: 4, minWidth: 120,
    }}>
      <SpecimenAvatar name={name} color={color} size={40} />
      <Text style={{ fontSize: 12, fontWeight: '600', color: C.textPrimary }}>{name}</Text>
      <Text style={{ fontSize: 10, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }}>{role}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusDotColor }} />
        <Text style={{ fontSize: 10, fontWeight: '500', color: statusDotColor }}>
          {isActive ? 'active' : 'idle'}
        </Text>
      </View>
    </View>
  );
}

function SpecimenSessionRow({ displayId, status, selected }: { displayId: string; status: string; selected: boolean }) {
  const sColor = status === 'active' ? C.success : status === 'error' ? C.error : C.textTertiary;
  return (
    <View style={{
      padding: 12, borderBottomWidth: 1, borderBottomColor: C.border,
      borderLeftWidth: selected ? 3 : 0, borderLeftColor: selected ? C.brand : 'transparent',
      paddingLeft: selected ? 9 : 12,
      backgroundColor: selected ? 'rgba(255,121,0,0.04)' : 'transparent',
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' }}>
          {displayId}
        </Text>
        <View style={{ borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: `${sColor}26` }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: sColor, textTransform: 'uppercase' }}>{status}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>5m ago</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 11, color: C.textSecondary }}>12.5k in / 3.2k out</Text>
        <Text style={{ fontSize: 11, color: C.textSecondary }}>48 tools</Text>
      </View>
    </View>
  );
}

function SpecimenEventDot({ outcome }: { outcome: 'success' | 'error' | 'info' }) {
  const color = outcome === 'error' ? C.error : outcome === 'info' ? C.info : C.success;
  return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />;
}

function SpecimenFilterButton({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={{
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
      borderWidth: 1,
      borderColor: active ? C.brand : C.border,
      backgroundColor: active ? C.brand : C.surface2,
    }}>
      <Text style={{ fontSize: 11, fontWeight: '500', color: active ? '#fff' : C.textTertiary }}>
        {label}
      </Text>
    </View>
  );
}

function SpecimenInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 14, color: C.textPrimary }}>{value}</Text>
    </View>
  );
}

function SpecimenDepNode({ icon, iconColor, id, title, col }: { icon: string; iconColor: string; id: string; title: string; col: string }) {
  const cColor = columnColor(col);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <View style={{ width: 12, height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.border }} />
      <Text style={{ fontSize: 13, color: iconColor, width: 14, textAlign: 'center' }}>{icon}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: C.brand, fontFamily: 'Space Grotesk, monospace' }}>{id}</Text>
      <Text style={{ flex: 1, fontSize: 13, color: C.textSecondary }}>{title}</Text>
      <SpecimenBadgeWithDot
        label={COL_LABEL[col] ?? col}
        dotColor={cColor}
        bg={`${cColor}18`}
        fg={cColor}
        border={`${cColor}40`}
      />
    </View>
  );
}

function SpecimenTimelineDot() {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 16, alignItems: 'center', paddingTop: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand }} />
        <View style={{ width: 2, height: 24, backgroundColor: C.border, marginTop: 4 }} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontSize: 11, color: C.textTertiary }}>Mar 17, 2:32 PM</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: C.warning }}>Ready</Text>
          <Text style={{ fontSize: 13, color: C.textTertiary }}>→</Text>
          <Text style={{ fontSize: 13, fontWeight: '500', color: C.brand }}>In Progress</Text>
        </View>
      </View>
    </View>
  );
}


/* ── SVG chart helpers ── */

function SpecimenBurndownChart() {
  const W = 400;
  const H = 140;
  const PAD = { top: 10, right: 40, bottom: 24, left: 32 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const points = [
    { label: 'D1', ideal: 20, actual: 20 },
    { label: 'D2', ideal: 17, actual: 19 },
    { label: 'D3', ideal: 14, actual: 16 },
    { label: 'D4', ideal: 11, actual: 14 },
    { label: 'D5', ideal: 8, actual: 10 },
    { label: 'D6', ideal: 5, actual: 7 },
    { label: 'D7', ideal: 2, actual: 4 },
  ];

  const maxY = 20;
  const xp = (i: number) => PAD.left + (i / (points.length - 1)) * cW;
  const yp = (v: number) => PAD.top + cH - (v / maxY) * cH;

  const idealPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xp(i).toFixed(1)},${yp(p.ideal).toFixed(1)}`).join(' ');
  const actualPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xp(i).toFixed(1)},${yp(p.actual).toFixed(1)}`).join(' ');
  const areaPath = actualPath + ` L${xp(points.length - 1).toFixed(1)},${yp(0).toFixed(1)} L${xp(0).toFixed(1)},${yp(0).toFixed(1)} Z`;

  return (
    <View style={{ width: '100%' }}>
      {/* @ts-ignore — svg is valid in react-native-web */}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[0, 10, 20].map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={yp(v)} x2={W - PAD.right} y2={yp(v)} stroke={C.border} strokeWidth="0.5" opacity="0.6" />
            <text x={PAD.left - 4} y={yp(v) + 3} fill={C.textTertiary} fontSize="9" textAnchor="end">{v}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={i} x={xp(i)} y={H - 4} fill={C.textTertiary} fontSize="9" textAnchor="middle">{p.label}</text>
        ))}
        <path d={areaPath} fill={C.brand} opacity="0.12" />
        <path d={idealPath} fill="none" stroke={C.textSecondary} strokeWidth="1.5" strokeDasharray="4,4" />
        <path d={actualPath} fill="none" stroke={C.brand} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={xp(i)} cy={yp(p.actual)} r="3" fill={C.brand} />
        ))}
        <text x={xp(6) + 4} y={yp(4) + 3} fill={C.brand} fontSize="9">Actual</text>
        <text x={xp(6) + 4} y={yp(2) + 3} fill={C.textTertiary} fontSize="9">Ideal</text>
      </svg>
    </View>
  );
}

function SpecimenVelocityChart() {
  const W = 400;
  const H = 130;
  const PAD = { top: 10, right: 20, bottom: 24, left: 32 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const points = [
    { label: 'M', count: 2 },
    { label: 'T', count: 5 },
    { label: 'W', count: 3 },
    { label: 'T', count: 7 },
    { label: 'F', count: 4 },
    { label: 'S', count: 1 },
    { label: 'S', count: 6 },
  ];

  const maxY = 7;
  const xp = (i: number) => PAD.left + (i / (points.length - 1)) * cW;
  const yp = (v: number) => PAD.top + cH - (v / maxY) * cH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xp(i).toFixed(1)},${yp(p.count).toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L${xp(points.length - 1).toFixed(1)},${yp(0).toFixed(1)} L${xp(0).toFixed(1)},${yp(0).toFixed(1)} Z`;

  return (
    <View style={{ width: '100%' }}>
      {/* @ts-ignore — svg is valid in react-native-web */}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[0, 4, 7].map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={yp(v)} x2={W - PAD.right} y2={yp(v)} stroke={C.border} strokeWidth="0.5" opacity="0.6" />
            <text x={PAD.left - 4} y={yp(v) + 3} fill={C.textTertiary} fontSize="9" textAnchor="end">{v}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={i} x={xp(i)} y={H - 4} fill={C.textTertiary} fontSize="9" textAnchor="middle">{p.label}</text>
        ))}
        <path d={areaPath} fill={C.success} opacity="0.12" />
        <path d={linePath} fill="none" stroke={C.success} strokeWidth="2" />
        {points.map((p, i) => (
          p.count > 0 ? <circle key={i} cx={xp(i)} cy={yp(p.count)} r="3" fill={C.success} /> : null
        ))}
      </svg>
    </View>
  );
}

function SpecimenBarChart() {
  const data = [
    { label: 'Ready', value: 45, color: C.warning },
    { label: 'In Progress', value: 80, color: C.brand },
    { label: 'Review', value: 30, color: C.info },
    { label: 'Done', value: 100, color: C.success },
    { label: 'Blocked', value: 15, color: C.error },
  ];
  const maxVal = Math.max(...data.map(d => d.value));

  return (
    <View style={{ gap: 10 }}>
      {data.map(d => (
        <View key={d.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 12, color: C.textSecondary, width: 80 }}>{d.label}</Text>
          <View style={{ flex: 1, height: 12, backgroundColor: C.surface3, borderRadius: 6, overflow: 'hidden' }}>
            <View style={{
              height: '100%' as unknown as number,
              width: `${(d.value / maxVal) * 100}%` as unknown as number,
              backgroundColor: d.color,
              borderRadius: 6,
            }} />
          </View>
          <Text style={{ fontSize: 12, color: C.textPrimary, fontWeight: '600', minWidth: 28, textAlign: 'right' }}>{d.value}</Text>
        </View>
      ))}
    </View>
  );
}

function SpecimenSparklineVariants() {
  const sparkSets: Array<{ label: string; data: number[]; positive: boolean }> = [
    { label: 'uptrend', data: [2, 3, 4, 3, 6, 7, 5, 9, 11, 8, 12], positive: true },
    { label: 'downtrend', data: [12, 10, 9, 11, 7, 5, 6, 3, 4, 2, 1], positive: false },
    { label: 'flat', data: [5, 6, 5, 5, 6, 5, 6, 5, 5, 6], positive: true },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: 24 }}>
      {sparkSets.map(({ label, data, positive }) => (
        <View key={label} style={{ alignItems: 'center', gap: 6 }}>
          <View style={{ width: 120, height: 32 }}>
            <StatCard label="" value="" sparkData={data} deltaPositive={positive} />
          </View>
          <Text style={{ fontSize: 8, color: C.textTertiary }}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/* ── Main view ── */

export function SpecimenGlobalView() {
  return (
    <ScrollView style={s.root} contentContainerStyle={s.container}>
      <Text style={s.pageTitle}>Global Component Specimen Sheet</Text>
      <Text style={s.pageSubtitle}>
        Non-session dashboard components — rendered with sample data
      </Text>

      {/* ════════════════════ SHARED COMPONENTS ════════════════════ */}
      <Text style={s.tier}>Shared Components (4)</Text>

      {/* S1. StatCard */}
      <Section title="S1. StatCard">
        <ComponentRow label="KPI cards with value, delta, and sparkline">
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <View style={{ width: 200 }}>
              <StatCard label="Throughput" value={42} delta="+8 this week" deltaPositive sparkData={SPARK_DATA} />
            </View>
            <View style={{ width: 200 }}>
              <StatCard label="Error Rate" value="3.2%" delta="+1.5%" deltaPositive={false} sparkData={[8, 6, 5, 7, 9, 4, 3]} />
            </View>
            <View style={{ width: 200 }}>
              <StatCard label="Lead Time P85" value="2h 14m" />
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* S2. StageBadge */}
      <Section title="S2. StageBadge">
        <ComponentRow label="Age-colored stage badges (green < p50, yellow < p85, red >= p85)">
          <Variants items={[
            { label: 'green (15m)', node: <StageBadge stage="Ready" ageMinutes={15} p50={30} p85={60} /> },
            { label: 'yellow (45m)', node: <StageBadge stage="In Progress" ageMinutes={45} p50={30} p85={60} /> },
            { label: 'red (90m)', node: <StageBadge stage="Review" ageMinutes={90} p50={30} p85={60} /> },
            { label: 'no age', node: <StageBadge stage="Done" /> },
          ]} />
        </ComponentRow>
      </Section>

      {/* S3. TokenGauge */}
      <Section title="S3. TokenGauge">
        <ComponentRow label="Two-segment token usage bar (input + output)">
          <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
            <View style={{ width: 240 }}>
              <TokenGauge tokensIn={45000} tokensOut={12000} maxTokens={200000} />
            </View>
            <View style={{ width: 240 }}>
              <TokenGauge tokensIn={120000} tokensOut={65000} maxTokens={200000} />
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* S4. ActivitySparkline */}
      <Section title="S4. ActivitySparkline">
        <ComponentRow label="Variable-height bars colored by tool type">
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ width: 200, height: 20 }}>
              <ActivitySparkline events={SPARK_EVENTS} />
            </View>
            <View style={{ width: 200, height: 20 }}>
              <ActivitySparkline events={SPARK_EVENTS.slice(0, 5)} />
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* ════════════════════ KANBAN COMPONENTS ════════════════════ */}
      <Text style={s.tier}>Kanban Components (3)</Text>

      {/* K1. Priority stripe */}
      <Section title="K1. Priority Stripe Pattern">
        <ComponentRow label="3px left border colored by priority level">
          <Variants items={Object.entries({ critical: priorityStripeColor("critical"), high: priorityStripeColor("high"), medium: priorityStripeColor("medium"), low: priorityStripeColor("low") }).map(([p, color]) => ({
            label: p,
            node: <SpecimenPriorityStripe priority={p} color={color} />,
          }))} />
        </ComponentRow>
      </Section>

      {/* K2. KanbanCard-style badges */}
      <Section title="K2. KanbanCard Badges">
        <ComponentRow label="Priority, review status, and age badges">
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 10, color: C.textTertiary, width: 60, paddingTop: 4 }}>Priority</Text>
              {['critical', 'high', 'medium', 'low'].map(p => {
                const c = priorityColor(p);
                return (
                  <SpecimenBadge key={p} label={p.charAt(0).toUpperCase() + p.slice(1)} bg={`${c}18`} fg={c} border={`${c}40`} />
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 10, color: C.textTertiary, width: 60, paddingTop: 4 }}>Review</Text>
              <SpecimenBadge label="approved" bg="rgba(20,184,166,0.1)" fg={C.success} border="rgba(20,184,166,0.2)" />
              <SpecimenBadge label="changes" bg="rgba(255,176,32,0.1)" fg={C.warning} border="rgba(255,176,32,0.2)" />
              <SpecimenBadge label="pending" bg="rgba(107,114,128,0.15)" fg={C.textSecondary} border="rgba(107,114,128,0.2)" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 10, color: C.textTertiary, width: 60, paddingTop: 4 }}>Age</Text>
              <View style={{ backgroundColor: 'rgba(255,176,32,0.1)', borderWidth: 1, borderColor: 'rgba(255,176,32,0.2)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, color: C.warning }}>2h</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,176,32,0.1)', borderWidth: 1, borderColor: 'rgba(255,176,32,0.2)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, color: C.warning }}>3d</Text>
              </View>
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* K3. Column headers */}
      <Section title="K3. Column Headers">
        <ComponentRow label="All 5 column states with accent stripe and count badge">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {['blocked', 'ready', 'inprogress', 'review', 'done'].map(col => (
              <SpecimenColumnHeader key={col} col={col} />
            ))}
          </View>
        </ComponentRow>
      </Section>

      {/* ════════════════════ AGENT COMPONENTS ════════════════════ */}
      <Text style={s.tier}>Agent Components (3)</Text>

      {/* A1. Agent Avatar */}
      <Section title="A1. Agent Avatar">
        <ComponentRow label="Colored circles with initials — multiple sizes">
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <SpecimenAvatar name="code-reviewer" color={AVATAR_COLORS[0]} size={20} />
                <Text style={{ fontSize: 8, color: C.textTertiary }}>20px</Text>
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <SpecimenAvatar name="test-runner" color={AVATAR_COLORS[1]} size={26} />
                <Text style={{ fontSize: 8, color: C.textTertiary }}>26px</Text>
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <SpecimenAvatar name="lint-fixer" color={AVATAR_COLORS[2]} size={32} />
                <Text style={{ fontSize: 8, color: C.textTertiary }}>32px</Text>
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <SpecimenAvatar name="deploy-agent" color={AVATAR_COLORS[3]} size={40} />
                <Text style={{ fontSize: 8, color: C.textTertiary }}>40px</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {AVATAR_COLORS.map((color, i) => (
                <SpecimenAvatar key={i} name={['CR', 'TR', 'LF', 'DA', 'UX', 'PM', 'QA'][i]} color={color} size={32} />
              ))}
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* A2. Agent Status Cards */}
      <Section title="A2. Agent Status Cards">
        <ComponentRow label="Agent cards with avatar, status dot, and state labels">
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <SpecimenAgentCard name="test-runner" status="active" color={AVATAR_COLORS[0]} />
            <SpecimenAgentCard name="code-reviewer" status="idle" color={AVATAR_COLORS[1]} />
            <SpecimenAgentCard name="lint-fixer" status="done" color={AVATAR_COLORS[2]} />
          </View>
        </ComponentRow>
      </Section>

      {/* A3. Topology Node Layout */}
      <Section title="A3. Topology Node Layout">
        <ComponentRow label="Coordinator + workers tree with connector lines">
          <View style={{ alignItems: 'center', gap: 0 }}>
            <SpecimenTopoNode name="coordinator" role="coordinator" color={AVATAR_COLORS[0]} isActive />
            <View style={{ width: 2, height: 24, backgroundColor: C.border }} />
            <View style={{ height: 2, width: 200, backgroundColor: C.border }} />
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 2, height: 12, backgroundColor: C.border }} />
                <SpecimenTopoNode name="worker-a" role="worker" color={AVATAR_COLORS[1]} isActive />
              </View>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 2, height: 12, backgroundColor: C.border }} />
                <SpecimenTopoNode name="worker-b" role="worker" color={AVATAR_COLORS[2]} isActive={false} />
              </View>
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* ════════════════════ SESSION LIST COMPONENTS ════════════════════ */}
      <Text style={s.tier}>Session List Components (3)</Text>

      {/* SL1. Session Row */}
      <Section title="SL1. Session Row">
        <ComponentRow label="Session list items with status badges — selected and unselected">
          <View style={{ width: 280, backgroundColor: C.surface1, borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' }}>
            <SpecimenSessionRow displayId="SNS-030" status="active" selected />
            <SpecimenSessionRow displayId="SNS-029" status="completed" selected={false} />
            <SpecimenSessionRow displayId="SNS-028" status="error" selected={false} />
          </View>
        </ComponentRow>
      </Section>

      {/* SL2. Event Dots */}
      <Section title="SL2. Event Dots">
        <ComponentRow label="Outcome indicator dots for timeline events">
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {(['success', 'error', 'info'] as const).map(outcome => (
              <View key={outcome} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <SpecimenEventDot outcome={outcome} />
                <Text style={{ fontSize: 11, color: C.textSecondary }}>{outcome}</Text>
              </View>
            ))}
          </View>
        </ComponentRow>
      </Section>

      {/* SL3. Status Filter Buttons */}
      <Section title="SL3. Status Filter Buttons">
        <ComponentRow label="Filter pills with active/inactive states">
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <SpecimenFilterButton label="all" active />
            <SpecimenFilterButton label="active" active={false} />
            <SpecimenFilterButton label="completed" active={false} />
          </View>
        </ComponentRow>
      </Section>

      {/* ════════════════════ TASK DETAIL COMPONENTS ════════════════════ */}
      <Text style={s.tier}>Task Detail Components (5)</Text>

      {/* TD1. Info Rows */}
      <Section title="TD1. Info Rows">
        <ComponentRow label="Label + value pairs in surface2 container">
          <View style={{
            backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
            borderRadius: 10, padding: 16, gap: 12, width: 280,
          }}>
            <SpecimenInfoRow label="Agent" value="test-runner" />
            <SpecimenInfoRow label="Branch" value="feat/session-v2" />
            <SpecimenInfoRow label="Priority" value="High" />
          </View>
        </ComponentRow>
      </Section>

      {/* TD2. Priority + Column Badges */}
      <Section title="TD2. Priority & Column Badges">
        <ComponentRow label="All priority levels and column stage badges">
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 10, color: C.textTertiary, width: 55, paddingTop: 4 }}>Priority</Text>
              {['critical', 'high', 'medium', 'low'].map(p => {
                const c = priorityColor(p);
                return (
                  <SpecimenBadge key={p} label={p.charAt(0).toUpperCase() + p.slice(1)} bg={`${c}18`} fg={c} border={`${c}40`} />
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 10, color: C.textTertiary, width: 55, paddingTop: 4 }}>Column</Text>
              {['blocked', 'ready', 'inprogress', 'review', 'done'].map(col => {
                const c = columnColor(col);
                return (
                  <SpecimenBadgeWithDot
                    key={col}
                    label={COL_LABEL[col] ?? col}
                    dotColor={c}
                    bg={`${c}18`}
                    fg={c}
                    border={`${c}40`}
                  />
                );
              })}
            </View>
          </View>
        </ComponentRow>
      </Section>

      {/* TD3. Dependency Tree Nodes */}
      <Section title="TD3. Dependency Tree Nodes">
        <ComponentRow label="Tree nodes with status icons (done, blocked, pending)">
          <View style={{
            backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
            borderRadius: 8, padding: 12, gap: 4, maxWidth: 500,
          }}>
            <SpecimenDepNode icon="✓" iconColor={C.success} id="VNM-21.01" title="Set up project scaffolding" col="done" />
            <SpecimenDepNode icon="✗" iconColor={C.error} id="VNM-21.03" title="Implement auth middleware" col="blocked" />
            <SpecimenDepNode icon="○" iconColor={C.textTertiary} id="VNM-21.05" title="Add integration tests" col="ready" />
            <SpecimenDepNode icon="○" iconColor={C.brand} id="VNM-21.04" title="Wire up API endpoints" col="inprogress" />
          </View>
        </ComponentRow>
      </Section>

      {/* TD4. Stage Timeline Dots */}
      <Section title="TD4. Stage Timeline">
        <ComponentRow label="Transition history with connected dots and stage labels">
          <View style={{ maxWidth: 400, gap: 0 }}>
            <SpecimenTimelineDot />
            <SpecimenTimelineDot />
          </View>
        </ComponentRow>
      </Section>

      {/* TD5. Section Headers */}
      <Section title="TD5. Section Headers">
        <ComponentRow label="Title with horizontal rule line">
          <View style={{ maxWidth: 400 }}>
            {['Dependencies', 'Stage History', 'Related'].map(title => (
              <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Text style={{
                  fontSize: 13, fontWeight: '600', color: C.textSecondary,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {title}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
              </View>
            ))}
          </View>
        </ComponentRow>
      </Section>

      {/* ════════════════════ CHART COMPONENTS ════════════════════ */}
      <Text style={s.tier}>Chart Components (4)</Text>

      {/* CH1. Burndown Chart */}
      <Section title="CH1. Burndown Chart">
        <ComponentRow label="SVG line chart with ideal (dashed) vs actual, area fill">
          <View style={{ maxWidth: 420 }}>
            <SpecimenBurndownChart />
          </View>
        </ComponentRow>
      </Section>

      {/* CH2. Velocity Chart */}
      <Section title="CH2. Velocity Chart">
        <ComponentRow label="SVG area chart with dots at data points">
          <View style={{ maxWidth: 420 }}>
            <SpecimenVelocityChart />
          </View>
        </ComponentRow>
      </Section>

      {/* CH3. Bar Chart */}
      <Section title="CH3. Horizontal Bar Chart">
        <ComponentRow label="Labeled horizontal bars with semantic colors">
          <View style={{ maxWidth: 420 }}>
            <SpecimenBarChart />
          </View>
        </ComponentRow>
      </Section>

      {/* CH4. Sparkline Variants */}
      <Section title="CH4. Sparkline Variants">
        <ComponentRow label="StatCard sparklines in different trend states">
          <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
            <View style={{ width: 200 }}>
              <StatCard label="Uptrend" value={12} delta="+3" deltaPositive sparkData={[2, 3, 4, 3, 6, 7, 5, 9, 11, 8, 12]} />
            </View>
            <View style={{ width: 200 }}>
              <StatCard label="Downtrend" value={2} delta="-5" deltaPositive={false} sparkData={[12, 10, 9, 11, 7, 5, 6, 3, 4, 2, 1]} />
            </View>
            <View style={{ width: 200 }}>
              <StatCard label="Flat" value={5} sparkData={[5, 6, 5, 5, 6, 5, 6, 5, 5, 6]} />
            </View>
          </View>
        </ComponentRow>
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
    fontFamily: 'Space Grotesk',
    fontSize: 22,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: C.textTertiary,
    marginBottom: 28,
  },
  tier: {
    fontFamily: 'Space Grotesk',
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
    fontFamily: 'Space Grotesk',
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 12,
  },

  /* ComponentRow */
  componentRow: {
    marginBottom: 8,
  },
  componentLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: C.textTertiary,
    marginBottom: 10,
  },
  componentBody: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
    padding: 16,
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
    fontFamily: 'Space Grotesk',
    fontSize: 8,
    color: C.textTertiary,
    textAlign: 'center',
  },
});
