import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { palette, semantic, component, sp } from '../../tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppSidebarProps {
  active: string;
  onSelect: (id: string) => void;
  navItems: Array<{ id: string; label: string; icon: string; hash: string }>;
  projectName: string;
  generatedAt: string;
  onOpenPalette: () => void;
  liveMode?: boolean;
  sseConnected?: boolean;
  lastRefresh?: Date | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppSidebar({
  active,
  onSelect,
  navItems,
  projectName,
  generatedAt,
  onOpenPalette,
  liveMode,
  sseConnected,
  lastRefresh,
}: AppSidebarProps) {
  return (
    <View style={styles.sidebar}>
      {/* Header */}
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarTitle}>Brain</Text>
      </View>

      {/* Command palette button */}
      <Pressable onPress={onOpenPalette} style={styles.paletteBtn}>
        <Text style={styles.paletteBtnIcon}>⌕</Text>
        <Text style={styles.paletteBtnText}>Search…</Text>
        <View style={styles.paletteBtnKbd}>
          <Text style={styles.paletteBtnKbdText}>⌘K</Text>
        </View>
      </Pressable>

      {/* Nav items */}
      <View style={styles.navList}>
        {navItems.map((item) => {
          const effectiveActive = active === 'session' ? 'sessions' : active;
          const isActive = item.id === effectiveActive;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                window.location.hash = item.hash;
                onSelect(item.id);
              }}
              style={({ pressed }: { pressed: boolean }) => [
                styles.navItem,
                isActive && styles.navItemActive,
                pressed && !isActive && styles.navItemPressed,
              ]}
            >
              <Text style={[styles.navIcon, isActive && styles.navIconActive]}>
                {item.icon}
              </Text>
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                {item.label}
              </Text>
              {isActive && <View style={styles.navActiveBar} />}
            </Pressable>
          );
        })}
      </View>

      {/* Footer */}
      <View style={styles.sidebarFooter}>
        <Text style={styles.footerProject}>{projectName}</Text>
        <Text style={styles.footerTime}>{generatedAt}</Text>
        <View style={styles.liveIndicator}>
          <View style={[styles.liveDot, liveMode && sseConnected ? styles.liveDotActive : styles.liveDotStatic]} />
          <Text style={styles.liveLabel}>
            {liveMode && sseConnected ? 'Live' : liveMode ? 'Connecting…' : 'Static'}
          </Text>
          {liveMode && lastRefresh && (
            <Text style={styles.liveRefresh}>
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const BRAND = palette.brand.base;
const BORDER = semantic.border;
const TEXT_PRIMARY = semantic.text.primary;
const TEXT_SECONDARY = semantic.text.secondary;
const TEXT_TERTIARY = semantic.text.tertiary;
const ACTIVE_BG = component.sidebar.navActiveBg;
const HOVER_BG = component.sidebar.navHoverBg;
const SIDEBAR_BG = component.sidebar.bg;
const SURFACE2 = palette.surface2;
const SURFACE3 = palette.surface3;

const styles = {
  sidebar: {
    width: 240,
    backgroundColor: SIDEBAR_BG,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    flexDirection: 'column' as const,
    flexShrink: 0,
    minHeight: '100vh' as unknown as number,
  },
  sidebarHeader: {
    paddingHorizontal: sp[10],
    paddingVertical: sp[10],
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: TEXT_PRIMARY,
    fontFamily: "'Space Grotesk', sans-serif",
    letterSpacing: -0.3,
  },
  paletteBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp[4],
    marginHorizontal: sp[6],
    marginTop: sp[6],
    marginBottom: sp[2],
    paddingHorizontal: sp[5],
    paddingVertical: 7,
    backgroundColor: SURFACE2,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: sp[4],
    cursor: 'pointer' as unknown as undefined,
  },
  paletteBtnIcon: {
    fontSize: 13,
    color: TEXT_TERTIARY,
  },
  paletteBtnText: {
    flex: 1,
    fontSize: 12,
    color: TEXT_TERTIARY,
    fontFamily: "'Inter', sans-serif",
  },
  paletteBtnKbd: {
    backgroundColor: SURFACE3,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  paletteBtnKbdText: {
    fontSize: 10,
    color: TEXT_TERTIARY,
    fontFamily: 'monospace',
  },
  navList: {
    flex: 1,
    paddingVertical: sp[4],
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: sp[8],
    paddingVertical: sp[5],
    gap: sp[5],
    position: 'relative' as const,
    cursor: 'pointer' as unknown as undefined,
  },
  navItemActive: {
    backgroundColor: ACTIVE_BG,
  },
  navItemPressed: {
    backgroundColor: HOVER_BG,
  },
  navIcon: {
    fontSize: 16,
    color: TEXT_TERTIARY,
    width: 20,
    textAlign: 'center' as const,
  },
  navIconActive: {
    color: BRAND,
  },
  navLabel: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    fontWeight: '500' as const,
  },
  navLabelActive: {
    color: TEXT_PRIMARY,
    fontWeight: '600' as const,
  },
  navActiveBar: {
    position: 'absolute' as const,
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    backgroundColor: BRAND,
    borderRadius: 2,
  },
  sidebarFooter: {
    paddingHorizontal: sp[8],
    paddingVertical: sp[8],
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: sp[1],
  },
  footerProject: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    fontWeight: '600' as const,
  },
  footerTime: {
    fontSize: 11,
    color: TEXT_TERTIARY,
  },
  liveIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp[3],
    marginTop: sp[3],
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveDotActive: {
    backgroundColor: component.liveIndicator.active,
  },
  liveDotStatic: {
    backgroundColor: component.liveIndicator.static,
  },
  liveLabel: {
    fontSize: 11,
    color: TEXT_TERTIARY,
    fontWeight: '500' as const,
  },
  liveRefresh: {
    fontSize: 10,
    color: TEXT_TERTIARY,
    fontFamily: 'monospace',
  },
};
