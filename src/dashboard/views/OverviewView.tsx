import React from 'react';
import { View } from 'react-native';
import type { AuditReport, StatusCache, DashboardData } from '../types.js';
import { MetricsRow } from '../components/MetricsRow.js';
import { NotesBreakdown } from '../components/NotesBreakdown.js';
import { TaskBurndown } from '../components/TaskBurndown.js';
import { AgentStatus } from '../components/AgentStatus.js';
import { SessionActivity } from '../components/SessionActivity.js';
import { SearchHealth } from '../components/SearchHealth.js';
import { StorageInfo } from '../components/StorageInfo.js';
import { RelationsSummary } from '../components/RelationsSummary.js';
import { Row } from '../titan-shim.js';

interface OverviewViewProps {
  audit: AuditReport;
  status: StatusCache;
  dashboard?: DashboardData | null;
}

export function OverviewView({ audit, status, dashboard }: OverviewViewProps) {
  // Adapt new audit shape to the legacy prop shapes the components expect
  const pm = {
    projects: 0,
    tasks: audit.tasks?.total ?? 0,
    tasksByStatus: audit.tasks?.byStatus ?? {},
  };

  const search = {
    ftsEntries: audit.search?.ftsCount ?? 0,
    trigramEntries: audit.search?.trigramCount ?? 0,
    vectorRows: audit.search?.vectorCount ?? 0,
  };

  const database = { sizeBytes: audit.storage?.dbSizeBytes ?? 0 };
  const chunks = { total: audit.storage?.chunkCount ?? 0, embedded: audit.storage?.chunkCount ?? 0 };
  const inbox = {
    total: audit.storage?.inboxTotal ?? 0,
    pending: audit.storage?.inboxPending ?? 0,
    feeds: audit.storage?.feedCount ?? 0,
  };

  return (
    <View style={{ gap: 16 }}>
      <MetricsRow audit={audit} />

      <Row>
        <View style={{ flex: 1 }}>
          <NotesBreakdown title="Notes by Module" data={audit.notes?.byModule ?? {}} />
        </View>
        <View style={{ flex: 1 }}>
          <NotesBreakdown title="Notes by Type" data={audit.notes?.byType ?? {}} />
        </View>
      </Row>

      <Row>
        <View style={{ flex: 1 }}>
          <TaskBurndown pm={pm} />
        </View>
        <View style={{ flex: 1 }}>
          <AgentStatus agents={status.agents} />
        </View>
      </Row>

      <Row>
        <View style={{ flex: 1 }}>
          <SessionActivity
            sessions={status.sessions}
            auditSessions={{
              total: dashboard?.sessions?.length ?? 0,
              events: dashboard?.sessions?.reduce((s, sess) => s + (sess.events?.length ?? 0), 0) ?? 0,
              chunks: 0,
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <SearchHealth search={search} />
        </View>
      </Row>

      <Row>
        <View style={{ flex: 1 }}>
          <StorageInfo database={database} chunks={chunks} inbox={inbox} />
        </View>
        <View style={{ flex: 1 }}>
          <RelationsSummary relations={audit.relations} />
        </View>
      </Row>
    </View>
  );
}
