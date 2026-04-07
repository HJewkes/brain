/**
 * SessionReplayView — displays raw session events in a paginated timeline.
 *
 * Fetches:
 *   - GET /api/sessions/:id/detail  (existing, for session metadata)
 *   - GET /api/sessions/:id/events  (new, VNM-34.32)
 *
 * Renders a vertical scrolling timeline with a sticky header, color-coded
 * event_type badges, timestamp pills, and expandable JSON panels.
 * Paginates at 100 events per page with a "Load more" button.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { C, palette, semantic } from '../components/shared/colors.js';
import { fmtTime } from '../utils/formatting.js';
import { statusColor } from '../utils/semantic-colors.js';
import type { SessionDetailData } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEvent {
  id: number;
  session_id: string;
  event_type: string;
  category: string | null;
  data: string;
  timestamp: string;
  data_hash: string;
}

interface SessionReplayViewProps {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Event type color map
// ---------------------------------------------------------------------------

const EVENT_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  tool_use:      { bg: semantic.tool.bash.bg,   fg: semantic.tool.bash.fg },
  tool_result:   { bg: semantic.tool.read.bg,   fg: semantic.tool.read.fg },
  user:          { bg: palette.brand.dim15,      fg: C.brand },
  assistant:     { bg: palette.green.dim12,      fg: palette.green.base },
  system:        { bg: palette.gray.dim15,       fg: C.textTertiary },
  friction:      { bg: palette.red.dim08,        fg: palette.red.light },
  compaction:    { bg: palette.amber.dim12,      fg: palette.amber.base },
  task:          { bg: palette.amber.dim12,      fg: palette.amber.base },
  agent:         { bg: semantic.tool.agent.bg,   fg: semantic.tool.agent.fg },
};

const FALLBACK_EVENT_COLOR = { bg: palette.gray.dim15, fg: C.textTertiary };

function eventTypeColor(eventType: string): { bg: string; fg: string } {
  const key = eventType.toLowerCase().replace(/[-\s]/g, '_');
  return EVENT_TYPE_COLORS[key] ?? FALLBACK_EVENT_COLOR;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;

function excerptData(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const str = JSON.stringify(parsed);
    return str.length > 120 ? str.slice(0, 120) + '…' : str;
  } catch {
    return raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

interface EventRowProps {
  event: SessionEvent;
  expanded: boolean;
  onToggle: () => void;
}

function EventRow({ event, expanded, onToggle }: EventRowProps) {
  const color = eventTypeColor(event.event_type);
  const label = event.event_type.toUpperCase().replace(/_/g, ' ');

  return (
    <Pressable onPress={onToggle}>
      <View style={[s.eventRow, expanded && s.eventRowExpanded]}>
        <View style={s.eventRowTop}>
          {/* Timestamp pill */}
          <View style={s.timestampPill}>
            <Text style={s.timestampText}>{fmtTime(event.timestamp)}</Text>
          </View>

          {/* Event type badge */}
          <View style={[s.typeBadge, { backgroundColor: color.bg, borderColor: color.fg + '50' }]}>
            <Text style={[s.typeBadgeText, { color: color.fg }]}>{label}</Text>
          </View>

          {/* Category (if present) */}
          {event.category ? (
            <Text style={s.categoryText}>{event.category}</Text>
          ) : null}

          {/* Expand indicator */}
          <Text style={s.expandCaret}>{expanded ? '▲' : '▼'}</Text>
        </View>

        {/* Data excerpt */}
        <Text style={s.dataExcerpt} numberOfLines={expanded ? undefined : 1}>
          {excerptData(event.data)}
        </Text>

        {/* Expanded JSON panel */}
        {expanded && (
          <View style={s.jsonPanel}>
            <Text style={s.jsonText}>{prettyJson(event.data)}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Sticky header
// ---------------------------------------------------------------------------

function ReplayHeader({ sessionId, status }: { sessionId: string; status: string }) {
  const badgeColor = statusColor(status);
  return (
    <View style={s.stickyHeader}>
      <Text style={s.headerSessionId}>{sessionId}</Text>
      <View style={[s.statusBadge, { backgroundColor: badgeColor + '1A', borderColor: badgeColor + '50' }]}>
        <View style={[s.statusDot, { backgroundColor: badgeColor }]} />
        <Text style={[s.statusText, { color: badgeColor }]}>{status}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SessionReplayView({ sessionId }: SessionReplayViewProps) {
  const [detail, setDetail] = useState<SessionDetailData | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisibleCount(PAGE_SIZE);
    setExpandedIds(new Set());

    const apiBase = window.__BRAIN_API__ ?? 'http://localhost:7800';
    const encoded = encodeURIComponent(sessionId);

    Promise.all([
      fetch(`${apiBase}/api/sessions/${encoded}/detail`).then(r => {
        if (!r.ok) throw new Error(`detail: HTTP ${r.status}`);
        return r.json() as Promise<SessionDetailData>;
      }),
      fetch(`${apiBase}/api/sessions/${encoded}/events`).then(r => {
        if (!r.ok) throw new Error(`events: HTTP ${r.status}`);
        return r.json() as Promise<SessionEvent[]>;
      }),
    ])
      .then(([det, evs]) => {
        if (!cancelled) {
          setDetail(det);
          setEvents(evs);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => prev + PAGE_SIZE);
  }, []);

  // --- Loading state ---
  if (loading) {
    return (
      <View style={s.centered}>
        <Text style={s.loadingText}>Loading session events…</Text>
      </View>
    );
  }

  // --- Error state ---
  if (error || !detail) {
    return (
      <View style={s.centered}>
        <Text style={s.errorTitle}>Failed to load session</Text>
        <Text style={s.errorDetail}>{error ?? 'No data returned'}</Text>
        <Pressable
          onPress={() => { window.location.hash = '#sessions'; }}
          style={s.backBtn}
        >
          <Text style={s.backBtnText}>← Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const visibleEvents = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  return (
    <View style={s.root}>
      <ReplayHeader sessionId={detail.session.displayId} status={detail.session.status} />

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Empty state */}
        {events.length === 0 && (
          <View style={s.emptyBanner}>
            <Text style={s.emptyBannerText}>No events captured for this session</Text>
          </View>
        )}

        {/* Event rows */}
        {visibleEvents.map(event => (
          <EventRow
            key={event.id}
            event={event}
            expanded={expandedIds.has(event.id)}
            onToggle={() => toggleExpand(event.id)}
          />
        ))}

        {/* Load more */}
        {hasMore && (
          <View style={s.loadMoreRow}>
            <Text style={s.loadMoreMeta}>
              Showing {visibleCount} of {events.length} events
            </Text>
            <Pressable style={s.loadMoreBtn} onPress={handleLoadMore}>
              <Text style={s.loadMoreBtnText}>Load more</Text>
            </Pressable>
          </View>
        )}

        {/* Footer count when all loaded */}
        {!hasMore && events.length > 0 && (
          <Text style={s.footerText}>{events.length} events total</Text>
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column' as const,
    backgroundColor: C.bg,
    height: '100%' as unknown as number,
  },

  // Sticky header
  stickyHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.surface1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    position: 'sticky' as unknown as 'relative',
    top: 0,
    zIndex: 10,
  },
  headerSessionId: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: C.textPrimary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  statusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },

  // Scroll area
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60, maxWidth: 900 },

  // Event row
  eventRow: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
    gap: 6,
  },
  eventRowExpanded: {
    borderColor: C.brand + '60',
    backgroundColor: palette.brand.dim06,
  },
  eventRowTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },

  // Timestamp pill
  timestampPill: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  timestampText: {
    fontSize: 10,
    fontFamily: "'Space Grotesk', monospace",
    color: C.textTertiary,
  },

  // Type badge
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 9,
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },

  // Category
  categoryText: {
    fontSize: 10,
    color: C.textTertiary,
    fontFamily: "'Space Grotesk', sans-serif",
    fontStyle: 'italic' as const,
  },

  // Expand caret
  expandCaret: {
    fontSize: 8,
    color: C.textTertiary,
    marginLeft: 'auto' as unknown as number,
  },

  // Data excerpt
  dataExcerpt: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', monospace",
  },

  // Expanded JSON panel
  jsonPanel: {
    backgroundColor: C.surface2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    marginTop: 4,
  },
  jsonText: {
    fontSize: 10,
    lineHeight: 15,
    color: C.textSecondary,
    fontFamily: "'Space Grotesk', monospace",
  },

  // Load more
  loadMoreRow: {
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 16,
  },
  loadMoreMeta: {
    fontSize: 11,
    color: C.textTertiary,
  },
  loadMoreBtn: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  loadMoreBtnText: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '500' as const,
  },

  // Footer
  footerText: {
    fontSize: 11,
    color: C.textTertiary,
    textAlign: 'center' as const,
    paddingVertical: 12,
    fontStyle: 'italic' as const,
  },

  // Empty state
  emptyBanner: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 24,
    alignItems: 'center' as const,
    marginVertical: 20,
  },
  emptyBannerText: {
    fontSize: 13,
    color: C.textTertiary,
    fontStyle: 'italic' as const,
  },

  // Loading / error
  centered: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    padding: 24,
  },
  loadingText: { fontSize: 14, color: C.textSecondary },
  errorTitle: { fontSize: 18, fontWeight: '600' as const, color: C.error },
  errorDetail: { fontSize: 13, color: C.textTertiary },
  backBtn: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 8,
  },
  backBtnText: { fontSize: 12, color: C.textTertiary, fontWeight: '500' as const },
});
