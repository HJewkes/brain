import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, component } from './colors.js';
import { sp, type as T } from '../../tokens.js';

interface Props {
  label: string;
  value: string | number;
  delta?: string;
  deltaPositive?: boolean;
  sparkData?: number[];
}

function buildSparkPath(data: number[], w: number, h: number): string {
  if (data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return pts.join(' ');
}

export function StatCard({ label, value, delta, deltaPositive = true, sparkData }: Props) {
  const deltaColor = deltaPositive ? C.success : C.error;
  const sparkColor = deltaPositive ? C.brand : C.error;
  const sparkPath = sparkData && sparkData.length >= 2 ? buildSparkPath(sparkData, 120, 32) : '';

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{value}</Text>
        {delta && (
          <View style={[styles.deltaBadge, { backgroundColor: deltaPositive ? component.statCard.positiveDeltaBg : component.statCard.negativeDeltaBg }]}>
            <Text style={[styles.deltaText, { color: deltaColor }]}>{delta}</Text>
          </View>
        )}
      </View>
      {sparkPath ? (
        <View style={styles.sparkContainer}>
          <svg width="100%" height="32" viewBox="0 0 120 32" style={{ display: 'block' }}>
            <polyline points={sparkPath} fill="none" stroke={sparkColor} strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: sp[10],
  },
  label: {
    ...T.bodySm,
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: sp[4],
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp[4],
  },
  value: {
    fontSize: 32,
    fontWeight: '700',
    color: C.textPrimary,
    lineHeight: 32,
    fontFamily: "'Inter', sans-serif",
  },
  deltaBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: sp[1],
  },
  deltaText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: "'Inter', sans-serif",
  },
  sparkContainer: {
    marginTop: sp[6],
    height: 32,
  },
});
