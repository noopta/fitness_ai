import { StyleSheet, Platform } from 'react-native';
import { s, TYPE } from '../theme';

// Shared scene-content styles. Every scene composes from this table so the
// per-scene component file only carries copy + Reveal indices, not styling.
// This keeps the spec's §10 table mappable line-by-line to the components.
const mono = Platform.select({ ios: TYPE.mono, default: 'monospace' });

export const scene = StyleSheet.create({
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(14),
  },
  eyebrowTick: {
    width: 20, height: 2, borderRadius: 1,
  },
  eyebrowText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: TYPE.eyebrow,
    fontWeight: '700',
    letterSpacing: 2.2,        // ~0.20em
    fontFamily: mono,
    textTransform: 'uppercase',
  },
  headline: {
    color: '#ffffff',
    fontSize: s(46),                  // default; per-scene overrides via `fontSize` inline
    fontWeight: '800',
    letterSpacing: -1.6,               // ~-0.035em on 46pt
    lineHeight: s(46) * 0.98,
  },
  body: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 14.5,
    lineHeight: 14.5 * 1.5,
    marginTop: s(16),
  },
  sourceNote: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: TYPE.sourceNote,
    lineHeight: TYPE.sourceNote * 1.45,
    fontFamily: mono,
    marginTop: s(14),
  },
  // Hero-number row (scene 3)
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: s(6), marginBottom: s(2) },
  heroPlus: { color: 'rgba(255,255,255,0.55)', fontSize: 30, fontWeight: '700' },
  // lineHeight must be >= fontSize or iOS clips the tops/bottoms of these big
  // digits (the reported "+32% cut off"). 0.82x was clipping; pin to 1.0x.
  heroDigits: { color: '#ffffff', fontSize: s(96), fontWeight: '800', letterSpacing: -4.8, lineHeight: s(96), includeFontPadding: false },
  heroPct: { color: 'rgba(255,255,255,0.55)', fontSize: 40, fontWeight: '800' },
  // Stat pair (scene 2)
  statPair: { flexDirection: 'row', alignItems: 'flex-start', gap: s(16), marginTop: s(18) },
  statCol: { flex: 1, gap: 4 },
  statDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)' },
  statNumber: { color: '#ffffff', fontSize: TYPE.statNumber, fontWeight: '800', letterSpacing: -1, lineHeight: TYPE.statNumber },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5 },
  statCaption: { color: 'rgba(255,255,255,0.55)', fontSize: 11.5 },
  // Chip pills (scene 4)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: s(16) },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)',
  },
  chipText: { color: '#ffffff', fontSize: 11.5, fontWeight: '600' },
  // Two-column results (scene 5)
  twoCol: { flexDirection: 'row', gap: s(18), marginTop: s(22) },
  colRoot: { flex: 1, gap: s(10) },
  colLabel: {
    color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
    paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.22)',
  },
  bigStat: { color: '#ffffff', fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  smallStat: { color: '#ffffff', fontSize: 19, fontWeight: '800', letterSpacing: -0.4, marginTop: 6 },
  caption: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  // Synthesis panel (scene 6)
  synthPanel: {
    marginTop: s(16), padding: 13, paddingTop: 13, paddingBottom: 12,
    borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  synthLabel: {
    color: 'rgba(255,255,255,0.5)', fontSize: 9.5, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
    fontFamily: mono,
  },
  signalChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 8 },
  signalChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)',
  },
  signalDot: {
    width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.6)',
  },
  signalChipText: { color: '#ffffff', fontSize: 11.5, fontWeight: '600' },
  resultInset: {
    marginTop: 8, padding: 12, paddingVertical: 10, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { color: '#ffffff', fontSize: 12.5, fontWeight: '700' },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e',
    shadowColor: '#22c55e', shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
  },
  liveLabel: { color: '#ffffff', fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  amberDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#f59e0b' },
  alertText: { flex: 1, color: 'rgba(255,255,255,0.78)', fontSize: 11.5 },
});
