import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { DashboardData, DashboardSession, SessionTimelineEvent } from '../types.js';
import { TokenGauge } from '../components/shared/TokenGauge.js';
import { C } from '../components/shared/colors.js';

interface SessionsViewProps {
  dashboard: DashboardData | null;
  initialSession?: string;
}

type StatusFilter = 'all' | 'active' | 'completed';

function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'yesterday';
  return `${diffD}d ago`;
}

function duration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diffMs = endMs - new Date(start).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function statusColor(status: string): string {
  if (status === 'active') return C.success;
  if (status === 'error') return C.error;
  return C.textTertiary;
}

function SessionRow({ session, selected, onPress }: {
  session: DashboardSession;
  selected: boolean;
  onPress: () => void;
}) {
  const handlePress = () => {
    window.location.hash = `#session?id=${encodeURIComponent(session.displayId)}`;
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      style={[styles.sessionRow, selected && styles.sessionRowSelected]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.displayId}>{session.displayId}</Text>
        <View style={[styles.badge, { backgroundColor: statusColor(session.status) + '26' }]}>
          <Text style={[styles.badgeText, { color: statusColor(session.status) }]}>
            {session.status}
          </Text>
        </View>
      </View>
      <Text style={styles.rowTime}>{relativeTime(session.startedAt)}</Text>
      <View style={styles.rowMeta}>
        <Text style={styles.metaText}>
          {fmtK(session.tokensIn)} in / {fmtK(session.tokensOut)} out
        </Text>
        <Text style={styles.metaText}>{session.toolCalls} tools</Text>
      </View>
    </Pressable>
  );
}

interface TimeBucket {
  label: string;
  events: Array<{ toolName: string; outcome: 'success' | 'error'; count: number }>;
}

function groupIntoBuckets(events: SessionTimelineEvent[]): TimeBucket[] {
  const byMinute = new Map<string, SessionTimelineEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    const key = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (!byMinute.has(key)) byMinute.set(key, []);
    byMinute.get(key)!.push(ev);
  }

  return Array.from(byMinute.entries()).map(([label, evs]) => {
    const grouped = new Map<string, { outcome: 'success' | 'error'; count: number }>();
    for (const ev of evs) {
      const key = `${ev.toolName}:${ev.outcome}`;
      const existing = grouped.get(key);
      if (existing) { existing.count++; }
      else { grouped.set(key, { outcome: ev.outcome, count: 1 }); }
    }
    return {
      label,
      events: Array.from(grouped.entries()).map(([k, v]) => ({ toolName: k.split(':')[0], ...v })),
    };
  });
}

function EventDot({ outcome }: { outcome: 'success' | 'error' }) {
  return <View style={[tlStyles.dot, { backgroundColor: outcome === 'error' ? C.error : C.success }]} />;
}

