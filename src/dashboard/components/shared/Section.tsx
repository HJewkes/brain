import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './colors.js';
import { type as T } from '../../tokens.js';

interface SectionProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** 'card' wraps content in a bordered surface card (default).
   *  'inline' renders a title + horizontal rule with no card chrome. */
  variant?: 'card' | 'inline';
}

export function Section({ title, subtitle, children, variant = 'card' }: SectionProps) {
  if (variant === 'inline') {
    return (
      <View style={styles.inlineSection}>
        <View style={styles.inlineHeader}>
          <Text style={styles.inlineTitle}>{title}</Text>
          {subtitle && <Text style={styles.inlineSubtitle}>{subtitle}</Text>}
          <View style={styles.inlineLine} />
        </View>
        {children}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  /* card variant */
  card: {
    backgroundColor: C.surface1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 20,
  },
  cardTitle: {
    ...T.headingMd,
    color: C.textPrimary,
    marginBottom: 16,
  },
  cardSubtitle: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: -12,
    marginBottom: 12,
  },

  /* inline variant */
  inlineSection: {
    gap: 12,
  },
  inlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inlineTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 0,
    fontFamily: "'Space Grotesk', sans-serif",
  },
  inlineSubtitle: {
    fontSize: 12,
    color: C.textTertiary,
  },
  inlineLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
});
