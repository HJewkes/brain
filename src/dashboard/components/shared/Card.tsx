import React from 'react';
import { View } from 'react-native';
import { colors } from '../../tokens.js';

export interface CardProps {
  children: React.ReactNode;
  variant?: 'plain' | 'accent' | 'subtle';
  accentColor?: string;
  accentWidth?: number;
  borderColor?: string;
  bg?: string;
  padding?: number;
  radius?: number;
}

export function Card({
  children,
  variant = 'plain',
  accentColor,
  accentWidth = 3,
  borderColor,
  bg,
  padding = 10,
  radius = 8,
}: CardProps) {
  const resolvedBorder = borderColor ?? colors.border;

  const baseStyle = {
    borderRadius: radius,
    padding,
    borderWidth: 1,
    borderColor: resolvedBorder,
  };

  if (variant === 'accent') {
    const accent = accentColor ?? colors.brand;
    return (
      <View
        style={{
          ...baseStyle,
          backgroundColor: bg ?? colors.surface2,
          borderLeftWidth: accentWidth,
          borderLeftColor: accent,
        }}
      >
        {children}
      </View>
    );
  }

  if (variant === 'subtle') {
    const accent = accentColor ?? colors.brand;
    return (
      <View
        style={{
          ...baseStyle,
          backgroundColor: bg ?? 'rgba(255,255,255,0.03)',
          borderColor: borderColor ?? `${accent}40`,
        }}
      >
        {children}
      </View>
    );
  }

  // plain
  return (
    <View
      style={{
        ...baseStyle,
        backgroundColor: bg ?? colors.surface2,
      }}
    >
      {children}
    </View>
  );
}
