import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { AuditReport, StatusCache, DashboardData } from './types.js';
import { OverviewView } from './views/OverviewView.js';
import { KanbanView } from './views/KanbanView.js';
import { ProductivityView } from './views/ProductivityView.js';
import { AgentsView } from './views/AgentsView.js';
import { SessionsView } from './views/SessionsView.js';
import { GraphView } from './views/GraphView.js';
import { QualityView } from './views/QualityView.js';
import { TaskDetailView } from './views/TaskDetailView.js';
import { SessionDetailView } from './views/SessionDetailView.js';
import { CommandPalette } from './components/shared/CommandPalette.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewId = 'overview' | 'kanban' | 'productivity' | 'agents' | 'sessions' | 'graph' | 'quality' | 'task' | 'session';

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  hash: string;
}

interface AppProps {
  audit: AuditReport;
  status: StatusCache;
  dashboard: DashboardData | null;
  liveMode?: boolean;
  sseConnected?: boolean;
  lastRefresh?: Date | null;
}

/** Parsed result from current window.location.hash */
export interface HashLocation {
  view: ViewId;
  params: URLSearchParams;
}

// ---------------------------------------------------------------------------
// Navigation config
// ---------------------------------------------------------------------------

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: '⌂', hash: '#overview' },
  { id: 'kanban', label: 'Kanban', icon: '▦', hash: '#kanban' },
  { id: 'productivity', label: 'Productivity', icon: '◈', hash: '#productivity' },
  { id: 'agents', label: 'Agents', icon: '◉', hash: '#agents' },
  { id: 'sessions', label: 'Sessions', icon: '◷', hash: '#sessions' },
  { id: 'graph', label: 'Graph', icon: '◎', hash: '#graph' },
  { id: 'quality', label: 'Quality', icon: '◆', hash: '#quality' },
];

const VALID_VIEWS = new Set<string>([...NAV_ITEMS.map(n => n.id), 'task', 'session']);

