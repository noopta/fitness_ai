import React from 'react';
import { View, Text } from 'react-native';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { CountUp } from '../motion/CountUp';
import { scene } from './SceneStyles';
import { s } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';

// Scene 02 — The False Choice · Ember · scrim 0.78 (spec §10)
export function Scene02FalseChoice({ stepLabel }: { stepLabel?: string }) {
  return (
    <Poster
      wash="Ember"
      photo={PHOTOS.nutrition}
      lx={0.55} ly={0.42}
      scrim={0.78}
      slug={stepLabel ?? 'the false choice'}
    >
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: '#fff' }]} />
          <Text style={scene.eyebrowText}>The False Choice</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={[scene.headline, { fontSize: s(38), lineHeight: s(38) * 0.98 }]}>
          Lose fat, <Text style={{ color: 'rgba(255,255,255,0.5)' }}>or</Text> build muscle. You've been told to pick.
        </Text>
      </Reveal>
      <Reveal index={2}>
        <Text style={scene.body}>
          You don't have to choose. Trained right, your body does both at once. It's called{' '}
          <Text style={{ color: '#fff', fontWeight: '700' }}>recomposition.</Text>
        </Text>
      </Reveal>
      <Reveal index={3}>
        <View style={scene.statPair}>
          <View style={scene.statCol}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={scene.statNumber}>+</Text>
              <CountUp to={2.6} decimals={1} style={scene.statNumber} />
            </View>
            <Text style={scene.statLabel}>lb lean</Text>
            <Text style={scene.statCaption}>muscle gained</Text>
          </View>
          <View style={scene.statDivider} />
          <View style={scene.statCol}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              {/* U+2212 minus glyph, per spec */}
              <Text style={scene.statNumber}>−</Text>
              <CountUp to={10.6} decimals={1} style={scene.statNumber} />
            </View>
            <Text style={scene.statLabel}>lb fat</Text>
            <Text style={scene.statCaption}>lost in the same weeks</Text>
          </View>
        </View>
      </Reveal>
      <Reveal index={4}>
        <Text style={scene.sourceNote}>
          Longland et al. · Am. J. Clinical Nutrition, 2016 — one 4-week protocol.
        </Text>
      </Reveal>
    </Poster>
  );
}
