// Account (design handoff "remaining agentic capabilities", Area 4).
//
// A-01 Account — You → Account. Everything that was chat-only gets a row:
//   photo, name, username, email; food region and "add workout calories
//   back"; terms and privacy, the version; switch to classic; and Delete
//   account, always the last row (App Store guideline 5.1.1(v): deletion is
//   three taps from You).
// A-02 Profile photo — the system picker with its square crop; the circle
//   on the page is what others see.
// A-03 Delete account — a native confirm page: what's deleted (with counts),
//   what happens to billing, an export first. Typing DELETE arms it; no Undo.
//   Web (Stripe) subscriptions are cancelled by the server on delete; App
//   Store / Google Play ones can't be, so the page says to cancel there.
// A-04 Switch to classic — a sheet: same account, same data, only the
//   layout changes. Per phone; classic's Settings has "Try the new Axiom".

import React, { useState } from 'react';
import { View, Text, TextInput, Image, Switch, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { Sheet, PromptSheet } from '../../primitives/Sheet';
import { useAuth } from '../../../context/AuthContext';
import { authApi, apiFetch } from '../../../lib/api';
import { setPreferClassic } from '../../crashGuard';
import { haptics } from '../../haptics';

const FOOD_REGIONS = [
  { value: 'global', label: 'Global', sub: 'USDA database, US portion sizes' },
  { value: 'ng', label: 'Nigeria', sub: 'Jollof, egusi, eba, moi moi, suya — local portions' },
  { value: 'gm', label: 'The Gambia', sub: 'Benachin, domoda, superkanja — local portions' },
  { value: 'wa', label: 'West Africa', sub: 'Shared West African dishes' },
] as const;

function versionLabel(): string {
  const v = Constants.expoConfig?.version ?? '';
  const build = (Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '') as string | number;
  const update = Updates.updateId ? ` · ${String(Updates.updateId).slice(0, 8)}` : '';
  return `${v}${build ? ` (${build})` : ''}${update}`;
}

export function AccountPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const u: any = user ?? {};
  const [editing, setEditing] = useState<null | 'name' | 'username'>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [classicOpen, setClassicOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [burn, setBurn] = useState<boolean>(!!u.subtractWorkoutBurnFromCalories);
  const region = FOOD_REGIONS.find((r) => r.value === (u.foodRegion ?? 'global')) ?? FOOD_REGIONS[0];

  const changePhoto = async () => {
    const pick = async (camera: boolean) => {
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true };
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', camera ? 'Allow camera access in Settings to take a photo.' : 'Allow photo access in Settings to choose one.'); return; }
      const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      const a = r.canceled ? null : r.assets?.[0];
      if (!a?.base64) return;
      setPhotoBusy(true);
      try { await authApi.setAvatar(`data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}`); await refreshUser(); haptics.success(); }
      catch (e: any) { Alert.alert('Couldn\'t update the photo', e?.message ?? 'Try again.'); }
      setPhotoBusy(false);
    };
    Alert.alert('Change photo', undefined, [
      { text: 'Choose from library', onPress: () => void pick(false) },
      { text: 'Take a photo', onPress: () => void pick(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const saveName = async (name: string) => {
    try { await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify({ name }) }); await refreshUser(); setEditing(null); }
    catch (e: any) { Alert.alert('Couldn\'t save the name', e?.message ?? 'Try again.'); }
  };
  const saveUsername = async (raw: string) => {
    const name = raw.replace(/^@/, '').trim().toLowerCase();
    try {
      const c: any = await authApi.checkUsername(name);
      if (c && c.available === false) {
        const alt: string[] = c.suggestions ?? c.alternatives ?? [];
        Alert.alert('That username is taken', alt.length ? `Try ${alt.slice(0, 3).map((a) => `@${a}`).join(', ')}.` : 'Try another.');
        return;
      }
      await authApi.setUsername(name); await refreshUser(); setEditing(null);
    } catch (e: any) { Alert.alert('Couldn\'t save the username', e?.message ?? 'Try again.'); }
  };
  const setRegion = async (value: string) => {
    setRegionOpen(false);
    try { await authApi.updateProfile({ foodRegion: value as any }); await refreshUser(); } catch (e: any) { Alert.alert('Couldn\'t change the region', e?.message ?? ''); }
  };
  const toggleBurn = async (on: boolean) => {
    setBurn(on);
    try { await authApi.updateProfile({ subtractWorkoutBurnFromCalories: on }); await refreshUser(); }
    catch (e: any) { setBurn(!on); Alert.alert('Couldn\'t change that', e?.message ?? ''); }
  };
  const switchToClassic = async () => {
    setClassicOpen(false);
    await setPreferClassic(true);
    router.replace('/(tabs)' as any);
  };

  return (
    <PushedPage back="You" title="Account">
      <View style={styles.photoBlock}>
        <Pressable onPress={() => void changePhoto()} accessibilityRole="button" accessibilityLabel="Change photo" hitSlop={8}>
          {u.avatarBase64 ? <Image source={{ uri: u.avatarBase64.startsWith('data:') ? u.avatarBase64 : `data:image/jpeg;base64,${u.avatarBase64}` }} style={styles.avatar} />
            : <View style={[styles.avatar, { backgroundColor: v2.color.surface }]} />}
        </Pressable>
        <TextAction muted arrow={false} size={13} onPress={() => void changePhoto()} loading={photoBusy}>Change photo</TextAction>
      </View>

      <Eyebrow>Account</Eyebrow>
      <Row name="Name" value={u.name || 'Add'} onPress={() => setEditing('name')} />
      <Row name="Username" value={u.username ? `@${u.username}` : 'Add'} onPress={() => setEditing('username')} />
      <Row name="Email" value={u.email ?? ''} muted last />

      <View style={{ marginTop: 26 }}><Eyebrow>Preferences</Eyebrow></View>
      <Row name="Food region" value={region.label} onPress={() => setRegionOpen(true)} />
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={T.rowStrong}>Add workout calories back</Text>
          <Text style={T.caption}>A session's burn raises that day's target</Text>
        </View>
        <Switch value={burn} onValueChange={(on) => void toggleBurn(on)} trackColor={{ true: v2.color.ink }} accessibilityLabel="Add workout calories back" />
      </View>

      <View style={{ marginTop: 26 }}><Eyebrow>About</Eyebrow></View>
      <Row name="Terms · Privacy" onPress={() => Alert.alert('Terms and privacy', undefined, [
        { text: 'Terms of use', onPress: () => void WebBrowser.openBrowserAsync('https://axiomtraining.io/terms') },
        { text: 'Privacy policy', onPress: () => void WebBrowser.openBrowserAsync('https://axiomtraining.io/privacy') },
        { text: 'Cancel', style: 'cancel' },
      ])} />
      <Row name="Version" value={versionLabel()} muted last />

      <View style={{ marginTop: 26 }}>
        <Row name="Switch to classic Axiom" onPress={() => setClassicOpen(true)} />
        <Row name="Delete account" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'deleteaccount' } } as any)} last />
      </View>

      <PromptSheet visible={editing === 'name'} title="Name" sub="Shown to friends and in groups." initial={u.name ?? ''} onSubmit={saveName} onClose={() => setEditing(null)} />
      <PromptSheet visible={editing === 'username'} title="Username" sub="Letters, numbers and underscores." initial={u.username ?? ''} placeholder="yourname" onSubmit={saveUsername} onClose={() => setEditing(null)} />

      <Sheet visible={regionOpen} onClose={() => setRegionOpen(false)} title="Food region" sub="Which foods and portions Anakin assumes when you describe a meal.">
        {FOOD_REGIONS.map((r, i) => <Row key={r.value} name={r.label} sub={r.sub} value={r.value === region.value ? '✓' : undefined} onPress={() => void setRegion(r.value)} last={i === FOOD_REGIONS.length - 1} />)}
      </Sheet>

      <Sheet visible={classicOpen} onClose={() => setClassicOpen(false)} title="Switch to classic Axiom?" sub="Same account, same data. Anakin moves to the Coach tab. You can switch back from Settings any time.">
        <Row name="Keeps" value="Program, logs, friends, Pro" muted />
        <Row name="Changes" value="Layout and navigation" muted last />
        <View style={styles.sheetActions}>
          <TextAction primary onPress={() => void switchToClassic()}>Switch to classic</TextAction>
          <TextAction muted arrow={false} onPress={() => setClassicOpen(false)}>Stay</TextAction>
        </View>
      </Sheet>
    </PushedPage>
  );
}

