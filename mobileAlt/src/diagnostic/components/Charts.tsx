import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { DX, efficiencyArc, radarGeometry, type RadarIndices } from '@axiom/diagnostic-core';

const C = DX.color;

/** Same polygon geometry as the web report (packages/diagnostic-core/src/charts.ts). */
export function DiagnosticRadar({ lift, indices, size = 200 }: { lift: string; indices: RadarIndices; size?: number }) {
  const g = radarGeometry(lift, indices, size);
  if (!g) return null;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel="Strength profile">
      <Path d={g.ringPath} fill="none" stroke={C.border} strokeWidth={1} />
      {g.axes.map((a) => (
        <Line
          key={a.key}
          x1={g.center}
          y1={g.center}
          x2={a.end.x}
          y2={a.end.y}
          stroke={C.border}
          strokeWidth={1}
          strokeDasharray={a.value == null ? '3 3' : undefined}
        />
      ))}
      {g.valuePath ? <Path d={g.valuePath} fill="rgba(9,9,11,0.08)" stroke={C.ink} strokeWidth={1.5} /> : null}
      {g.axes.map((a) =>
        a.point ? <Circle key={`p-${a.key}`} cx={a.point.x} cy={a.point.y} r={3.5} fill={C.ink} /> : null,
      )}
      {g.axes.map((a) => (
        <SvgText
          key={`l-${a.key}`}
          x={a.labelAt.x}
          y={a.labelAt.y + 4}
          fontSize={11}
          fontWeight="600"
          fill={a.value == null ? C.disabled : C.muted}
          textAnchor={a.labelAt.anchor}
        >
          {a.label}
        </SvgText>
      ))}
    </Svg>
  );
}

export function EfficiencyGauge({ score, size = 160 }: { score: number; size?: number }) {
  const arc = efficiencyArc(score, size);
  return (
    <View style={{ width: size, alignItems: 'center' }} accessibilityLabel={`Efficiency ${score}`}>
      <Svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        <Path d={arc.trackPath} fill="none" stroke={C.surface} strokeWidth={10} strokeLinecap="round" />
        {arc.valuePath ? <Path d={arc.valuePath} fill="none" stroke={C.ink} strokeWidth={10} strokeLinecap="round" /> : null}
      </Svg>
      <Text style={styles.score}>{Math.round(score)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  score: { marginTop: -28, fontSize: 26, fontWeight: '700', letterSpacing: -0.9, color: C.ink },
});
