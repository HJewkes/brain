import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import type { DashboardData, AuditReport, StatusCache } from './types.js';

// ---------------------------------------------------------------------------
// Live mode detection
// ---------------------------------------------------------------------------

const API_BASE = window.__BRAIN_API__ ?? 'http://localhost:7800';

async function detectLiveMode(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/status`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Live dashboard hook
// ---------------------------------------------------------------------------

interface DashboardPayload {
  audit: AuditReport;
  status: StatusCache;
  dashboard: DashboardData | null;
}

function useLiveDashboard(apiBase: string, enabled: boolean) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    fetch(`${apiBase}/api/dashboard`)
      .then((r) => r.json())
      .then((d: DashboardPayload) => setData(d))
      .catch(() => {/* server may have gone away */});

    const es = new EventSource(`${apiBase}/api/events`);
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.addEventListener('refresh', () => {
      fetch(`${apiBase}/api/dashboard`)
        .then((r) => r.json())
        .then((d: DashboardPayload) => setData(d))
        .catch(() => {/* ignore */});
    });

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [apiBase, enabled]);

  return { data, sseConnected };
}

// ---------------------------------------------------------------------------
// Root bootstrap
// ---------------------------------------------------------------------------

function Root() {
  const [liveMode, setLiveMode] = useState<boolean | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    detectLiveMode().then((live) => {
      setLiveMode(live);
      if (live) setLastRefresh(new Date());
    });
  }, []);

  const { data: liveData, sseConnected } = useLiveDashboard(API_BASE, liveMode === true);

  // Track last refresh time when live data updates
  useEffect(() => {
    if (liveData) setLastRefresh(new Date());
  }, [liveData]);

  // Still detecting
  if (liveMode === null) return null;

  const audit = liveMode && liveData ? liveData.audit : window.__AUDIT__;
  const status = liveMode && liveData ? liveData.status : window.__STATUS__;
  const dashboard = liveMode && liveData ? liveData.dashboard : (window.__DASHBOARD__ ?? null);

  // In live mode, wait for first fetch
  if (liveMode && !liveData) return null;

  return (
    <App
      audit={audit}
      status={status}
      dashboard={dashboard}
      liveMode={liveMode}
      sseConnected={sseConnected}
      lastRefresh={lastRefresh}
    />
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
