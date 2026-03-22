import React from 'react';
import { User, Bot } from 'lucide-react';
import { Avatar } from './Avatar.js';
import { colors, semantic } from '../../tokens.js';

export function UserAvatar({ size = 16 }: { size?: number }) {
  return (
    <Avatar
      name="user"
      size={size}
      bg={semantic.role.user.bg}
      icon={<User size={size * 0.55} color={colors.textPrimary} />}
    />
  );
}

export function ClaudeAvatar({ size = 16 }: { size?: number }) {
  return (
    <Avatar
      name="claude"
      size={size}
      bg={semantic.role.claude.bg}
      icon={<Bot size={size * 0.55} color={colors.brand} />}
    />
  );
}
