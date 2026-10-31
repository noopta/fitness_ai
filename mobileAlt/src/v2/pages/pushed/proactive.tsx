// Proactive coach pages (design v3): Working on (C1–C3), a thread (C2),
// Check-ins (F1), Who runs your program (B9), and What Anakin knows with its
// Photos tab (F2). All PushedPage: eyebrow · title · Anakin's read · rows ·
// one crimson CTA · foot actions.

import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { FREQUENCY_ROWS, quietHoursLabel, groupPhotos, PHOTO_KIND_LABEL, type Frequency } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage, AnakinRead } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { Pressable } from '../../primitives/Pressable';
import { Sheet } from '../../primitives/Sheet';
import { useThreads, useThreadDetail, useCheckinPrefs, useChatPhotos, useMemory, usePhotoUrl } from '../../data';
import { proactiveApi, type ProactivePrefs } from '../../api';
import { useShellOptional } from '../../shell/ShellContext';
import { haptics } from '../../haptics';

const go = (router: ReturnType<typeof useRouter>, key: string) => router.push({ pathname: '/(v2)/p/[key]', params: { key } } as any);

// ── C1 · Working on ─────────────────────────────────────────────────────────

export function WorkingOnPage() {
  const q = useThreads();
  const router = useRouter();
  const shell = useShellOptional();
  const open = q.data?.open ?? [], closed = q.data?.closed ?? [];
  const empty = q.data && !open.length && !closed.length;
  return (
    <PushedPage back="You" meta={q.data ? `${open.length} open` : null} title="Working on"
      lead={empty ? 'Nothing open. When you mention a goal, a niggle, or something you want to try, I’ll keep track of it here and check back.' : 'What I’m keeping track of for you. Tap one to correct it or close it.'}
      loading={q.isLoading} error={q.isError ? 'Couldn’t load what Anakin is working on.' : null} onRetry={() => void q.refetch()} refreshing={q.isFetching && !q.isLoading} onRefresh={() => void q.refetch()}>
      {empty ? (
        <View>
          <Eyebrow>Example</Eyebrow>
          <View style={{ opacity: 0.4, marginTop: 4 }}><Row name="“My knee’s been clicking on squats”" sub="Symptom · watching" value="Nov 6" last /></View>
          <TextAction primary onPress={() => { haptics.select(); router.back(); shell?.ask?.('My knee has been clicking on squats.'); }} style={{ marginTop: 24 }}>Tell Anakin</TextAction>
        </View>
      ) : null}
      {open.length ? <Eyebrow>Open</Eyebrow> : null}
      {open.map((r, i) => <Row key={r.id} name={r.title} sub={r.sub} value={r.value ?? undefined} bigValue={r.big} arrow={!r.value} onPress={() => go(router, `thread:${r.id}`)} last={i === open.length - 1} />)}
      {closed.length ? <Eyebrow style={{ marginTop: 30 }}>Closed</Eyebrow> : null}
      {closed.slice(0, 5).map((r, i) => <Row key={r.id} name={r.title} sub={r.sub} value={r.value ?? undefined} muted onPress={() => go(router, `thread:${r.id}`)} last={i === Math.min(closed.length, 5) - 1} />)}
      {closed.length > 5 ? <Text style={[T.caption, { marginTop: 10 }]}>{closed.length - 5} more</Text> : null}
    </PushedPage>
  );
}

// ── C2 · a thread ───────────────────────────────────────────────────────────

