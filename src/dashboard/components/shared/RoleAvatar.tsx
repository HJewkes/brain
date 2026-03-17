import React from 'react';
import { User, Bot } from 'lucide-react';
import { Avatar } from './Avatar.js';
import { colors } from '../../tokens.js';

export function UserAvatar({ size = 16 }: { size?: number }) {
  return (
    <Avatar
      name="user"
      size={size}
      bg="rgba(20,50,90,0.35)"
      icon={<User size={size * 0.55} color={colors.textPrimary} />}
    />
  );
}

export function ClaudeAvatar({ size = 16 }: { size?: number }) {
  return (
    <Avatar
      name="claude"
      size={size}
      bg="#1a1400"
      icon={<Bot size={size * 0.55} color={colors.brand} />}
    />
  );
}
