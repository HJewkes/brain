import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './colors.js';

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
          <View style={[styles.deltaBadge, { backgroundColor: deltaPositive ? 'rgba(20,184,166,0.15)' : 'rgba(209,67,67,0.15)' }]}>
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
    padding: 20,
  },
  label: {
    fontSize: 12,
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    fontFamily: 'Inter',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: {
    fontSize: 32,
    fontWeight: '700',
    color: C.textPrimary,
    lineHeight: 32,
    fontFamily: 'Inter',
  },
  deltaBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  deltaText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter',
  },
  sparkContainer: {
    marginTop: 12,
    height: 32,
  },
});