export function ThreadPage({ id }: { id: string }) {
  const q = useThreadDetail(id);
  const qc = useQueryClient();
  const router = useRouter();
  const t = q.data;
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['v2', 'proactive'] });
  const resolve = async () => { setBusy(true); try { await proactiveApi.threadResolve(id); await refresh(); router.back(); } catch (e: any) { Alert.alert('Couldn’t mark that', e?.message ?? ''); } finally { setBusy(false); } };
  const wrong = () => Alert.alert('That’s wrong?', 'This removes the thread and tells Anakin not to read it that way again.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void (async () => { try { await proactiveApi.threadWrong(id); await refresh(); router.back(); } catch (e: any) { Alert.alert('Couldn’t remove that', e?.message ?? ''); } })() },
  ]);
  const [editing, setEditing] = useState(false);
  const openStatus = t ? ['open', 'watching', 'running'].includes(t.status) : false;
  return (
    <PushedPage back="Working on" meta={t?.openedLabel ?? null} eyebrow={t ? `${t.kindLabel} · ${t.statusWord}` : null} title={t?.title ?? ''} lead={t?.read ?? undefined}
      loading={q.isLoading} error={q.isError ? 'Couldn’t load that thread.' : null} onRetry={() => void q.refetch()}
      cta={t && openStatus ? { label: 'Mark resolved', onPress: () => void resolve(), loading: busy } : null}
      foot={t ? [{ label: 'Edit', onPress: () => setEditing(true), muted: true }, { label: 'That’s wrong', onPress: wrong, muted: true }] : undefined}>
      {t?.sourceQuote ? (
        <View style={styles.quote}>
          <Text style={[T.readSm]}>“{t.sourceQuote}”</Text>
          {t.sourceLabel ? <Text style={[T.caption, { marginTop: 6 }]}>{t.sourceLabel}</Text> : null}
        </View>
      ) : null}
      {t ? (
        <View style={{ marginTop: 24 }}>
          {t.eventDate ? <Row name="Date" value={t.eventDate} /> : null}
          <Row name="Check back" value={t.checkBackLabel ?? '—'} />
          {t.affects.length ? <Row name="Affects" value={t.affects.join(', ')} /> : null}
          {t.resolution ? <Row name="Resolution" value={t.resolution} /> : null}
          <Row name="History" sub={t.history[0] ? `${t.history[0].label} · ${t.history[0].text}` : 'Opened from chat'} arrow={t.history.length > 1} onPress={t.history.length > 1 ? () => setEditing(false) : undefined} last />
          {t.history.length > 1 ? t.history.slice(1, 6).map((h, i) => <Row key={i} name={h.text} value={h.label} muted last={i === Math.min(t.history.length - 1, 5) - 1} />) : null}
        </View>
      ) : null}
      <EditThreadSheet visible={editing} onClose={() => setEditing(false)} thread={t ?? null} onSaved={() => void refresh()} />
    </PushedPage>
  );
}

