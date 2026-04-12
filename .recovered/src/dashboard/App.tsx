import React from 'react';
import { View } from 'react-native';
import { Typography } from '@titan-design/react-ui';
import type { AuditReport, StatusCache } from './types';
import { MetricsRow } from './components/MetricsRow';
import { NotesBreakdown } from './components/NotesBreakdown';
import { TaskBurndown } from './components/TaskBurndown';
import { AgentStatus } from './components/AgentStatus';
import { SessionActivity } from './components/SessionActivity';
import { SearchHealth } from './components/SearchHealth';
import { StorageInfo } from './components/StorageInfo';
import { RelationsSummary } from './components/RelationsSummary';

interface AppProps {
  audit: AuditReport;
  status: StatusCache;
}

export function App({ audit, status }: AppProps) {
  const ts = new Date(audit.timestamp).toLocaleString();
  const dbPath = audit.database?.path ?? '?';
  const schema = `v${audit.database?.schemaVersion ?? '?'}`;

  return (
    <View className="atmosphere-warm min-h-screen">
      <View className="max-w-[1200px] mx-auto p-6 gap-5 relative z-10">
        {/* Header */}
        <View className="flex-row justify-between items-baseline bg-surface-elevated border border-border-strong rounded-lg px-5 py-4">
          <Typography variant="h4" className="text-brand-primary">
            Brain Dashboard
          </Typography>
          <Typography variant="caption" color="tertiary">
            {ts} &middot; {dbPath} &middot; schema {schema}
          </Typography>
        </View>

        <MetricsRow audit={audit} />

        {/* Notes Breakdown */}
        <View className="flex-row gap-4">
          <View className="flex-1">
            <NotesBreakdown
              title="Notes by Module"
              data={audit.notes?.byModule ?? {}}
            />
          </View>
          <View className="flex-1">
            <NotesBreakdown
              title="Notes by Type"
              data={audit.notes?.byType ?? {}}
            />
          </View>
        </View>

        {/* Task + Agents */}
        <View className="flex-row gap-4">
          <View className="flex-1">
            <TaskBurndown pm={audit.pm} />
          </View>
          <View className="flex-1">
            <AgentStatus
              agents={status.agents}
              auditAgents={audit.agents}
            />
          </View>
        </View>

        {/* Session + Search */}
        <View className="flex-row gap-4">
          <View className="flex-1">
            <SessionActivity
              sessions={status.sessions}
              auditSessions={audit.sessions}
            />
          </View>
          <View className="flex-1">
            <SearchHealth search={audit.search} />
          </View>
        </View>

        {/* Storage + Relations */}
        <View className="flex-row gap-4">
          <View className="flex-1">
            <StorageInfo
              database={audit.database}
              chunks={audit.chunks}
              inbox={audit.inbox}
            />
          </View>
          <View className="flex-1">
            <RelationsSummary relations={audit.relations} />
          </View>
        </View>
      </View>
    </View>
  );
}
