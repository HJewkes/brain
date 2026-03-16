import type { TextStyle } from 'react-native';
import { C } from '../shared/colors.js';

export const widgetLabel: TextStyle = {
  fontFamily: 'Space Grotesk',
  fontSize: 9,
  fontWeight: '700',
  color: C.textTertiary,
  textTransform: 'uppercase',
  letterSpacing: 0.7,
  marginBottom: 6,
};

export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
