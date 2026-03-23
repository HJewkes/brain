import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { DashboardData } from '../../types.js';
import { C, component } from './colors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResultKind = 'task' | 'agent' | 'session' | 'workstream';

interface SearchResult {
  kind: ResultKind;
  id: string;
  label: string;
  sub: string;
  hash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_BADGE: Record<ResultKind, { label: string; color: string }> = {
  task: { label: 'Task', color: C.brand },
  agent: { label: 'Agent', color: C.info },
  session: { label: 'Session', color: C.success },
  workstream: { label: 'WS', color: C.steel },
};

function buildIndex(dashboard: DashboardData | null): SearchResult[] {
  if (!dashboard) return [];
  const results: SearchResult[] = [];

  for (const t of dashboard.tasks) {
    results.push({
      kind: 'task',
      id: t.id,
      label: t.id,
      sub: t.title,
      hash: `#kanban?task=${encodeURIComponent(t.id)}`,
    });
  }

  for (const a of dashboard.agents) {
    results.push({
      kind: 'agent',
      id: a.id,
      label: a.name,
      sub: `${a.status} · ${a.toolCalls} tools`,
      hash: `#agents?agent=${encodeURIComponent(a.name)}`,
    });
  }

  for (const s of dashboard.sessions) {
    results.push({
      kind: 'session',
      id: s.id,
      label: s.displayId,
      sub: `${s.status} · ${s.toolCalls} tools`,
      hash: `#sessions?session=${encodeURIComponent(s.displayId)}`,
    });
  }

  for (const [wsId, ws] of Object.entries(dashboard.workstreams)) {
    results.push({
      kind: 'workstream',
      id: wsId,
      label: wsId,
      sub: ws.name,
      hash: `#kanban?workstream=${encodeURIComponent(wsId)}`,
    });
  }

  return results;
}

function search(index: SearchResult[], query: string): SearchResult[] {
  if (!query.trim()) return index.slice(0, 20);
  const q = query.toLowerCase();
  return index
    .filter(r => r.id.toLowerCase().includes(q) || r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q))
    .slice(0, 30);
}

function groupByKind(results: SearchResult[]): Array<{ kind: ResultKind; items: SearchResult[] }> {
  const order: ResultKind[] = ['task', 'agent', 'session', 'workstream'];
  const map = new Map<ResultKind, SearchResult[]>();
  for (const r of results) {
    if (!map.has(r.kind)) map.set(r.kind, []);
    map.get(r.kind)!.push(r);
  }
  return order.filter(k => map.has(k)).map(k => ({ kind: k, items: map.get(k)! }));
}

// ---------------------------------------------------------------------------
// ResultRow
// ---------------------------------------------------------------------------

interface ResultRowProps {
  result: SearchResult;
  selected: boolean;
  onSelect: () => void;
}

function ResultRow({ result, selected, onSelect }: ResultRowProps) {
  const badge = KIND_BADGE[result.kind];
  return (
    <Pressable
      onPress={onSelect}
      style={[rowStyles.row, selected && rowStyles.rowSelected]}
    >
      <View style={[rowStyles.badge, { backgroundColor: badge.color + '22', borderColor: badge.color + '44' }]}>
        <Text style={[rowStyles.badgeText, { color: badge.color }]}>{badge.label}</Text>
      </View>
      <View style={rowStyles.text}>
        <Text style={rowStyles.label} numberOfLines={1}>{result.label}</Text>
        <Text style={rowStyles.sub} numberOfLines={1}>{result.sub}</Text>
      </View>
      {selected && <Text style={rowStyles.hint}>↵</Text>}
    </Pressable>
  );
}

const rowStyles = {
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    cursor: 'pointer' as unknown as undefined,
  },
  rowSelected: {
    backgroundColor: component.commandPalette.activeItemBg,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 36,
    alignItems: 'center' as const,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  text: { flex: 1 },
  label: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: C.textPrimary,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  sub: {
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 1,
  },
  hint: {
    fontSize: 12,
    color: C.textTertiary,
  },
};