interface DeletionPreview {
  counts: { workouts: number; meals: number; weighIns: number; posts: number; messages: number; friends: number };
  billing: { pro: boolean; rail: 'stripe' | 'apple' | 'google' | 'none'; renewsOn: string | null; cancelledOnDelete: boolean };
}

const fmtDay = (d: string | null) => {
  if (!d) return null;
  const t = new Date(`${d}T12:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export function DeleteAccountPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['v2', 'deletion-preview'], queryFn: () => apiFetch('/auth/account/deletion-preview') as Promise<DeletionPreview>, staleTime: 0 });
  const c = q.data?.counts;
  const b = q.data?.billing;
  const armed = typed.trim().toUpperCase() === 'DELETE';

  const billingLine = !b || !b.pro ? null
    : b.rail === 'stripe' ? `Your Pro subscription is cancelled when you delete — you won't be charged again.`
    : b.rail === 'apple' ? `Pro is billed by Apple. Cancel it in the App Store${b.renewsOn ? ` before ${fmtDay(b.renewsOn)}` : ''} so you're not charged again — deleting here can't stop it.`
    : b.rail === 'google' ? `Pro is billed by Google Play. Cancel it in Play Store subscriptions so you're not charged again — deleting here can't stop it.`
    : null;

  const exportFirst = async () => {
    try { const r: any = await apiFetch('/auth/export-link'); if (r?.url) await WebBrowser.openBrowserAsync(r.url); }
    catch (e: any) { Alert.alert('Couldn\'t make the export', e?.message ?? 'Try again.'); }
  };
  const del = async () => {
    if (!armed || busy) return;
    setBusy(true);
    try {
      await apiFetch('/auth/account', { method: 'DELETE' });
      haptics.success();
      await logout();
    } catch (e: any) {
      Alert.alert('Couldn\'t delete the account', e?.message ?? 'Try again.');
      setBusy(false);
    }
  };

  return (
    <PushedPage back="Account" eyebrow="Delete account" title="This deletes everything. It can't be undone." loading={q.isLoading}
      error={q.isError ? 'Couldn\'t load what would be deleted.' : null} onRetry={() => void q.refetch()}>
      <Eyebrow>What's deleted</Eyebrow>
      <Row name="Every workout, meal and weigh-in" sub={c ? `${c.workouts.toLocaleString()} · ${c.meals.toLocaleString()} · ${c.weighIns.toLocaleString()}` : undefined} />
      <Row name="Your program and Anakin's notes" />
      <Row name="Friends, posts and messages" sub={c ? `${c.friends} friends · ${c.posts} posts · ${c.messages} messages` : undefined} last />

      {billingLine ? <Text style={[T.caption, { marginTop: 18 }]}>{billingLine}</Text> : null}
      <TextAction muted arrow={false} size={14} onPress={() => void exportFirst()} style={{ marginTop: 14 }}>Download my data first</TextAction>

      <Text style={[T.caption, { marginTop: 26 }]}>Type DELETE to confirm</Text>
      <TextInput value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" placeholderTextColor={v2.color.placeholder}
        style={styles.typed} accessibilityLabel="Type DELETE to confirm" />

      <View style={[styles.sheetActions, { marginTop: 26 }]}>
        <TextAction primary onPress={() => void del()} disabled={!armed} loading={busy}>Delete account</TextAction>
        <TextAction muted arrow={false} onPress={() => router.back()}>Keep my account</TextAction>
      </View>
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  photoBlock: { alignItems: 'center', gap: 10, marginBottom: 26 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: v2.color.hairline },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 22 },
  typed: { marginTop: 8, fontFamily: v2.font.semibold, fontSize: 20, letterSpacing: 2, color: v2.color.ink, borderBottomWidth: 1, borderBottomColor: v2.color.ink, paddingVertical: 6 },
});