function parseHash(hash: string): HashLocation {
  // Format: #view?param=value&param2=value2
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [viewPart, queryPart] = withoutHash.split('?');
  const view = (VALID_VIEWS.has(viewPart) ? viewPart : 'overview') as ViewId;
  const params = new URLSearchParams(queryPart ?? '');
  return { view, params };
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarProps {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  projectName: string;
  generatedAt: string;
  onOpenPalette: () => void;
  liveMode?: boolean;
  sseConnected?: boolean;
  lastRefresh?: Date | null;
}

function Sidebar({ active, onSelect, projectName, generatedAt, onOpenPalette, liveMode, sseConnected, lastRefresh }: SidebarProps) {
  return (
    <View style={styles.sidebar}>
      {/* Header */}
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarTitle}>Brain</Text>
      </View>

      {/* Command palette button */}
      <Pressable onPress={onOpenPalette} style={styles.paletteBtn}>
        <Text style={styles.paletteBtnIcon}>⌕</Text>
        <Text style={styles.paletteBtnText}>Search…</Text>
        <View style={styles.paletteBtnKbd}>
          <Text style={styles.paletteBtnKbdText}>⌘K</Text>
        </View>
      </Pressable>

      {/* Nav items */}
      <View style={styles.navList}>
        {NAV_ITEMS.map((item) => {
          const effectiveActive = active === 'session' ? 'sessions' : active;
          const isActive = item.id === effectiveActive;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                window.location.hash = item.hash;
                onSelect(item.id);
              }}
              style={({ pressed }: { pressed: boolean }) => [
                styles.navItem,
                isActive && styles.navItemActive,
                pressed && !isActive && styles.navItemPressed,
              ]}
            >
              <Text style={[styles.navIcon, isActive && styles.navIconActive]}>
                {item.icon}
              </Text>
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                {item.label}
              </Text>
              {isActive && <View style={styles.navActiveBar} />}
            </Pressable>
          );
        })}
      </View>

      {/* Footer */}
      <View style={styles.sidebarFooter}>
        <Text style={styles.footerProject}>{projectName}</Text>
        <Text style={styles.footerTime}>{generatedAt}</Text>
        <View style={styles.liveIndicator}>
          <View style={[styles.liveDot, liveMode && sseConnected ? styles.liveDotActive : styles.liveDotStatic]} />
          <Text style={styles.liveLabel}>
            {liveMode && sseConnected ? 'Live' : liveMode ? 'Connecting…' : 'Static'}
          </Text>
          {liveMode && lastRefresh && (
            <Text style={styles.liveRefresh}>
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({ audit, status, dashboard, liveMode, sseConnected, lastRefresh }: AppProps) {
  const [location, setLocation] = useState<HashLocation>(() =>
    parseHash(window.location.hash),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeView = location.view;

  // Sync with browser hash changes (back/forward navigation)
  useEffect(() => {
    const onHashChange = () => setLocation(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // ⌘K global shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(open => !open);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNavSelect = useCallback((id: ViewId) => {
    setLocation({ view: id, params: new URLSearchParams() });
  }, []);

  const generatedAt = new Date(audit.generatedAt).toLocaleString();
  const projectName = audit.notesDir?.split('/').pop() ?? 'brain';

  // Extract initial selection params for each view
  const taskParam = location.params.get('task') ?? undefined;
  const taskIdParam = location.params.get('id') ?? undefined;
  const agentParam = location.params.get('agent') ?? undefined;
  const sessionParam = location.params.get('session') ?? undefined;
  const sessionIdParam = activeView === 'session' ? (location.params.get('id') ?? undefined) : undefined;

  return (
    <View style={styles.root}>
      <Sidebar
        active={activeView}
        onSelect={handleNavSelect}
        projectName={projectName}
        generatedAt={generatedAt}
        onOpenPalette={() => setPaletteOpen(true)}
        liveMode={liveMode}
        sseConnected={sseConnected}
        lastRefresh={lastRefresh}
      />

      <View style={styles.main}>
        <View style={activeView === 'session' ? styles.contentFullBleed : styles.content}>
          {activeView === 'overview' && (
            <OverviewView audit={audit} status={status} dashboard={dashboard} />
          )}
          {activeView === 'kanban' && (
            <KanbanView dashboard={dashboard} initialTask={taskParam} />
          )}
          {activeView === 'productivity' && (
            <ProductivityView dashboard={dashboard} audit={audit} initialAgent={agentParam} />
          )}
          {activeView === 'agents' && (
            <AgentsView dashboard={dashboard} initialAgent={agentParam} />
          )}
          {activeView === 'sessions' && (
            <SessionsView dashboard={dashboard} initialSession={sessionParam} />
          )}
          {activeView === 'graph' && (
            <GraphView dashboard={dashboard} audit={audit} />
          )}
          {activeView === 'quality' && (
            <QualityView dashboard={dashboard} />
          )}
          {activeView === 'task' && (
            <TaskDetailView taskId={taskIdParam ?? ''} dashboard={dashboard} />
          )}
          {activeView === 'session' && (
            <SessionDetailView sessionId={sessionIdParam ?? ''} dashboard={dashboard} />
          )}
        </View>
      </View>

      {paletteOpen && (
        <CommandPalette
          dashboard={dashboard}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const BRAND = '#FF7900';
const BG = '#101010';
const SIDEBAR_BG = '#161616';
const BORDER = '#2a2a2a';
const TEXT_PRIMARY = '#F3F4F6';
const TEXT_SECONDARY = '#9CA3AF';
const TEXT_TERTIARY = '#6B7280';
const ACTIVE_BG = 'rgba(255, 121, 0, 0.08)';
const HOVER_BG = 'rgba(255, 255, 255, 0.04)';
const SURFACE2 = '#191919';
const SURFACE3 = '#1e1e1e';

const styles = {
  root: {
    flexDirection: 'row' as const,
    minHeight: '100vh' as unknown as number,
    backgroundColor: BG,
  },
  sidebar: {
    width: 240,
    backgroundColor: SIDEBAR_BG,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    flexDirection: 'column' as const,
    flexShrink: 0,
    minHeight: '100vh' as unknown as number,
  },
  sidebarHeader: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: TEXT_PRIMARY,
    fontFamily: 'Space Grotesk, sans-serif',
    letterSpacing: -0.3,
  },
  paletteBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: SURFACE2,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    cursor: 'pointer' as unknown as undefined,
  },
  paletteBtnIcon: {
    fontSize: 13,
    color: TEXT_TERTIARY,
  },
  paletteBtnText: {
    flex: 1,
    fontSize: 12,
    color: TEXT_TERTIARY,
    fontFamily: 'Inter, sans-serif',
  },
  paletteBtnKbd: {
    backgroundColor: SURFACE3,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  paletteBtnKbdText: {
    fontSize: 10,
    color: TEXT_TERTIARY,
    fontFamily: 'monospace',
  },
  navList: {
    flex: 1,
    paddingVertical: 8,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    position: 'relative' as const,
    cursor: 'pointer' as unknown as undefined,
  },
  navItemActive: {
    backgroundColor: ACTIVE_BG,
  },
  navItemPressed: {
    backgroundColor: HOVER_BG,
  },
  navIcon: {
    fontSize: 16,
    color: TEXT_TERTIARY,
    width: 20,
    textAlign: 'center' as const,
  },
  navIconActive: {
    color: BRAND,
  },
  navLabel: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    fontWeight: '500' as const,
  },
  navLabelActive: {
    color: TEXT_PRIMARY,
    fontWeight: '600' as const,
  },
  navActiveBar: {
    position: 'absolute' as const,
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    backgroundColor: BRAND,
    borderRadius: 2,
  },
  sidebarFooter: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 2,
  },
  footerProject: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    fontWeight: '600' as const,
  },
  footerTime: {
    fontSize: 11,
    color: TEXT_TERTIARY,
  },
  liveIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginTop: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveDotActive: {
    backgroundColor: '#14B8A6',
  },
  liveDotStatic: {
    backgroundColor: '#4B5563',
  },
  liveLabel: {
    fontSize: 11,
    color: TEXT_TERTIARY,
    fontWeight: '500' as const,
  },
  liveRefresh: {
    fontSize: 10,
    color: TEXT_TERTIARY,
    fontFamily: 'monospace',
  },
  main: {
    flex: 1,
    backgroundColor: BG,
    overflowY: 'auto' as unknown as undefined,
    overflow: 'hidden' as unknown as undefined,
  },
  content: {
    maxWidth: 1200,
    padding: 24,
  },
  contentFullBleed: {
    flex: 1,
    padding: 0,
    maxWidth: undefined,
  },
};