// ---------------------------------------------------------------------------
// CommandPalette
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  dashboard: DashboardData | null;
  onClose: () => void;
}

export function CommandPalette({ dashboard, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = React.useMemo(() => buildIndex(dashboard), [dashboard]);
  const results = React.useMemo(() => search(index, query), [index, query]);
  const groups = React.useMemo(() => groupByKind(results), [results]);

  // Flat list for keyboard nav
  const flat = results;

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const navigate = useCallback((result: SearchResult) => {
    window.location.hash = result.hash;
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[selectedIndex]) navigate(flat[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [flat, selectedIndex, navigate, onClose]);

  // Build absolute index for each result in group view
  const absoluteIndexOf = useCallback((result: SearchResult) => {
    return flat.findIndex(r => r.id === result.id && r.kind === result.kind);
  }, [flat]);

  return (
    // Overlay
    <Pressable
      onPress={onClose}
      style={paletteStyles.overlay}
    >
      {/* Modal — stop propagation so clicks inside don't close */}
      <Pressable
        onPress={(e) => e.stopPropagation()}
        style={paletteStyles.modal}
      >
        {/* Search input */}
        <View style={paletteStyles.inputRow}>
          <Text style={paletteStyles.searchIcon}>⌕</Text>
          <input
            ref={inputRef}
            style={inputStyle}
            placeholder="Search tasks, agents, sessions…"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown as unknown as React.KeyboardEventHandler<HTMLInputElement>}
          />
          <View style={paletteStyles.kbdHint}>
            <Text style={paletteStyles.kbdText}>ESC</Text>
          </View>
        </View>

        {/* Results */}
        <View style={paletteStyles.results}>
          {results.length === 0 ? (
            <View style={paletteStyles.empty}>
              <Text style={paletteStyles.emptyText}>No results for "{query}"</Text>
            </View>
          ) : (
            groups.map(group => (
              <View key={group.kind}>
                <View style={paletteStyles.groupHeader}>
                  <Text style={paletteStyles.groupLabel}>
                    {KIND_BADGE[group.kind].label}s
                  </Text>
                </View>
                {group.items.map(result => (
                  <ResultRow
                    key={`${result.kind}:${result.id}`}
                    result={result}
                    selected={absoluteIndexOf(result) === selectedIndex}
                    onSelect={() => navigate(result)}
                  />
                ))}
              </View>
            ))
          )}
        </View>

        {/* Footer */}
        <View style={paletteStyles.footer}>
          <Text style={paletteStyles.footerText}>↑↓ navigate · ↵ select · esc close</Text>
        </View>
      </Pressable>
    </Pressable>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: 16,
  color: C.textPrimary,
  fontFamily: "'Space Grotesk', sans-serif",
  padding: 0,
};

const paletteStyles = {
  overlay: {
    position: 'fixed' as unknown as 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: component.commandPalette.overlayBg,
    alignItems: 'center' as const,
    justifyContent: 'flex-start' as const,
    paddingTop: 80,
    zIndex: 1000,
  },
  modal: {
    width: 600,
    maxWidth: '90vw' as unknown as number,
    backgroundColor: component.commandPalette.panelBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    overflow: 'hidden' as const,
    boxShadow: '0 24px 64px rgba(0,0,0,0.7)' as unknown as object,
    maxHeight: '70vh' as unknown as number,
  },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  searchIcon: {
    fontSize: 18,
    color: C.textTertiary,
    lineHeight: 22,
  },
  kbdHint: {
    backgroundColor: C.surface3,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kbdText: {
    fontSize: 10,
    color: C.textTertiary,
    fontFamily: 'monospace',
  },
  results: {
    maxHeight: 400,
    overflowY: 'auto' as unknown as undefined,
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center' as const,
  },
  emptyText: {
    fontSize: 14,
    color: C.textTertiary,
  },
  groupHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: C.surface1,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: C.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    alignItems: 'center' as const,
  },
  footerText: {
    fontSize: 11,
    color: C.textTertiary,
  },
};
