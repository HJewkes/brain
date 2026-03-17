import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import { bisect } from './bisect.js';
import { widgetLabel } from './shared-styles.js';

interface Props {
  startedAt: string;
  endedAt: string | null;
  totalToolCalls: number;
  allToolTs: number[];
}

export function ProgressWidget({ startedAt, endedAt, totalToolCalls, allToolTs }: Props) {
  const currentTs = useCurrentTimestamp();

  const { pct, timeStr, callsStr } = useMemo(() => {
    const t0 = new Date(startedAt).getTime();
    const tEnd = endedAt ? new Date(endedAt).getTime() : t0 + 60 * 60_000;
    const dur = tEnd - t0 || 1;
    const now = new Date(currentTs || startedAt).getTime();
    const fraction = Math.max(0, Math.min(1, (now - t0) / dur));
    const elapsedMin = Math.round((now - t0) / 60_000);
    const totalMin = Math.round(dur / 60_000);
    const calls = bisect(allToolTs, now);
    return {
      pct: Math.round(fraction * 100),
      timeStr: `${fmtDur(elapsedMin)} of ${fmtDur(totalMin)}`,
      callsStr: `${calls} of ${totalToolCalls} calls`,
    };
  }, [currentTs, startedAt, endedAt, totalToolCalls, allToolTs]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>PROGRESS</Text>
      <Text style={styles.pct}>{pct}%</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` as unknown as number }]} />
      </View>
      <View style={styles.statsRow}>
        <Text style={styles.stat}>{timeStr}</Text>
        <Text style={styles.stat}>{callsStr}</Text>
      </View>
    </View>
  );
}

function fmtDur(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const styles = StyleSheet.create({
  container: {},
  label: widgetLabel,
  pct: {
    fontFamily: 'Space Grotesk',
    fontSize: 11,
    fontWeight: '700',
    color: C.brand,
    marginBottom: 4,
  },
  track: {
    height: 6,
    backgroundColor: '#1f1f1f',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  fill: {
    height: 6,
    backgroundColor: C.brand,
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  stat: {
    fontFamily: 'Space Grotesk',
    fontSize: 9,
    color: C.textTertiary,
  },
});
