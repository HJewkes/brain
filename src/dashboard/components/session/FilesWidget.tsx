import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, component, palette } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import type { FileEntry } from './precompute.js';
import { widgetLabel } from './shared-styles.js';

interface Props {
  filesTimeline: FileEntry[];
  totalReadFiles: number;
  totalWriteFiles: number;
  startedAt: string;
}

const READ_LABEL_COLOR = component.filesWidget.readLabel;
const READ_FILL_COLOR = component.filesWidget.readFill;
const WRITE_COLOR = component.filesWidget.writeColor;

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
        labelColor={READ_LABEL_COLOR}
        fillColor={READ_FILL_COLOR}
        current={readCount}
        total={totalReadFiles}
        pct={readPct}
      />
      <BarRow
        letter="W"
        labelColor={WRITE_COLOR}
        fillColor={WRITE_COLOR}
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
  labelColor: string;
  fillColor: string;
  current: number;
  total: number;
  pct: number;
}

function BarRow({ letter, labelColor, fillColor, current, total, pct }: BarRowProps) {
  return (
    <View style={styles.barRow}>
      <Text style={[styles.barLabel, { color: labelColor }]}>{letter}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` as unknown as number, backgroundColor: fillColor }]} />
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
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 4,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  barLabel: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    fontWeight: '700',
    width: 10,
    flexShrink: 0,
  },
  barTrack: {
    flex: 1,
    height: 5,
    backgroundColor: component.filesWidget.trackBg,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },
  barCount: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    color: C.textTertiary,
    width: 32,
    textAlign: 'right',
    flexShrink: 0,
  },
  latest: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    color: C.textTertiary,
    marginTop: 4,
  },
});