function EditThreadSheet({ visible, onClose, thread, onSaved }: { visible: boolean; onClose: () => void; thread: { id: string; title: string; checkBackAt: string | null; eventDate: string | null } | null; onSaved: () => void }) {
  const shift = async (days: number) => {
    if (!thread) return;
    const base = thread.checkBackAt ?? new Date().toISOString().slice(0, 10);
    const d = new Date(Date.parse(`${base}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    try { await proactiveApi.threadEdit(thread.id, { checkBackAt: d }); onSaved(); onClose(); } catch (e: any) { Alert.alert('Couldn’t save that', e?.message ?? ''); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Edit" sub="Move the check-back, or tell Anakin the rest in chat.">
      <Row name="Check back a week later" onPress={() => void shift(7)} />
      <Row name="Check back tomorrow" onPress={() => void shift(1 - (thread?.checkBackAt ? Math.round((Date.parse(`${thread.checkBackAt}T12:00:00Z`) - Date.now()) / 86_400_000) : 0))} />
      <Row name="Anything else — tell Anakin" sub="“The elbow is the right one, not the left”" onPress={onClose} last />
    </Sheet>
  );
}

// ── F1 · Check-ins ──────────────────────────────────────────────────────────

export function CheckinsPage() {
  const q = useCheckinPrefs();
  const qc = useQueryClient();
  const router = useRouter();
  const p = q.data?.prefs;
  const [saving, setSaving] = useState<string | null>(null);
  const patch = async (key: string, body: Partial<ProactivePrefs>) => {
    setSaving(key);
    try { await proactiveApi.checkinsPatch(body); await qc.invalidateQueries({ queryKey: ['v2', 'proactive', 'checkins'] }); haptics.select(); }
    catch (e: any) { Alert.alert('Couldn’t save that', e?.message ?? ''); } finally { setSaving(null); }
  };
  const unmute = async (topic: string) => { try { await proactiveApi.unmute(topic); await qc.invalidateQueries({ queryKey: ['v2', 'proactive', 'checkins'] }); } catch (e: any) { Alert.alert('Couldn’t unmute that', e?.message ?? ''); } };
  const quiet = (start: number, end: number) => void patch('quiet', { quietStart: start, quietEnd: end });
  const [timeSheet, setTimeSheet] = useState(false);
  const TIMES = ['06:00', '07:00', '09:00', '12:00', '17:00', '18:00', '19:00', '20:00'];
  return (
    <PushedPage back="Preferences" title="Check-ins" lead="I only write first when there’s a reason. Most days that’s nothing."
      loading={q.isLoading} error={q.isError ? 'Couldn’t load check-in settings.' : null} onRetry={() => void q.refetch()}>
      {p ? (
        <>
          <Eyebrow>How often</Eyebrow>
          <View style={{ marginTop: 4 }}>
            {FREQUENCY_ROWS.map((r, i) => (
              <View key={r.key} style={{ opacity: p.frequency === r.key ? 1 : 0.4 }}>
                <Row name={r.name} sub={r.sub} value={p.frequency === r.key ? (saving === 'frequency' ? '…' : 'Current') : undefined} arrow={false} onPress={() => void patch('frequency', { frequency: r.key as Frequency })} last={i === FREQUENCY_ROWS.length - 1} />
              </View>
            ))}
          </View>
          <View style={{ marginTop: 30 }}>
            <Row name="Push when it’s time-sensitive" sub="Before sessions and events" value={p.pushTimeSensitive ? 'On' : 'Off'} onPress={() => void patch('push', { pushTimeSensitive: !p.pushTimeSensitive })} />
            <Row name="Quiet hours" sub="Local time" value={quietHoursLabel(p.quietStart, p.quietEnd)} onPress={() => Alert.alert('Quiet hours', 'When should Anakin stay quiet?', [
              { text: '10 PM – 7 AM', onPress: () => quiet(22, 7) }, { text: '9 PM – 8 AM', onPress: () => quiet(21, 8) }, { text: '11 PM – 6 AM', onPress: () => quiet(23, 6) }, { text: 'Cancel', style: 'cancel' },
            ])} />
            <Row name="Outcome reports" sub="“Did it work” after a change" value={p.outcomeReports ? 'On' : 'Off'} onPress={() => void patch('outcome', { outcomeReports: !p.outcomeReports })} />
            <Row name="Usual session time" sub={p.sessionTime ? 'Time-sensitive pushes land before it' : (q.data?.sessionTimeInferred ? `Looks like ${q.data.sessionTimeInferred} from your logs` : 'So pushes can land before it')} value={p.sessionTime ?? undefined} arrow={!p.sessionTime}
              onPress={() => setTimeSheet(true)} />
            <Row name="Who runs your program?" value={p.programOwner === 'me' ? 'Me, with Anakin' : p.programOwner === 'coach_offline' ? 'My coach' : 'My coach on Axiom'} onPress={() => go(router, 'programowner')} />
            <Row name="All check-ins" sub={p.allCheckins ? 'Anakin may write first' : 'Only replies when you write first'} value={p.allCheckins ? 'On' : 'Off'} onPress={() => void patch('all', { allCheckins: !p.allCheckins })} last />
          </View>
          <Sheet visible={timeSheet} onClose={() => setTimeSheet(false)} title="Usual session time" sub="A time-sensitive push lands within six hours of it.">
            {q.data?.sessionTimeInferred && !p.sessionTime ? <Row name={`Use ${q.data.sessionTimeInferred}`} sub="From when you log sessions" onPress={() => { setTimeSheet(false); void patch('sessionTime', { sessionTime: q.data!.sessionTimeInferred }); }} /> : null}
            {TIMES.map((tm, i) => <Row key={tm} name={tm} value={p.sessionTime === tm ? 'Current' : undefined} onPress={() => { setTimeSheet(false); void patch('sessionTime', { sessionTime: tm }); }} last={i === TIMES.length - 1 && !p.sessionTime} />)}
            {p.sessionTime ? <Row name="No usual time" sub="Pushes stay off; check-ins wait in the thread" onPress={() => { setTimeSheet(false); void patch('sessionTime', { sessionTime: null }); }} last /> : null}
          </Sheet>
          <Eyebrow style={{ marginTop: 30 }}>Muted topics</Eyebrow>
          <View style={{ marginTop: 4 }}>
            {q.data!.muted.length ? q.data!.muted.map((m, i) => <Row key={m.topic} name={m.topic.charAt(0).toUpperCase() + m.topic.slice(1)} sub={m.label} value="Unmute" onPress={() => void unmute(m.topic)} last={i === q.data!.muted.length - 1} />)
              : <Text style={T.bodyMuted}>Nothing muted. Safety flags aren’t listed — they can’t be muted.</Text>}
          </View>
        </>
      ) : null}
    </PushedPage>
  );
}

// ── B9 · Who runs your program? ─────────────────────────────────────────────

export function ProgramOwnerPage() {
  const q = useCheckinPrefs();
  const qc = useQueryClient();
  const router = useRouter();
  const p = q.data?.prefs;
  const set = async (owner: ProactivePrefs['programOwner']) => {
    try { await proactiveApi.checkinsPatch({ programOwner: owner }); await qc.invalidateQueries({ queryKey: ['v2', 'proactive'] }); haptics.select(); router.back(); }
    catch (e: any) { Alert.alert('Couldn’t save that', e?.message ?? ''); }
  };
  const rows: { key: ProactivePrefs['programOwner']; name: string; sub: string }[] = [
    { key: 'me', name: 'Me, with Anakin', sub: 'Anakin applies changes after you confirm' },
    { key: 'coach_offline', name: 'My coach, not on Axiom', sub: 'Suggestions go out through your share sheet' },
    { key: 'coach_axiom', name: 'My coach on Axiom', sub: 'Suggestions go to their inbox' },
  ];
  return (
    <PushedPage back="Preferences" title="Who runs your program?" lead="If it’s a coach, I suggest changes instead of making them." loading={q.isLoading} error={q.isError ? 'Couldn’t load that.' : null} onRetry={() => void q.refetch()}>
      {p ? rows.map((r, i) => (
        <View key={r.key} style={{ opacity: p.programOwner === r.key ? 1 : 0.55 }}>
          <Row name={r.name} sub={r.sub} value={p.programOwner === r.key ? 'Current' : undefined} arrow={false} onPress={() => void set(r.key)} last={i === rows.length - 1} />
        </View>
      )) : null}
    </PushedPage>
  );
}

// ── F2 · What Anakin knows — notes and photos ───────────────────────────────

function PhotoTile({ id, kind, isPrivate, selected, onPress }: { id: string; kind: string; isPrivate: boolean; selected: boolean; onPress: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const q = usePhotoUrl(id, !isPrivate || revealed);
  return (
    <Pressable onPress={() => { if (isPrivate && !revealed) { setRevealed(true); return; } onPress(); }} onLongPress={onPress} accessibilityLabel={`${PHOTO_KIND_LABEL[kind] ?? 'Photo'}${isPrivate ? ', private' : ''}`}>
      <View style={[styles.tile, isPrivate && !revealed && { backgroundColor: v2.color.ink }, selected && { borderWidth: 2, borderColor: v2.color.crimson }]}>
        {q.data?.url && (!isPrivate || revealed) ? <Image source={{ uri: q.data.url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {isPrivate && !revealed ? <Text style={[T.caption, { color: v2.color.darkInk, position: 'absolute', left: 8, bottom: 6 }]}>{PHOTO_KIND_LABEL[kind]}</Text> : null}
      </View>
    </Pressable>
  );
}

export function KnowsPage() {
  const memory = useMemory();
  const photos = useChatPhotos();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'notes' | 'photos'>('notes');
  const [selected, setSelected] = useState<string | null>(null);
  const notes = memory.data?.notes ?? [];
  const profile = memory.data?.profile ?? [];
  const list = photos.data?.photos ?? [];
  const groups = groupPhotos(list);
  const sel = list.find((p) => p.id === selected) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['v2', 'proactive', 'photos'] });
  const del = (id: string) => Alert.alert('Delete this photo?', 'Its description goes with it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void (async () => { await proactiveApi.photoDelete(id).catch(() => {}); setSelected(null); await refresh(); })() }]);
  const delAll = () => Alert.alert('Delete all photos?', 'Every photo and its description. This can’t be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete all', style: 'destructive', onPress: () => void (async () => { await proactiveApi.photosDeleteAll().catch(() => {}); await refresh(); })() }]);
  const total = notes.length + profile.length + list.length;
  const grid = (items: typeof list) => (
    <View style={styles.grid}>{items.map((p) => <PhotoTile key={p.id} id={p.id} kind={p.kind} isPrivate={p.private} selected={selected === p.id} onPress={() => setSelected(selected === p.id ? null : p.id)} />)}</View>
  );
  return (
    <PushedPage back="You" meta={memory.data || photos.data ? `${total} things` : null} title="What Anakin knows"
      loading={memory.isLoading && photos.isLoading} error={memory.error && photos.error ? 'Couldn’t load what Anakin knows.' : null} onRetry={() => { void memory.refetch(); void photos.refetch(); }}
      foot={tab === 'photos' && list.length ? [{ label: 'Delete all', onPress: delAll, muted: true }] : undefined}>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('notes')}><Text style={[T.rowStrong, tab !== 'notes' && { color: v2.color.muted }]}>Notes · {notes.length + profile.length}</Text></Pressable>
        <Pressable onPress={() => setTab('photos')}><Text style={[T.rowStrong, tab !== 'photos' && { color: v2.color.muted }]}>Photos · {list.length}</Text></Pressable>
      </View>
      {tab === 'notes' ? (
        <View style={{ marginTop: 20 }}>
          {profile.length ? <Eyebrow>From onboarding</Eyebrow> : null}
          {profile.map((f: any, i: number) => <Row key={`p${i}`} name={f.label} sub={f.value} last={i === profile.length - 1} />)}
          {notes.length ? <Eyebrow style={{ marginTop: profile.length ? 24 : 0 }}>From your chats</Eyebrow> : null}
          {notes.map((n: string, i: number) => <Row key={`n${i}`} name={n} last={i === notes.length - 1} />)}
          {!notes.length && !profile.length && memory.data ? <Text style={T.bodyMuted}>Nothing noted yet. It fills in as you talk.</Text> : null}
        </View>
      ) : (
        <View style={{ marginTop: 20 }}>
          {groups.private.length ? <><View style={styles.groupHead}><Eyebrow>Private · {groups.private.length}</Eyebrow><Text style={T.caption}>Tap to view</Text></View>{grid(groups.private)}</> : null}
          {groups.meals.length ? <><Eyebrow style={{ marginTop: 22 }}>Meals and labels · {groups.meals.length}</Eyebrow>{grid(groups.meals.slice(0, 12))}{groups.meals.length > 12 ? <Text style={T.caption}>+{groups.meals.length - 12}</Text> : null}</> : null}
          {groups.programs.length ? <Row name="Program screenshots" sub={`${groups.programs.length} · imported`} onPress={() => setSelected(groups.programs[0].id)} /> : null}
          {groups.other.length ? <><Eyebrow style={{ marginTop: 22 }}>Other · {groups.other.length}</Eyebrow>{grid(groups.other)}</> : null}
          <Row name="Keep photos for" sub="Private photos go with their descriptions" value={`${photos.data?.retentionDays ?? 90} days`} last />
          {sel ? (
            <View style={{ marginTop: 18 }}>
              <AnakinRead text={sel.description ?? `A ${PHOTO_KIND_LABEL[sel.kind]?.toLowerCase() ?? 'photo'}, stored ${new Date(sel.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`} size="body" />
              <View style={{ flexDirection: 'row', gap: 24, marginTop: 10 }}>
                <TextAction muted arrow={false} size={15} onPress={() => del(sel.id)}>Delete</TextAction>
              </View>
            </View>
          ) : null}
          {!list.length && photos.data ? <Text style={T.bodyMuted}>No photos yet. Send one in chat with the + next to “Ask Anakin”.</Text> : null}
        </View>
      )}
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 2, borderLeftColor: v2.color.hairline, paddingLeft: 14, marginTop: 8 },
  tabs: { flexDirection: 'row', gap: 22, borderBottomWidth: 1, borderBottomColor: v2.color.hairline, paddingBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  tile: { width: 92, height: 92, borderRadius: 14, overflow: 'hidden', backgroundColor: v2.color.surface },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
