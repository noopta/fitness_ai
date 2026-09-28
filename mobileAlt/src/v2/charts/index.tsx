// Chart primitives — ink on hairlines. One scale, every label a value the
// chart reaches, clear of edges. Macro hues only in the ring's stroke.

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline, Line, Rect, Text as SvgText } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, useReducedMotion } from 'react-native-reanimated';
import { v2, T, type MacroKey } from '../theme';

/** Calorie ring with macro-hue segments. Segments share one circumference; the ring fills to kcal/target. */
export function Ring({ size = 128, stroke = 8, kcal, target, macros, children }: {
  size?: number; stroke?: number; kcal: number; target: number;
  macros: { key: MacroKey; grams: number }[];
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = target > 0 ? Math.min(1, kcal / target) : 0;
  const cal = macros.map((m) => ({ ...m, kcal: m.grams * (m.key === 'fat' ? 9 : 4) }));
  const sum = cal.reduce((s, m) => s + m.kcal, 0) || 1;
  let acc = 0;
  const arcs = cal.map((m) => {
    const len = C * frac * (m.kcal / sum);
    const a = { key: m.key, dash: `${len} ${C - len}`, offset: -acc };
    acc += len;
    return a;
  });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={v2.color.surface} strokeWidth={stroke} fill="none" />
        {arcs.map((a) => (
          <Circle key={a.key} cx={size / 2} cy={size / 2} r={r} stroke={v2.color.macro[a.key]} strokeWidth={stroke} fill="none"
            strokeDasharray={a.dash} strokeDashoffset={a.offset} strokeLinecap="butt" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        ))}
      </Svg>
      {children}
    </View>
  );
}

