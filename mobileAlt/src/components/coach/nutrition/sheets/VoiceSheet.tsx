// VoiceSheet — record a voice note, transcribe, route into the Describe
// review flow. Spec: handoff §10.
//
// v1 placeholder. Real recording needs expo-av (not yet in the project)
// plus a transcription provider decision (in-house chat endpoint vs Apple
// Speech / Android SpeechRecognizer) — flagged as a NEEDS ANSWER item in
// the handoff (§13). Until that lands, this sheet surfaces the path so
// the dock button has a destination and we know users are looking for it.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Hand off to DescribeSheet with the transcribed text pre-filled. */
  onUseDescribe?: () => void;
}

export function VoiceSheet({ visible, onClose, onUseDescribe }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Voice logging">
      <View style={styles.body}>
        <View style={styles.micCircle}>
          <Ionicons name="mic-outline" size={36} color={colors.foreground} />
        </View>
        <Text style={styles.heading}>Coming soon</Text>
        <Text style={styles.subtitle}>
          Anakin will take voice notes here. Until then, the Describe flow does the
          same thing with text — same parser, same review screen.
        </Text>
        {onUseDescribe ? (
          <TouchableOpacity
            style={styles.primary}
            onPress={() => { onClose(); onUseDescribe(); }}
            accessibilityRole="button"
            accessibilityLabel="Use describe instead"
          >
            <Text style={styles.primaryText}>Use Describe instead</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: 16, gap: 12 },
  micCircle: {
    width: 88, height: 88, borderRadius: 999,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  heading: { fontSize: 16, fontWeight: fontWeight.bold, color: colors.foreground },
  subtitle: {
    fontSize: 12.5, color: colors.mutedForeground, textAlign: 'center',
    lineHeight: 18, maxWidth: 280,
  },
  primary: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  primaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: fontWeight.bold },
});
