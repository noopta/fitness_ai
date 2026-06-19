import React from 'react';
import { View, Text } from 'react-native';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { scene } from './SceneStyles';
import { s } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';

// Scene 04 — The Moat (form) · Ash · scrim 0.74 (spec §10)
export function Scene04Moat({ stepLabel }: { stepLabel?: string }) {
  return (
    <Poster
      wash="Ash"
      photo={PHOTOS.hypeDuo}
      lx={0.46} ly={0.36}
      scrim={0.74}
      slug={stepLabel ?? 'the moat'}
    >
      <Reveal index={0}>
        <View style={scene.chipRow}>
          <View style={scene.chip}><Text style={scene.chipText}>Cutting → protects strength</Text></View>
          <View style={scene.chip}><Text style={scene.chipText}>Bulking → clean gains</Text></View>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={[scene.headline, { fontSize: s(40), lineHeight: s(40) * 0.98 }]}>
          An AI coach that adapts to your goal, and watches every rep.
        </Text>
      </Reveal>
      <Reveal index={2}>
        <Text style={scene.body}>
          Upload a clip. Get the cue a $200-a-session coach would give, in ninety seconds. Whether you're chasing a number or a lower body-fat, it adjusts the plan to you.
        </Text>
      </Reveal>
    </Poster>
  );
}
