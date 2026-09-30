// Card tokens (CHAT_CARDS_RN_SPEC §3–4). Inter throughout, tabular numerals.

import type { TextStyle } from 'react-native';
import { v2 } from '../../theme';

export const K = {
  ink: '#09090b',
  muted: '#71717a',
  faint: '#a1a1aa',
  hairline: '#e4e4e7',
  rowLine: '#f4f4f5',
  surface: '#f4f4f5',
  crimson: '#A51C30',
  dim: '#d4d4d8',
  restFill: '#fafafa',
  captureFill: '#18181b',
  /** Body opacity once acted on / replaced; Pro previews sit a little lower. */
  actedOpacity: 0.45,
  proOpacity: 0.4,
  fade: 300,
} as const;

const NUM: TextStyle = { fontVariant: ['tabular-nums'] };
const f = (family: string, size: number, lineHeight: number, color: string = K.ink, extra: TextStyle = {}): TextStyle => ({ fontFamily: family, fontSize: size, lineHeight, color, ...extra });

export const S = {
  meta: f(v2.font.regular, 13, 18, K.muted),
  open: f(v2.font.semibold, 13, 18, K.ink),
  heroValue: f(v2.font.bold, 44, 44, K.ink, { letterSpacing: -1.76, ...NUM }),
  heroUnit: f(v2.font.semibold, 17, 22, K.muted),
  heroDelta: f(v2.font.semibold, 15, 20, K.ink, NUM),
  rowKey: f(v2.font.medium, 15, 20, K.ink),
  rowSub: f(v2.font.regular, 12, 16, K.muted),
  rowValue: f(v2.font.semibold, 15, 20, K.ink, NUM),
  mark: f(v2.font.bold, 11, 14, K.crimson),
  changeKey: f(v2.font.regular, 13, 18, K.muted),
  changeFrom: f(v2.font.medium, 20, 26, K.faint, { textDecorationLine: 'line-through', ...NUM }),
  changeArrow: f(v2.font.regular, 17, 26, K.faint),
  changeTo: f(v2.font.bold, 20, 26, K.ink, NUM),
  diffKey: f(v2.font.regular, 13, 18, K.muted),
  diffFrom: f(v2.font.regular, 13, 18, K.faint, { textDecorationLine: 'line-through', ...NUM }),
  diffTo: f(v2.font.semibold, 15, 20, K.ink, NUM),
  note: f(v2.font.regular, 13, 19.5, K.muted),
  empty: f(v2.font.regular, 15, 22.5, K.ink),
  askQ: f(v2.font.semibold, 20, 26, K.ink, { letterSpacing: -0.2 }),
  option: f(v2.font.medium, 15, 20, K.ink),
  segment: f(v2.font.semibold, 13, 18, K.faint),
  draftTo: f(v2.font.semibold, 13, 18, K.ink),
  draftBody: f(v2.font.regular, 17, 25.5, K.ink),
  tileTitle: f(v2.font.semibold, 13, 18, K.ink),
  lose: f(v2.font.regular, 15, 21.75, K.ink),
  typed: f(v2.font.regular, 17, 22, K.ink, { letterSpacing: 1.4 }),
  handoff: f(v2.font.semibold, 15, 20, K.ink),
  primary: f(v2.font.semibold, 15, 20, K.crimson),
  secondary: f(v2.font.semibold, 13, 18, K.muted),
  stateLine: f(v2.font.semibold, 13, 18, K.ink),
  flowKey: f(v2.font.regular, 13, 18, K.muted),
  flowValue: f(v2.font.medium, 13, 18, K.ink),
  tileDay: f(v2.font.semibold, 11, 14, K.ink),
  tileName: f(v2.font.regular, 11, 14, K.ink),
  caption: f(v2.font.bold, 11, 14, K.faint, { letterSpacing: 1.32, textTransform: 'uppercase' }),
} satisfies Record<string, TextStyle>;
