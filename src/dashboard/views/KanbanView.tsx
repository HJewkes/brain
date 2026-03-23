import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import type { DashboardData, DashboardTask, DashboardAgent } from '../types.js';
import { AgentHoverCard } from '../components/shared/AgentHoverCard.js';
import { C, palette } from '../components/shared/colors.js';
import { KanbanColumn } from './KanbanColumn.js';

interface KanbanViewProps {
  dashboard: DashboardData | null;
  initialTask?: string;
}

type FilterMode = 'all' | 'high' | 'mine' | 'blocked';

const COLS = ['blocked', 'ready', 'inprogress', 'review', 'done'] as const;

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function sortTasks(tasks: DashboardTask[]): DashboardTask[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

export function KanbanView({ dashboard, initialTask }: KanbanViewProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [hoveredAgent, setHoveredAgent] = useState<DashboardAgent | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [highlightedTask, setHighlightedTask] = useState<string | undefined>(initialTask);
  const highlightRef = useRef<string | undefined>(initialTask);

  // When initialTask changes (hash navigation), update highlight and pre-fill search
  useEffect(() => {
    if (initialTask) {
      setHighlightedTask(initialTask);
      highlightRef.current = initialTask;
      setSearch(initialTask);
      // Clear highlight after 3 s so it doesn't stay forever
      const t = setTimeout(() => {
        setHighlightedTask(undefined);
        highlightRef.current = undefined;
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [initialTask]);

  const tasks = dashboard?.tasks ?? [];
  const agents = dashboard?.agents ?? [];

  // Compute effective column for each task (re-classify if deps unmet)
  const effectiveTasks = tasks.map(t => {
    if (t.col === 'ready') {
      const hasUnmetDeps = t.deps.some(depId => {
        const dep = tasks.find(d => d.id === depId);
        return dep && dep.col !== 'done';
      });
      if (hasUnmetDeps) return { ...t, col: 'blocked' };
    }
    return t;
  });

  // Apply filters
  const visibleTasks = effectiveTasks.filter(t => {
    if (search) {
      const q = search.toLowerCase();
      if (!t.id.toLowerCase().includes(q) && !t.title.toLowerCase().includes(q)) return false;
    }
    if (filter === 'high' && t.priority !== 'high') return false;
    if (filter === 'mine' && !t.agent) return false;
    if (filter === 'blocked' && t.col !== 'blocked') return false;
    return true;
  });

  // Stats
  const totalCount = effectiveTasks.length;
  const readyCount = effectiveTasks.filter(t => t.col === 'ready').length;
  const inProgressCount = effectiveTasks.filter(t => t.col === 'inprogress').length;
  const reviewCount = effectiveTasks.filter(t => t.col === 'review').length;
  const blockedCount = effectiveTasks.filter(t => t.col === 'blocked').length;
  const doneCount = effectiveTasks.filter(t => t.col === 'done').length;
  const wipOver = inProgressCount > 4;
  const wipWarn = inProgressCount === 4;

  const handleAgentHover = useCallback((agentName: string, el: HTMLElement) => {
    const agent = agents.find(a => a.name === agentName) ?? null;
    setHoveredAgent(agent);
    setAnchorEl(el);
  }, [agents]);

  const handleAgentLeave = useCallback(() => {
    setHoveredAgent(null);
    setAnchorEl(null);
  }, []);

  const handleAgentClick = useCallback((agentName: string) => {
    window.location.hash = `#agents?agent=${encodeURIComponent(agentName)}`;
  }, []);

  const filterBtns: Array<{ key: FilterMode; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'high', label: 'High Priority' },
    { key: 'mine', label: 'Assigned' },
    { key: 'blocked', label: 'Blocked' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <View style={styles.searchWrapper}>
          <Text style={styles.searchIcon}>⌕</Text>
          <input
            style={nativeInputStyle}
            placeholder="Search tasks…"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
        </View>
        <View style={styles.filterBtns}>
          {filterBtns.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.filterBtn, filter === key && styles.filterBtnActive]}
            >
              <Text style={[styles.filterBtnText, filter === key && styles.filterBtnTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <StatItem label="Total" value={totalCount} />
        <StatItem label="Ready" value={readyCount} />
        <StatItem label={`In Progress (WIP ${inProgressCount}/4)`} value={inProgressCount} warn={wipWarn} over={wipOver} />
        <StatItem label="In Review" value={reviewCount} />
        <StatItem label="Blocked" value={blockedCount} />
        <StatItem label="Done" value={doneCount} />
      </View>

      {/* Board */}
      <ScrollView
        horizontal
        style={{ flex: 1 }}
        contentContainerStyle={styles.boardContainer}
        showsHorizontalScrollIndicator={false}
      >
        {COLS.map(col => {
          const colTasks = sortTasks(visibleTasks.filter(t => t.col === col));
          return (
            <KanbanColumn
              key={col}
              col={col}
              tasks={colTasks}
              allTasks={effectiveTasks}
              agents={agents}
              workstreams={dashboard?.workstreams ?? {}}
              highlightedTask={highlightedTask}
              onAgentHover={handleAgentHover}
              onAgentLeave={handleAgentLeave}
              onAgentClick={handleAgentClick}
            />
          );
        })}
      </ScrollView>

      {/* Agent hover card */}
      {hoveredAgent && (
        <AgentHoverCard
          agent={hoveredAgent}
          anchorEl={anchorEl}
          visible={!!hoveredAgent}
        />
      )}
    </View>
  );
}

function StatItem({ label, value, warn, over }: { label: string; value: number; warn?: boolean; over?: boolean }) {
  const valueColor = over ? C.error : warn ? C.warning : C.textPrimary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: valueColor }}>{value}</Text>
      <Text style={{ fontSize: 12, color: C.textSecondary }}>{label}</Text>
    </View>
  );
}

const styles = {
  filterBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: C.surface1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  searchWrapper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    position: 'relative' as const,
  },
  searchIcon: {
    position: 'absolute' as const,
    left: 10,
    fontSize: 14,
    color: C.textSecondary,
    zIndex: 1,
    pointerEvents: 'none' as const,
  },
  filterBtns: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  filterBtn: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    cursor: 'pointer' as const,
  },
  filterBtnActive: {
    borderColor: C.brand,
    backgroundColor: palette.brand.dim08,
  },
  filterBtnText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  filterBtnTextActive: {
    color: C.brand,
  },
  statsBar: {
    flexDirection: 'row' as const,
    gap: 24,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: C.surface1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexWrap: 'wrap' as const,
  },
  boardContainer: {
    padding: 20,
    gap: 14,
    alignItems: 'flex-start' as const,
  },
};

// Native <input> element styles for web
const nativeInputStyle: React.CSSProperties = {
  background: C.surface2,
  border: `1px solid ${C.border}`,
  color: C.textPrimary,
  padding: '6px 12px 6px 32px',
  borderRadius: 6,
  fontSize: 13,
  width: 200,
  outline: 'none',
  fontFamily: "'Inter', -apple-system, sans-serif",
};
