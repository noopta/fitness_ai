// The PR-led body block shared by the Hero (§3.1) and Hero+photo (§3.3) cards.
// PR-bearing sessions lead with the PR; PR-less sessions fall back to a date
// eyebrow + big title — never empty space. Then a Sets/Time stat row and the
// top exercises as hairline-divided rows.

import React from 'react';
import { View, Text } from 'react-native';
import { ShareableWorkout } from './types';
import { typeScale } from './tokens';
import { Eyebrow } from './parts';
import { formatDateEyebrow, formatDuration, joinCaption } from './format';

interface Props {
  p: (n: number) => number;
  data: ShareableWorkout;
  ink: string;        // primary text
  muted: string;      // secondary text
  success: string;    // PR accent
  hairline: string;   // divider color
  maxExercises?: number;
}

function Stat({ p, value, label, ink, muted }: {
  p: (n: number) => number; value: string; label: string; ink: string; muted: string;
}) {
  return (
    <View style={{ gap: p(3) }}>
      <Text style={{ color: ink, fontSize: p(typeScale.sectionNum), fontWeight: '700', letterSpacing: -p(typeScale.sectionNum) * 0.03, fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Eyebrow p={p} color={muted}>{label}</Eyebrow>
    </View>
  );
}

export function HeroBody({ p, data, ink, muted, success, hairline, maxExercises = 3 }: Props) {
  const { pr } = data;
  const exercises = data.exercises.slice(0, maxExercises);

  return (
    <View style={{ gap: p(20) }}>
      {/* Head — PR-led or title fallback */}
      {pr ? (
        <View style={{ gap: p(8) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: p(7) }}>
            <View style={{ width: p(9), height: p(9), borderRadius: p(9), backgroundColor: success }} />
            <Eyebrow p={p} color={success}>New personal record</Eyebrow>
          </View>
          <Text style={{ color: muted, fontSize: p(typeScale.liftName), fontWeight: '600', letterSpacing: -p(typeScale.liftName) * 0.02 }} numberOfLines={1}>
            {pr.lift} · {pr.metric}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={{ color: ink, fontSize: p(typeScale.prHero), fontWeight: '700', letterSpacing: -p(typeScale.prHero) * 0.04, fontVariant: ['tabular-nums'], lineHeight: p(typeScale.prHero) }}>
              {pr.value}
            </Text>
            <Text style={{ color: muted, fontSize: p(26), fontWeight: '700', marginLeft: p(6), marginBottom: p(8) }}>{pr.unit}</Text>
            <Text style={{ color: success, fontSize: p(22), fontWeight: '700', marginLeft: p(10), marginBottom: p(10), fontVariant: ['tabular-nums'] }}>{pr.delta}</Text>
          </View>
          <Text style={{ color: muted, fontSize: p(typeScale.body), fontWeight: '500', marginTop: p(2) }} numberOfLines={1}>
            {joinCaption(data.title, formatDateEyebrow(data.loggedAt))}
          </Text>
        </View>
      ) : (
        <View style={{ gap: p(8) }}>
          <Eyebrow p={p} color={muted}>{formatDateEyebrow(data.loggedAt)}</Eyebrow>
          <Text style={{ color: ink, fontSize: p(typeScale.titleHero), fontWeight: '700', letterSpacing: -p(typeScale.titleHero) * 0.035, lineHeight: p(typeScale.titleHero) * 1.02 }} numberOfLines={2}>
            {data.title}
          </Text>
        </View>
      )}

      {/* Stat row — Sets + Time (volume is never the lead) */}
      <View style={{ flexDirection: 'row', gap: p(40) }}>
        <Stat p={p} value={String(data.sets)} label="Sets" ink={ink} muted={muted} />
        <Stat p={p} value={formatDuration(data.durationMin)} label="Time" ink={ink} muted={muted} />
      </View>

      {/* Top exercises — hairline-divided rows */}
      {exercises.length > 0 ? (
        <View>
          {exercises.map((ex, i) => (
            <View
              key={`${ex.name}-${i}`}
              style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingVertical: p(9),
                borderTopWidth: p(1), borderTopColor: hairline,
              }}
            >
              <Text style={{ color: ink, fontSize: p(typeScale.exerciseName), fontWeight: '500', flex: 1, marginRight: p(10) }} numberOfLines={1}>
                {ex.name}
              </Text>
              <Text style={{ color: muted, fontSize: p(typeScale.exerciseSet), fontWeight: '600', fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {ex.detail}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
