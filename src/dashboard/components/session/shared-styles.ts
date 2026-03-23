import type { TextStyle } from 'react-native';
import { C } from '../shared/colors.js';

export const widgetLabel: TextStyle = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 9,
  fontWeight: '700',
  color: C.textTertiary,
  textTransform: 'uppercase',
  letterSpacing: 0.72,
  marginBottom: 6,
};

/** Section header used by .sb-section h3 (Tool Breakdown, Errors) */
export const sectionH3: TextStyle = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 10,
  fontWeight: '700',
  color: C.textTertiary,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: 10,
};

export { formatTimeShort } from '../../utils/formatting.js';
