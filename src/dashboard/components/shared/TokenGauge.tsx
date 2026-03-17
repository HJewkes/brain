import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './colors.js';
import { fmtK } from '../../utils/formatting.js';

interface Props {
  tokensIn: number;
  tokensOut: number;
  maxTokens?: number;
}

export function TokenGauge({ tokensIn, tokensOut, maxTokens = 200000 }: Props) {
  const total = tokensIn + tokensOut;
  const inPct = Math.round((tokensIn / maxTokens) * 100);
  const outPct = Math.min(Math.round((tokensOut / maxTokens) * 100), 100 - inPct);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Token Usage</Text>
        <Text style={styles.headerValue}>{fmtK(total)} / {fmtK(maxTokens)}</Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barIn, { width: `${inPct}%` as unknown as number }]} />
        <View style={[styles.barOut, { width: `${outPct}%` as unknown as number }]} />
      </View>
      <View style={styles.labels}>
        <Text style={styles.labelIn}>↓ {fmtK(tokensIn)} input</Text>
        <Text style={styles.labelOut}>↑ {fmtK(tokensOut)} output</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerLabel: { fontSize: 11, color: C.textTertiary },
  headerValue: { fontSize: 11, color: C.textTertiary },
  bar: {
    height: 8,
    backgroundColor: C.surface3,
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  barIn: {
    height: '100%' as unknown as number,
    backgroundColor: C.info,
  },
  barOut: {
    height: '100%' as unknown as number,
    backgroundColor: C.brand,
    marginLeft: 1,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  labelIn: { fontSize: 10, color: C.info },
  labelOut: { fontSize: 10, color: C.brand },
});
