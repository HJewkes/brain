import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import type { FileEntry } from './precompute.js';
import { widgetLabel } from './shared-styles.js';

interface Props {
  filesTimeline: FileEntry[];
  totalReadFiles: number;
  totalWriteFiles: number;
  startedAt: string;
}

const READ_COLOR = '#1965B0';
const WRITE_COLOR = '#14B8A6';

export function FilesWidget({ filesTimeline, totalReadFiles, totalWriteFiles, startedAt }: Props) {
  const currentTs = useCurrentTimestamp();

  const { readCount, writeCount, latestFile } = useMemo(() => {
    const tsMs = new Date(currentTs || startedAt).getTime();
    let reads = 0;
    let writes = 0;
    let latest = '';
    for (const f of filesTimeline) {
      if (f.timestamp > tsMs) break;
      if (f.type === 'read') reads++;
      else writes++;
      latest = f.path;
    }
    return { readCount: reads, writeCount: writes, latestFile: latest };
  }, [currentTs, filesTimeline, startedAt]);

  const readPct = totalReadFiles ? (readCount / totalReadFiles) * 100 : 0;
  const writePct = totalWriteFiles ? (writeCount / totalWriteFiles) * 100 : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>FILES</Text>
      <Text style={styles.summary}>
        {readCount + writeCount} touched {'\u00B7'} {writeCount} written
      </Text>
      <BarRow
        letter="R"
        color={READ_COLOR}
        current={readCount}
        total={totalReadFiles}
        pct={readPct}
      />
      <BarRow
        letter="W"
        color={WRITE_COLOR}
        current={writeCount}
        total={totalWriteFiles}
        pct={writePct}
      />
      {latestFile ? (
        <Text style={styles.latest} numberOfLines={1}>
          {latestFile.split('/').pop()}
        </Text>
      ) : null}
    </View>
  );
}

interface BarRowProps {
  letter: string;
  color: string;
  current: number;
  total: number;
  pct: number;
}

function BarRow({ letter, color, current, total, pct }: BarRowProps) {
  return (
    <View style={styles.barRow}>
      <Text style={[styles.barLabel, { color }]}>{letter}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` as unknown as number, backgroundColor: color }]} />
      </View>
      <Text style={styles.barCount}>{current}/{total}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: widgetLabel,
  summary: {
    fontFamily: 'Space Grotesk',
    fontSize: 12,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 6,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  barLabel: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    fontWeight: '700',
    width: 14,
    textAlign: 'center',
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#1f1f1f',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  barCount: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    color: C.textTertiary,
    width: 38,
    textAlign: 'right',
  },
  latest: {
    fontFamily: 'Inter',
    fontSize: 9,
    color: C.textTertiary,
    marginTop: 4,
  },
});
