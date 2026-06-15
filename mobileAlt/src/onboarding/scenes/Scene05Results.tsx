import React from 'react';
import { View, Text } from 'react-native';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { CountUp } from '../motion/CountUp';
import { scene } from './SceneStyles';
import { s } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';

// Scene 05 — The Results · Steel · scrim 0.84 (spec §10)
export function Scene05Results({ stepLabel }: { stepLabel?: string }) {
  return (
    <Poster
      wash="Steel"
      photo={PHOTOS.equipGymleco}
      lx={0.56} ly={0.42}
      scrim={0.84}
      slug={stepLabel ?? 'the results'}
    >
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: '#fff' }]} />
          <Text style={scene.eyebrowText}>Twelve Weeks In</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={[scene.headline, { fontSize: s(42), lineHeight: s(42) * 0.98 }]}>
          Stronger and leaner. Both.
        </Text>
      </Reveal>
      <Reveal index={2}>
        <View style={scene.twoCol}>
          {/* Strength column */}
          <View style={scene.colRoot}>
            <Text style={scene.colLabel}>Strength</Text>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={scene.bigStat}>+</Text>
                <CountUp to={47} decimals={0} style={scene.bigStat} />
                <Text style={scene.bigStat}> lb</Text>
              </View>
              <Text style={scene.caption}>across the three main lifts</Text>
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <CountUp to={3.1} decimals={1} style={scene.smallStat} />
                <Text style={scene.smallStat}>×</Text>
              </View>
              <Text style={scene.caption}>more consistent</Text>
            </View>
          </View>
          {/* Composition column */}
          <View style={scene.colRoot}>
            <Text style={scene.colLabel}>Composition</Text>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={scene.bigStat}>−</Text>
                <CountUp to={6} decimals={0} style={scene.bigStat} />
                <Text style={scene.bigStat}>%</Text>
              </View>
              <Text style={scene.caption}>body fat, muscle kept</Text>
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={scene.smallStat}>+</Text>
                <CountUp to={2} decimals={0} style={scene.smallStat} />
                <Text style={scene.smallStat}> lb</Text>
              </View>
              <Text style={scene.caption}>lean muscle gained</Text>
            </View>
          </View>
        </View>
      </Reveal>
      <Reveal index={3}>
        <Text style={scene.sourceNote}>
          Sample figures · 200+ members, first training cycle. Results vary.
        </Text>
      </Reveal>
    </Poster>
  );
}
