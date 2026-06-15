import React from 'react';
import { View, Text } from 'react-native';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { scene } from './SceneStyles';
import { WASHES } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';

// Scene 01 — The Problem · Ember · scrim 0.78 (spec §10)
export function Scene01Problem({ stepLabel }: { stepLabel?: string }) {
  return (
    <Poster
      wash="Ember"
      photo={PHOTOS.gymOldschool}
      lx={0.50} ly={0.36}
      scrim={0.78}
      kicker="Axiom"
      slug={stepLabel ?? 'why most quit'}
    >
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: WASHES.Ember.accent }]} />
          <Text style={scene.eyebrowText}>The Problem</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={scene.headline}>Most people quit before it ever works.</Text>
      </Reveal>
      <Reveal index={2}>
        <Text style={scene.body}>
          Came to lose fat. Came to get strong. It doesn't matter — <Text style={{ color: '#fff', fontWeight: '700' }}>67% are gone in six months.</Text> The plan was never built for them.
        </Text>
      </Reveal>
      <Reveal index={3}>
        <Text style={scene.sourceNote}>Source · IHRSA Global Report, 2022</Text>
      </Reveal>
    </Poster>
  );
}
