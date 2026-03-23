import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { AuditReport, StatusCache, DashboardData } from '../types.js';
import { MetricsRow } from '../components/MetricsRow.js';
import { NotesBreakdown } from '../components/NotesBreakdown.js';
import { TaskBurndown } from '../components/TaskBurndown.js';
import { AgentStatus } from '../components/AgentStatus.js';
import { SessionActivity } from '../components/SessionActivity.js';
import { SearchHealth } from '../components/SearchHealth.js';
import { StorageInfo } from '../components/StorageInfo.js';
import { RelationsSummary } from '../components/RelationsSummary.js';

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
    <View style={s.root}>
      <MetricsRow audit={audit} />

      <View style={s.row}>
        <View style={s.col}>
          <NotesBreakdown title="Notes by Module" data={audit.notes?.byModule ?? {}} />
        </View>
        <View style={s.col}>
          <NotesBreakdown title="Notes by Type" data={audit.notes?.byType ?? {}} />
        </View>
      </View>

      <View style={s.row}>
        <View style={s.col}>
          <TaskBurndown pm={pm} />
        </View>
        <View style={s.col}>
          <AgentStatus agents={status.agents} />
        </View>
      </View>

      <View style={s.row}>
        <View style={s.col}>
          <SessionActivity
            sessions={status.sessions}
            auditSessions={{
              total: dashboard?.sessions?.length ?? 0,
              events: dashboard?.sessions?.reduce((sum, sess) => sum + (sess.events?.length ?? 0), 0) ?? 0,
              chunks: 0,
            }}
          />
        </View>
        <View style={s.col}>
          <SearchHealth search={search} />
        </View>
      </View>

      <View style={s.row}>
        <View style={s.col}>
          <StorageInfo database={database} chunks={chunks} inbox={inbox} />
        </View>
        <View style={s.col}>
          <RelationsSummary relations={audit.relations} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  col: {
    flex: 1,
  },
});
