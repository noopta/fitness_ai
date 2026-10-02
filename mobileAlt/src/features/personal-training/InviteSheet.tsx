// Invite a client from the phone: create the link, then hand it to the OS
// share sheet or the clipboard. Rendered in a Modal-backed BottomSheet, which
// does not inherit keyboard avoidance, so the form sits in its own avoider.

import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { COPY, shortDate } from '@axiom/personal-training-core';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { MAX_FONT_SCALE } from './components';
import { useCreateInvite } from './hooks';

export function InviteSheet({ visible, onClose, practiceName }: { visible: boolean; onClose: () => void; practiceName: string }) {
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const invite = useCreateInvite();

  function close() {
    setEmail('');
    setCopied(false);
    invite.reset();
    onClose();
  }

  async function copy() {
    if (!invite.data) return;
    await Clipboard.setStringAsync(invite.data.link);
    setCopied(true);
  }

  return (
    <BottomSheet visible={visible} onClose={close} height="60%">
      <KeyboardAvoider style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.title}>{COPY.invite.title}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.text}>{COPY.invite.body}</Text>

        {invite.data ? (
          <View style={styles.stack}>
            <Text selectable maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.link}>{invite.data.link}</Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>
              {COPY.invite.expires(shortDate(new Date(invite.data.expiresAt)))}
            </Text>
            <Button fullWidth onPress={() => Share.share({ message: COPY.invite.shareMessage(practiceName, invite.data!.link) })}>
              {COPY.invite.share}
            </Button>
            <Button fullWidth variant="secondary" onPress={copy}>{copied ? COPY.invite.copied : COPY.invite.copy}</Button>
          </View>
        ) : (
          <View style={styles.stack}>
            <Input
              label={COPY.invite.emailLabel}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="client@example.com"
              error={invite.isError ? COPY.invite.failed : undefined}
            />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.invite.emailHint}</Text>
            <Button fullWidth loading={invite.isPending} onPress={() => invite.mutate(email.trim() || undefined)}>
              {COPY.invite.generate}
            </Button>
          </View>
        )}
      </KeyboardAvoider>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.sm },
  stack: { gap: spacing.md, marginTop: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground, letterSpacing: -0.2 },
  text: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  link: { fontSize: fontSize.sm, color: colors.foreground, padding: spacing.md, borderRadius: 12, backgroundColor: colors.muted },
  caption: { fontSize: 12, color: colors.mutedForeground },
});
