import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { C } from './colors.js';
import { sp, typography } from '../../tokens.js';

export interface DetailTopbarChip {
  label: string;
  active?: boolean;
  onPress?: () => void;
}

export interface DetailTopbarMetaItem {
  label: string;
  value: string;
}

export interface DetailTopbarBadge {
  label: string;
  color: string;
}

export interface DetailTopbarProps {
  title: string;
  backLabel?: string;
  onBack?: () => void;
  badge?: DetailTopbarBadge;
  metadata?: DetailTopbarMetaItem[];
  chips?: DetailTopbarChip[];
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  children?: React.ReactNode;
}

/**
 * Reusable detail view topbar: back button, title, status badge, metadata,
 * optional filter chips, optional search input, and an escape hatch via children.
 */
export function DetailTopbar({
  title,
  backLabel = 'Back',
  onBack,
  badge,
  metadata,
  chips,
  searchQuery,
  onSearchChange,
  children,
}: DetailTopbarProps) {
  return (
    <View style={s.header}>
      <View style={s.headerLeft}>
        {onBack != null && (
          <>
            <Pressable onPress={onBack} style={s.backBtn}>
              <Text style={s.backBtnText}>← {backLabel}</Text>
            </Pressable>
            <View style={s.divider} />
          </>
        )}
        <Text style={s.title}>{title}</Text>
        {badge != null && (
          <View style={[
            s.badge,
            {
              backgroundColor: `${badge.color}1A`,
              borderColor: `${badge.color}40`,
            },
          ]}>
            <View style={[s.badgeDot, { backgroundColor: badge.color }]} />
            <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        )}
      </View>

      {metadata != null && metadata.length > 0 && (
        <View style={s.meta}>
          {metadata.map((item, i) => (
            <Text key={i} style={s.metaItem}>{item.value}</Text>
          ))}
        </View>
      )}

      {chips != null && chips.length > 0 && (
        <View style={s.chips}>
          {chips.map((chip, i) => (
            <Pressable
              key={i}
              onPress={chip.onPress}
              style={[s.chip, chip.active && s.chipActive]}
            >
              <Text style={[s.chipText, chip.active && s.chipTextActive]}>
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {(onSearchChange != null || children != null) && (
        <View style={s.right}>
          {onSearchChange != null && (
            <TextInput
              style={s.searchInput}
              value={searchQuery ?? ''}
              onChangeText={onSearchChange}
              placeholder="Search turns..."
              placeholderTextColor={C.textTertiary}
            />
          )}
          {children}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: C.surface1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: sp[8],
    paddingVertical: sp[5],
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: sp[6],
  },

  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: sp[5] },

  backBtn: { paddingHorizontal: sp[4], paddingVertical: sp[2] },
  backBtnText: { fontSize: 12, color: C.textTertiary, fontWeight: '500' },

  divider: { width: 1, height: 16, backgroundColor: C.border },

  title: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textPrimary,
    fontFamily: typography.fonts.heading,
  },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp[2],
    paddingHorizontal: sp[4],
    paddingVertical: sp[1],
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    fontFamily: typography.fonts.heading,
  },

  meta: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  metaItem: { fontSize: 12, color: C.textTertiary, fontFamily: typography.fonts.heading },

  chips: { flexDirection: 'row', gap: sp[2] },
  chip: {
    paddingHorizontal: sp[4],
    paddingVertical: sp[1],
    borderRadius: 4,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { fontSize: 11, color: C.textTertiary, fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  right: { marginLeft: 'auto' as unknown as number, flexDirection: 'row', alignItems: 'center', gap: sp[4] },

  searchInput: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    color: C.textPrimary,
    fontSize: 12,
    paddingHorizontal: sp[5],
    paddingVertical: 5,
    width: 200,
    outlineStyle: 'none' as never,
  },
});
