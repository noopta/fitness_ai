import React from 'react';
import { View, Text } from 'react-native';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { CountUp } from '../motion/CountUp';
import { scene } from './SceneStyles';
import { s } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';

// Scene 03 — The Evidence · Steel · scrim 0.74 (spec §10)
export function Scene03Evidence({ stepLabel }: { stepLabel?: string }) {
  return (
    <Poster
      wash="Steel"
      photo={PHOTOS.coachSquat}
      lx={0.45} ly={0.34}
      scrim={0.74}
      slug={stepLabel ?? 'the evidence'}
    >
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: '#fff' }]} />
          <Text style={scene.eyebrowText}>The Evidence</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <View style={scene.heroRow}>
          <Text style={scene.heroPlus}>+</Text>
          <CountUp to={32} decimals={0} style={scene.heroDigits} />
          <Text style={scene.heroPct}>%</Text>
        </View>
      </Reveal>
      <Reveal index={2}>
        <Text style={[scene.headline, { fontSize: s(30), lineHeight: s(30) * 1.06, marginTop: s(14) }]}>
          more strength under coaching, and the muscle survives the cut.
        </Text>
      </Reveal>
      <Reveal index={3}>
        <Text style={[scene.body, { fontSize: 13.5 }]}>
          Same effort, same twelve weeks. Supervised lifters gain a third more strength, and resistance training is what keeps muscle on while you're losing fat.
        </Text>
      </Reveal>
      <Reveal index={4}>
        <Text style={scene.sourceNote}>
          Mazzetti et al. · Med. & Science in Sports & Exercise, 2000
        </Text>
      </Reveal>
    </Poster>
  );
}
