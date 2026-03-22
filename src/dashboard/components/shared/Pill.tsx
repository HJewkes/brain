import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C } from './colors.js';

export interface PillProps {
  label: string;
  /** Text color, default C.textTertiary. */
  color?: string;
  /** Background color, default 'transparent'. */
  bg?: string;
  /** Border color, default 'transparent'. */
  borderColor?: string;
  /** Left accent stripe color, default none. */
  borderLeftColor?: string;
  /** Left accent stripe width, default 0. */
  borderLeftWidth?: number;
  /** true = fully rounded (99px), false = 4px corners. Default true. */
  rounded?: boolean;
  /** Controls padding and font size. */
  size?: 'xs' | 'sm' | 'md';
  /** Optional leading status dot. */
  dot?: { color: string; size?: number };
  onPress?: () => void;
}

const SIZE_PRESETS = {
  xs: { fontSize: 9, paddingH: 4, paddingV: 1 },
  sm: { fontSize: 10, paddingH: 8, paddingV: 2 },
  md: { fontSize: 10, paddingH: 8, paddingV: 3 },
} as const;

export function Pill({
  label,
  color = C.textTertiary,
  bg = 'transparent',
  borderColor = 'transparent',
  borderLeftColor,
  borderLeftWidth = 0,
  rounded = true,
  size = 'sm',
  dot,
  onPress,
}: PillProps) {
  const preset = SIZE_PRESETS[size];
  const borderRadius = rounded ? 99 : 4;

  const containerStyle = [
    styles.container,
    {
      backgroundColor: bg,
      borderColor,
      borderRadius,
      paddingHorizontal: preset.paddingH,
      paddingVertical: preset.paddingV,
    },
    borderLeftColor != null && {
      borderLeftColor,
      borderLeftWidth,
    },
  ];

  const textStyle = [
    styles.label,
    { color, fontSize: preset.fontSize },
  ];

  const dotSize = dot?.size ?? 5;

  const content = (
    <>
      {dot && (
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: dot.color,
            flexShrink: 0,
          }}
        />
      )}
      <Text style={textStyle}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={containerStyle}>
        {content}
      </Pressable>
    );
  }

  return <View style={containerStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: '600',
  },
});