/** 2pt ink line, dashed grey forecast, end dot, one label. Draws in over 1.3s. */
export function LineForecast({ series, forecast, width = 346, height = 150, unitLabel, goalLabel }: {
  series: number[]; forecast?: { value: number; label: string } | null; width?: number; height?: number; unitLabel?: string; goalLabel?: string;
}) {
  const reduced = useReducedMotion();
  const prog = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { prog.value = withDelay(120, withTiming(1, { duration: 1300, easing: v2.motion.easeEnter })); }, [prog]);
  const all = [...series, ...(forecast ? [forecast.value] : [])];
  const min = Math.min(...all), max = Math.max(...all);
  const span = Math.max(1, max - min);
  const pad = 14;
  const n = series.length;
  const totalPts = n + (forecast ? 1 : 0);
  const X = (i: number) => (totalPts > 1 ? (i / (totalPts - 1)) * (width - 2) + 1 : width / 2);
  const Y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2 - 16);
  const pts = series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const last = n ? { x: X(n - 1), y: Y(series[n - 1]) } : null;
  const fc = forecast && last ? `${last.x.toFixed(1)},${last.y.toFixed(1)} ${X(totalPts - 1).toFixed(1)},${Y(forecast.value).toFixed(1)}` : null;
  const mask = useAnimatedStyle(() => ({ width: prog.value * width }));
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={v2.color.hairline} />
        <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={v2.color.surface} />
        <Line x1={0} y1={0.5} x2={width} y2={0.5} stroke={v2.color.surface} />
        {fc ? <Polyline points={fc} fill="none" stroke={v2.color.placeholder} strokeWidth={2} strokeDasharray="3 4" /> : null}
        {forecast ? <SvgText x={width} y={Math.max(12, Y(forecast.value) - 8)} textAnchor="end" fontSize={11} fill={v2.color.muted} fontFamily={v2.font.regular}>{goalLabel ?? `${forecast.value}${unitLabel ? ` ${unitLabel}` : ''} · ${forecast.label}`}</SvgText> : null}
      </Svg>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, height, overflow: 'hidden' }, mask]}>
        <Svg width={width} height={height}>
          {n > 1 ? <Polyline points={pts} fill="none" stroke={v2.color.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {last ? <Circle cx={last.x} cy={last.y} r={4} fill={v2.color.ink} /> : null}
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Ratio band: 2pt track, 8pt target band, 10pt dot — ink when out of band, grey inside. */
export function RatioBand({ lo, hi, value, width = 346 }: { lo: number; hi: number; value: number | null; width?: number }) {
  const w = hi - lo;
  const mn = lo - w * 1.5, mx = hi + w * 1.5;
  const f = (x: number) => Math.max(2, Math.min(98, ((x - mn) / (mx - mn)) * 100));
  const out = value != null && (value < lo || value > hi);
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { p.value = withDelay(80, withTiming(1, { duration: 600, easing: v2.motion.easeEnter })); }, [p]);
  const dot = useAnimatedStyle(() => ({ left: `${value == null ? 50 : 50 + (f(value) - 50) * p.value}%` }));
  return (
    <View style={{ width, height: 12, justifyContent: 'center', marginTop: 10 }}>
      <View style={{ position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: v2.color.surface }} />
      <View style={{ position: 'absolute', left: `${f(lo)}%`, width: `${f(hi) - f(lo)}%`, height: 8, backgroundColor: v2.color.hairline }} />
      {value != null ? <Animated.View style={[{ position: 'absolute', width: 10, height: 10, borderRadius: 5, marginLeft: -5, backgroundColor: out ? v2.color.ink : v2.color.placeholder }, dot]} /> : null}
    </View>
  );
}

/** Coverage fill: 2pt ink bar to pct/100 (capped), grey when covered. */
export function CoverageBar({ pct, width = 346, covered }: { pct: number; width?: number; covered?: boolean }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { p.value = withDelay(60, withTiming(1, { duration: 600, easing: v2.motion.easeEnter })); }, [p]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.min(100, pct) * p.value}%` }));
  return (
    <View style={{ width, height: 2, backgroundColor: v2.color.surface, marginTop: 10 }}>
      <Animated.View style={[{ height: 2, backgroundColor: covered ? v2.color.placeholder : v2.color.ink }, fill]} />
    </View>
  );
}

/** 7-day bars; today in grey. */
export function WeekBars({ values, max, labels, todayIndex, height = 96 }: { values: number[]; max: number; labels: string[]; todayIndex?: number; height?: number }) {
  const reduced = useReducedMotion();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height }}>
        {values.map((v, i) => <Bar key={i} h={max > 0 ? Math.min(1, v / max) * height : 0} delay={i * 60} grey={i === todayIndex} reduced={reduced} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {labels.map((l, i) => <Text key={i} style={[T.caption, { flex: 1, textAlign: 'center', color: i === todayIndex ? v2.color.ink : v2.color.placeholder }]}>{l}</Text>)}
      </View>
    </View>
  );
}
function Bar({ h, delay, grey, reduced }: { h: number; delay: number; grey: boolean; reduced: boolean }) {
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { p.value = withDelay(delay, withTiming(1, { duration: 500, easing: v2.motion.easeEnter })); }, [p, delay]);
  const s = useAnimatedStyle(() => ({ height: Math.max(2, h * p.value) }));
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', height: '100%' }}>
      <Animated.View style={[{ backgroundColor: grey ? v2.color.placeholder : v2.color.ink, borderRadius: 1 }, s]} />
    </View>
  );
}

/** Thin progress hairline (set progress, rest drain, program progress) — crimson fill. */
export function ProgressHairline({ fraction, crimson = true, height = 2, track = true }: { fraction: number; crimson?: boolean; height?: number; track?: boolean }) {
  return (
    <View style={{ height, backgroundColor: track ? v2.color.hairline : 'transparent', width: '100%' }}>
      <View style={{ height, width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, backgroundColor: crimson ? v2.color.crimson : v2.color.ink }} />
    </View>
  );
}

/** Small radar for the systems / strength pages (hairline rings, ink polygon, crimson dots when out of band). */
export function Radar({ axes, band, size = 320 }: { axes: { t: string; v: string; r: number; hot?: boolean }[]; band?: [number, number]; size?: number }) {
  const C = size / 2, Rr = size * 0.3, n = axes.length;
  const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [C + Math.cos(a) * r, C + Math.sin(a) * r]; };
  const poly = (r: number) => axes.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = axes.map((a, i) => pt(i, Math.max(0.05, a.r) * Rr).map((v) => v.toFixed(1)).join(',')).join(' ');
  return (
    <Svg width={size} height={size * 0.85} viewBox={`0 0 ${size} ${size * 0.85}`}>
      {band ? <Polyline points={poly(band[1] * Rr)} fill={v2.color.surface} stroke="none" /> : null}
      {band ? <Polyline points={poly(band[0] * Rr)} fill={v2.color.white} stroke="none" /> : null}
      {[0.33, 0.66, 1].map((k) => <Polyline key={k} points={poly(k * Rr)} fill="none" stroke={v2.color.hairline} strokeWidth={1} />)}
      {axes.map((_, i) => { const [x, y] = pt(i, Rr); return <Line key={i} x1={C} y1={C} x2={x} y2={y} stroke={v2.color.hairline} />; })}
      <Polyline points={shape} fill="rgba(9,9,11,.06)" stroke={v2.color.ink} strokeWidth={1.5} strokeLinejoin="round" />
      {axes.map((a, i) => { const [x, y] = pt(i, Math.max(0.05, a.r) * Rr); return <Circle key={i} cx={x} cy={y} r={a.hot ? 4.5 : 3} fill={a.hot ? v2.color.crimson : v2.color.ink} />; })}
      {axes.map((a, i) => {
        const [x, y] = pt(i, Rr + 22);
        const an = Math.abs(x - C) < 8 ? 'middle' : x < C ? 'end' : 'start';
        const top = y < C - 40;
        return (
          <React.Fragment key={`l${i}`}>
            <SvgText x={x} y={top ? y - 10 : y + 4} textAnchor={an} fontSize={11} fill={v2.color.muted} fontFamily={v2.font.regular}>{a.t}</SvgText>
            <SvgText x={x} y={top ? y + 6 : y + 20} textAnchor={an} fontSize={12} fontWeight="700" fill={a.hot ? v2.color.crimson : v2.color.ink} fontFamily={v2.font.bold}>{a.v}</SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export const chartStyles = StyleSheet.create({ axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 } });
export { Rect };
