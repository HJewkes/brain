import React, { useState, useEffect, useCallback } from 'react';
import { View } from 'react-native';
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
import { SpecimenView } from './views/SpecimenView.js';
import { SpecimenGlobalView } from './views/SpecimenGlobalView.js';
import { SpecimenUnifiedView } from './views/SpecimenUnifiedView.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { AppSidebar } from './components/shared/AppSidebar.js';
import { palette, sp } from './tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewId = 'overview' | 'kanban' | 'productivity' | 'agents' | 'sessions' | 'graph' | 'quality' | 'task' | 'session' | 'specimen' | 'specimen-global' | 'specimen-unified';

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

const VALID_VIEWS = new Set<string>([...NAV_ITEMS.map(n => n.id), 'task', 'session', 'specimen', 'specimen-global', 'specimen-unified']);

function parseHash(hash: string): HashLocation {
  // Format: #view?param=value&param2=value2
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [viewPart, queryPart] = withoutHash.split('?');
  const view = (VALID_VIEWS.has(viewPart) ? viewPart : 'overview') as ViewId;
  const params = new URLSearchParams(queryPart ?? '');
  return { view, params };
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
      <AppSidebar
        active={activeView}
        onSelect={handleNavSelect}
        navItems={NAV_ITEMS}
        projectName={projectName}
        generatedAt={generatedAt}
        onOpenPalette={() => setPaletteOpen(true)}
        liveMode={liveMode}
        sseConnected={sseConnected}
        lastRefresh={lastRefresh}
      />

      <View style={styles.main}>
        <View style={activeView === 'session' || activeView === 'specimen' || activeView === 'specimen-global' || activeView === 'specimen-unified' ? styles.contentFullBleed : styles.content}>
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
          {activeView === 'specimen' && (
            <SpecimenView />
          )}
          {activeView === 'specimen-global' && (
            <SpecimenGlobalView />
          )}
          {activeView === 'specimen-unified' && (
            <SpecimenUnifiedView />
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

const BG = palette.bg;

const styles = {
  root: {
    flexDirection: 'row' as const,
    minHeight: '100vh' as unknown as number,
    backgroundColor: BG,
  },
  main: {
    flex: 1,
    backgroundColor: BG,
    overflowY: 'auto' as unknown as undefined,
    overflow: 'hidden' as unknown as undefined,
  },
  content: {
    maxWidth: 1200,
    padding: sp[12],
  },
  contentFullBleed: {
    flex: 1,
    padding: 0,
    maxWidth: undefined,
  },
};
