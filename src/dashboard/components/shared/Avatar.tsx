import React from 'react';
import { View, Text } from 'react-native';
import { avatarColor, initials } from '../../utils/avatar.js';
import { semantic } from '../../tokens.js';

interface AvatarProps {
  name: string;
  size?: number;
  rounded?: boolean; // true = full circle, false = rounded rect (default true)
  icon?: React.ReactNode; // render icon instead of initials
  bg?: string; // background color override
}

export function Avatar({ name, size = 32, rounded = true, icon, bg }: AvatarProps) {
  const backgroundColor = bg ?? avatarColor(name);
  const letters = initials(name);
  const radius = rounded ? size / 2 : Math.min(size / 4, 8);
  const fontSize = Math.max(Math.round(size * 0.35), 8);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon ?? (
        <Text style={{ fontSize, fontWeight: '700', color: semantic.text.inverse, fontFamily: 'Space Grotesk, sans-serif' }}>
          {letters}
        </Text>
      )}
    </View>
  );
}
