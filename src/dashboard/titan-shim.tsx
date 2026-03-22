/**
 * Local shim for @titan-design/react-ui components.
 * Uses react-native-web primitives + Titan CSS variables.
 * Replaced by the real package when ../titan-design is available.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import { palette, colors } from './tokens.js';

// Re-export shared colors so consumers can import from this module.
export { C } from './components/shared/colors.js';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardHeader({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.cardHeader, style]}>{children}</View>;
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.cardTitle}>{children}</Text>;
}

export function CardContent({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.cardContent, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------
interface TypographyProps {
  children: React.ReactNode;
  variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'body' | 'caption' | 'label';
  color?: 'primary' | 'secondary' | 'tertiary' | 'brand';
  style?: TextStyle;
}

const VARIANT_STYLES: Record<string, TextStyle> = {
  h1: { fontSize: 28, fontWeight: '700' },
  h2: { fontSize: 24, fontWeight: '700' },
  h3: { fontSize: 20, fontWeight: '600' },
  h4: { fontSize: 18, fontWeight: '600' },
  h5: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '400' },
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
};

const COLOR_MAP: Record<string, string> = {
  primary:   colors.textPrimary,
  secondary: colors.textSecondary,
  tertiary:  colors.textTertiary,
  brand:     colors.brand,
};

export function Typography({ children, variant = 'body', color = 'primary', style }: TypographyProps) {
  return (
    <Text style={[VARIANT_STYLES[variant], { color: COLOR_MAP[color] ?? COLOR_MAP.primary }, style]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
export type BadgeColor = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const BADGE_COLORS: Record<BadgeColor, { bg: string; text: string }> = {
  success: { bg: palette.teal.dim15,   text: palette.teal.base },
  warning: { bg: palette.amber.dim15,  text: palette.amber.base },
  error:   { bg: palette.red.dim12,    text: palette.red.base },
  info:    { bg: 'rgba(33,150,243,0.15)', text: palette.blue.base },
  neutral: { bg: palette.gray.dim15,   text: colors.textSecondary },
};

export function Badge({ children, color = 'neutral' }: { children: React.ReactNode; color?: BadgeColor }) {
  const c = BADGE_COLORS[color] ?? BADGE_COLORS.neutral;
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: c.text, fontSize: 11, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Metric
// ---------------------------------------------------------------------------
export function Metric({ label, value, delta }: { label: string; value: string | number; delta?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {delta && <Text style={styles.metricDelta}>{delta}</Text>}
    </View>
  );
}

export function MetricGroup({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.metricGroup, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
export function Progress({ value, max = 100, color = colors.brand }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <View style={{ height: 6, backgroundColor: palette.surface3, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// DataRow
// ---------------------------------------------------------------------------
export function DataRow({ label, value, style }: { label: string; value: string | number; style?: ViewStyle }) {
  return (
    <View style={[styles.dataRow, style]}>
      <Text style={styles.dataRowLabel}>{label}</Text>
      <Text style={styles.dataRowValue}>{String(value)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export function Table({ children }: { children: React.ReactNode }) {
  return <View style={styles.table}>{children}</View>;
}

export function TableHeader({ children }: { children: React.ReactNode }) {
  return <View style={styles.tableHeader}>{children}</View>;
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
}

export function TableRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.tableRow}>{children}</View>;
}

export function TableHeaderCell({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.tableCell, style]}>
      <Text style={styles.tableHeaderText}>{children}</Text>
    </View>
  );
}

export function TableCell({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.tableCell, style]}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text style={styles.tableCellText}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function Row({ children, gap = 16, style }: { children: React.ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', gap }, style]}>{children}</View>;
}

export function Column({ children, gap = 16, style }: { children: React.ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'column', gap }, style]}>{children}</View>;
}

export function Grid({ children, columns = 2, gap = 16, style }: { children: React.ReactNode; columns?: number; gap?: number; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>
      {React.Children.map(children, (child) => (
        <View style={{ flex: 1, minWidth: `${Math.floor(100 / columns) - 2}%` as unknown as number }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section with title
// ---------------------------------------------------------------------------
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.section}>
      <Text style={sectionStyles.title}>{title}</Text>
      {children}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  section: { marginBottom: 8 },
  title: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
});

// ---------------------------------------------------------------------------
// Typography shortcuts
// ---------------------------------------------------------------------------
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 13, color: colors.textSecondary }}>{children}</Text>;
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
export function EmptyState({ message }: { message: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
      <Text style={{ fontSize: 13, color: colors.textTertiary, fontStyle: 'italic' }}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardContent: {
    padding: 16,
  },
  metric: {
    alignItems: 'center',
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricDelta: {
    fontSize: 11,
    color: palette.teal.base,
    fontWeight: '600',
  },
  metricGroup: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 16,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.surface3,
  },
  dataRowLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  dataRowValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    backgroundColor: colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: palette.surface3,
  },
  tableCell: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tableHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableCellText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
});
