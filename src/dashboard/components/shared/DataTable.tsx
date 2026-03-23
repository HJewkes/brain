import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './colors.js';

export interface DataTableColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right';
  flex?: number;
}

export interface DataTableProps<T> {
  columns: DataTableColumn[];
  data: T[];
  renderCell: (item: T, columnKey: string) => React.ReactNode;
  highlightRow?: (item: T) => boolean;
  getKey: (item: T) => string;
  emptyText?: string;
}

export function DataTable<T>({
  columns,
  data,
  renderCell,
  highlightRow,
  getKey,
  emptyText = 'No data',
}: DataTableProps<T>) {
  if (data.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View>
      {data.map(item => {
        const highlighted = highlightRow?.(item) ?? false;
        return (
          <View
            key={getKey(item)}
            style={[styles.row, highlighted && styles.rowHighlighted]}
          >
            {columns.map(col => (
              <View
                key={col.key}
                style={[
                  styles.cell,
                  col.width != null ? { width: col.width } : { flex: col.flex ?? 1 },
                  col.align === 'right' && styles.cellRight,
                ]}
              >
                {renderCell(item, col.key)}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: 14, color: C.textTertiary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowHighlighted: {
    backgroundColor: 'rgba(99,102,241,0.06)',
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  cell: { justifyContent: 'center' },
  cellRight: { alignItems: 'flex-end' },
});