function BucketRow({ bucket }: { bucket: TimeBucket }) {
  return (
    <View style={tlStyles.bucketRow}>
      <Text style={tlStyles.timeLabel}>{bucket.label}</Text>
      <View style={tlStyles.bucketLine} />
      <View style={tlStyles.eventsCol}>
        {bucket.events.map((ev, i) => (
          <View key={i} style={tlStyles.eventItem}>
            <EventDot outcome={ev.outcome} />
            <Text style={[tlStyles.eventText, ev.outcome === 'error' && { color: C.error }]}>
              {ev.count > 1 ? `${ev.toolName} x${ev.count}` : ev.toolName}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SessionTimeline({ events }: { events: SessionTimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <View style={tlStyles.empty}>
        <Text style={tlStyles.emptyText}>No tool call events recorded for this session</Text>
      </View>
    );
  }

  const buckets = groupIntoBuckets(events);
  const successCount = events.filter((e) => e.outcome === 'success').length;
  const errorCount = events.filter((e) => e.outcome === 'error').length;
  const uniqueTools = new Set(events.map((e) => e.toolName)).size;

  return (
    <View>
      <View style={tlStyles.summaryRow}>
        <Text style={[tlStyles.summaryItem, { color: C.success }]}>{successCount} success</Text>
        <Text style={[tlStyles.summaryItem, { color: C.error }]}>{errorCount} errors</Text>
        <Text style={[tlStyles.summaryItem, { color: C.textSecondary }]}>{uniqueTools} tools used</Text>
      </View>
      {buckets.map((b) => <BucketRow key={b.label} bucket={b} />)}
    </View>
  );
}

const tlStyles = StyleSheet.create({
  empty: { padding: 16, alignItems: 'center' },
  emptyText: { fontSize: 12, color: C.textTertiary, fontStyle: 'italic' },
  summaryRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  summaryItem: { fontSize: 12, fontWeight: '500' },
  bucketRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  timeLabel: { width: 40, fontSize: 10, color: C.textTertiary, fontFamily: 'monospace', paddingTop: 2 },
  bucketLine: { width: 1, backgroundColor: C.border, alignSelf: 'stretch', marginHorizontal: 4, marginTop: 6 },
  eventsCol: { flex: 1, gap: 3 },
  eventItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  eventText: { fontSize: 11, color: C.textSecondary },
});

function SessionDetail({ session }: { session: DashboardSession }) {
  return (
    <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailId}>{session.displayId}</Text>
        <View style={[styles.badge, { backgroundColor: statusColor(session.status) + '26' }]}>
          <Text style={[styles.badgeText, { color: statusColor(session.status) }]}>
            {session.status}
          </Text>
        </View>
      </View>

      <View style={styles.timestamps}>
        <View style={styles.tsRow}>
          <Text style={styles.tsLabel}>Started</Text>
          <Text style={styles.tsValue}>{fmtTimestamp(session.startedAt)}</Text>
        </View>
        {session.endedAt && (
          <View style={styles.tsRow}>
            <Text style={styles.tsLabel}>Ended</Text>
            <Text style={styles.tsValue}>{fmtTimestamp(session.endedAt)}</Text>
          </View>
        )}
        <View style={styles.tsRow}>
          <Text style={styles.tsLabel}>Duration</Text>
          <Text style={styles.tsValue}>{duration(session.startedAt, session.endedAt)}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        {([
          { label: 'Tokens In', value: fmtK(session.tokensIn), color: C.info },
          { label: 'Tokens Out', value: fmtK(session.tokensOut), color: C.brand },
          { label: 'Tool Calls', value: String(session.toolCalls), color: C.textPrimary },
          { label: 'Errors', value: String(session.errors), color: session.errors > 0 ? C.error : C.textTertiary },
        ] as Array<{ label: string; value: string; color: string }>).map((s) => (
          <View key={s.label} style={styles.statBox}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.gaugeSection}>
        <TokenGauge tokensIn={session.tokensIn} tokensOut={session.tokensOut} />
      </View>

      <View style={styles.timelineSection}>
        <Text style={styles.sectionHeading}>Event Timeline</Text>
        <SessionTimeline events={session.events ?? []} />
      </View>
    </ScrollView>
  );
}

export function SessionsView({ dashboard, initialSession }: SessionsViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const sessions = dashboard?.sessions ?? [];

  // Resolve initialSession (by displayId) to an id and pre-select it
  React.useEffect(() => {
    if (initialSession) {
      const match = sessions.find(s => s.displayId === initialSession || s.id === initialSession);
      if (match) setSelected(match.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession]);

  const filtered = sessions
    .filter((s) => filter === 'all' || s.status === filter)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const selectedSession = filtered.find((s) => s.id === selected) ?? filtered[0] ?? null;

  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No sessions recorded</Text>
        <Text style={styles.emptyHint}>Sessions appear here once brain hooks are installed.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>Sessions</Text>
          <View style={styles.filters}>
            {(['all', 'active', 'completed'] as StatusFilter[]).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)}
                style={[styles.filterBtn, filter === f && styles.filterBtnActive]}>
                <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
                  {f}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <ScrollView style={styles.list}>
          {filtered.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              selected={s.id === (selectedSession?.id ?? null)}
              onPress={() => setSelected(s.id)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.detailPane}>
        {selectedSession
          ? <SessionDetail session={selectedSession} />
          : (
            <View style={styles.empty}>
              <Text style={styles.emptyHint}>Select a session</Text>
            </View>
          )
        }
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: C.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.textSecondary, fontFamily: 'Space Grotesk, sans-serif' },
  emptyHint: { fontSize: 13, color: C.textTertiary },

  // Sidebar
  sidebar: { width: 280, backgroundColor: C.surface1, borderRightWidth: 1, borderRightColor: C.border, flexDirection: 'column' },
  sidebarHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  sidebarTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif', marginBottom: 10 },
  filters: { flexDirection: 'row', gap: 4 },
  filterBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  filterBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
  filterBtnText: { fontSize: 11, color: C.textTertiary, fontWeight: '500' },
  filterBtnTextActive: { color: '#fff' },
  list: { flex: 1 },

  // Session row
  sessionRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  sessionRowSelected: { borderLeftWidth: 3, borderLeftColor: C.brand, paddingLeft: 9 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  displayId: { fontSize: 13, fontWeight: '600', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  rowTime: { fontSize: 11, color: C.textTertiary, marginBottom: 4 },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { fontSize: 11, color: C.textSecondary },

  // Detail pane
  detailPane: { flex: 1, backgroundColor: C.bg },
  detail: { flex: 1 },
  detailContent: { padding: 24 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  detailId: { fontSize: 20, fontWeight: '700', color: C.textPrimary, fontFamily: 'Space Grotesk, sans-serif' },
  timestamps: { backgroundColor: C.surface1, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 16, gap: 6 },
  tsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tsLabel: { fontSize: 12, color: C.textTertiary },
  tsValue: { fontSize: 12, color: C.textSecondary },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: C.surface1, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 2 },
  statLabel: { fontSize: 10, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  gaugeSection: { backgroundColor: C.surface1, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 16 },
  timelineSection: { backgroundColor: C.surface1, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 16 },
  sectionHeading: { fontSize: 12, fontWeight: '600', color: C.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
});
