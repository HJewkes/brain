import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import type { SessionDetailData } from '../../types.js';
import { buildTimelines } from './precompute.js';
import { TimeIndicator } from './TimeIndicator.js';
import { ProgressWidget } from './ProgressWidget.js';
import { MiniKanban } from './MiniKanban.js';
import { AgentStatusWidget } from './AgentStatusWidget.js';
import { ContextWindowChart } from './ContextWindowChart.js';
import { FilesWidget } from './FilesWidget.js';
import { ToolBreakdownWidget } from './ToolBreakdownWidget.js';
import { ErrorsWidget } from './ErrorsWidget.js';

interface Props {
  data: SessionDetailData;
}

export function SessionSidebar({ data }: Props) {
  const pre = useMemo(() => buildTimelines(data), [data]);

  const startedAt = data.session.startedAt;
  const endedAt = data.session.completedAt;

  return (
    <View style={styles.sidebar}>
      <TimeIndicator startedAt={startedAt} />
      <Separator />
      <ProgressWidget
        startedAt={startedAt}
        endedAt={endedAt}
        totalToolCalls={data.totalToolCalls}
        allToolTs={pre.allToolTs}
      />
      <Separator />
      <MiniKanban
        taskEvents={data.taskEvents}
        taskRefs={data.session.tasksWorked}
        startedAt={startedAt}
      />
      <Separator />
      <AgentStatusWidget
        agentTimeline={pre.agentTimeline}
        allToolTs={pre.allToolTs}
        startedAt={startedAt}
      />
      <Separator />
      <ContextWindowChart
        tokenTimeline={data.tokenTimeline}
        compactions={data.compactions}
        startedAt={startedAt}
        endedAt={endedAt}
      />
      <Separator />
      <FilesWidget
        filesTimeline={pre.filesTimeline}
        totalReadFiles={pre.totalReadFiles}
        totalWriteFiles={pre.totalWriteFiles}
        startedAt={startedAt}
      />
      <Separator />
      <ToolBreakdownWidget
        toolTimestamps={pre.toolTimestamps}
        toolTotals={pre.toolTotals}
        startedAt={startedAt}
      />
      <Separator />
      <ErrorsWidget
        errorTimestamps={pre.errorTimestamps}
        startedAt={startedAt}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  sidebar: {
    width: 224,
    padding: 12,
    gap: 0,
  },
  sep: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 2,
  },
});
