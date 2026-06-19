import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { CountUp } from '../motion/CountUp';
import { scene } from './SceneStyles';
import { s, WASHES } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';

// Scene 06 — The AI Agent · Ember · scrim 0.90 — the differentiator (spec §10)
export function Scene06Agent({ stepLabel }: { stepLabel?: string }) {
  return (
    <Poster
      wash="Ember"
      photo={PHOTOS.physiqueBack}
      lx={0.50} ly={0.28}
      scrim={0.90}
      slug={stepLabel ?? 'the intelligence'}
    >
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: WASHES.Ember.accent }]} />
          <Text style={scene.eyebrowText}>The World's First</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={[scene.headline, { fontSize: s(33), lineHeight: s(33) * 1.02 }]}>
          It connects every plate you eat to every plate you lift.
        </Text>
      </Reveal>
      <Reveal index={2}>
        <Text style={[scene.body, { fontSize: 13.5, marginTop: s(13) }]}>
          Your food logs become mood, sleep, focus, and output. Every rep, set, and pound becomes a living strength profile, so a weak link gets caught{' '}
          <Text style={{ color: '#fff', fontWeight: '700' }}>before it ever becomes a plateau.</Text>
        </Text>
      </Reveal>
      <Reveal index={3}>
        <View style={scene.synthPanel}>
          <Text style={scene.synthLabel}>Every Signal · One Engine</Text>
          <View style={scene.signalChipRow}>
            {['Nutrition', 'Sleep', 'Mood', 'Focus', 'Reps', 'Sets', 'Load'].map((label) => (
              <View key={label} style={scene.signalChip}>
                <View style={scene.signalDot} />
                <Text style={scene.signalChipText}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={{ alignItems: 'center', paddingVertical: 4 }}>
            <Ionicons name="arrow-down" size={18} color={WASHES.Ember.accent} />
          </View>
          <View style={scene.resultInset}>
            <View style={scene.resultRow}>
              <Text style={scene.resultTitle}>Your strength profile</Text>
              <View style={scene.livePill}>
                <View style={scene.liveDot} />
                <Text style={scene.liveLabel}>LIVE</Text>
              </View>
            </View>
            <View style={scene.alertRow}>
              <View style={scene.amberDot} />
              <Text style={scene.alertText}>
                Posterior chain lagging: <Text style={{ color: '#fff', fontWeight: '700' }}>3 targeted sessions queued.</Text>
              </Text>
            </View>
          </View>
        </View>
      </Reveal>
      <Reveal index={4}>
        <View style={{ marginTop: s(15), flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <CountUp to={3.4} decimals={1} style={scene.statNumber} />
          <Text style={scene.statNumber}>×</Text>
          <Text style={{ flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 12.5 }}>
            longer before a plateau, training to your live profile vs. a static plan.
          </Text>
        </View>
      </Reveal>
      <Reveal index={5}>
        <Text style={scene.sourceNote}>
          Sample figures · 200+ members, first training cycle. Results vary.
        </Text>
      </Reveal>
    </Poster>
  );
}
