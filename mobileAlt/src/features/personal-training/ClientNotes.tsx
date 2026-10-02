// Dossier notes tab (design handoff §6.3): the trainer's private notes on a
// client, newest first, with add, edit and delete. Clients never see these.

import React, { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { COPY, relativeDay, type ClientNote } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, radius, spacing } from '../../constants/theme';
import { MAX_FONT_SCALE, Notice } from './components';
import { ActionButton, FeedbackText, TextArea } from './controls';
import { useNoteActions, useNotes } from './hooks';
import { MOBILE_COPY } from './mobileCopy';

function NoteCard({ note, clientId }: { note: ClientNote; clientId: string }) {
  const { update, remove } = useNoteActions(clientId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const failure = update.error ?? remove.error;

  function confirmDelete() {
    Alert.alert(MOBILE_COPY.dossier.deleteNoteTitle, undefined, [
      { text: COPY.dossier.cancel, style: 'cancel' },
      { text: COPY.dossier.deleteNote, style: 'destructive', onPress: () => remove.mutate(note.id) },
    ]);
  }

  return (
    <View style={styles.note}>
      {editing ? (
        <>
          <TextArea accessibilityLabel={COPY.dossier.editNote} value={body} onChangeText={setBody} maxLength={4000} autoFocus />
          <View style={styles.actions}>
            <ActionButton
              disabled={!body.trim() || body === note.body || update.isPending}
              loading={update.isPending}
              onPress={() => update.mutate({ noteId: note.id, body: body.trim() }, { onSuccess: () => setEditing(false) })}
            >
              {COPY.dossier.saveNote}
            </ActionButton>
            <ActionButton variant="ghost" onPress={() => { setBody(note.body); setEditing(false); }}>{COPY.dossier.cancel}</ActionButton>
          </View>
        </>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{note.body}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>
            {[note.authorName, relativeDay(note.createdAt), note.updatedAt !== note.createdAt ? MOBILE_COPY.dossier.edited : null].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.actions}>
            <ActionButton variant="ghost" size="sm" onPress={() => { setBody(note.body); setEditing(true); }}>{COPY.dossier.editNote}</ActionButton>
            <ActionButton variant="ghost" size="sm" disabled={remove.isPending} onPress={confirmDelete}>{COPY.dossier.deleteNote}</ActionButton>
          </View>
        </>
      )}
      {failure ? <FeedbackText error>{(failure as Error).message || MOBILE_COPY.dossier.notesFailed}</FeedbackText> : null}
    </View>
  );
}

export function ClientNotes({ clientId, header }: { clientId: string; header: React.ReactElement }) {
  const notes = useNotes(clientId);
  const { add } = useNoteActions(clientId);
  const [draft, setDraft] = useState('');
  const sorted = useMemo(
    () => [...(notes.data?.notes ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notes.data],
  );

  const listHeader = (
    <View>
      {header}
      <View style={styles.compose}>
        <TextArea accessibilityLabel={COPY.dossier.notePlaceholder} placeholder={COPY.dossier.notePlaceholder} value={draft} onChangeText={setDraft} maxLength={4000} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.dossier.notesHelp}</Text>
        <View style={styles.actions}>
          <ActionButton disabled={!draft.trim() || add.isPending} loading={add.isPending} onPress={() => add.mutate(draft.trim(), { onSuccess: () => setDraft('') })}>
            {COPY.dossier.addNote}
          </ActionButton>
        </View>
        {add.isError && <FeedbackText error>{(add.error as Error).message || MOBILE_COPY.dossier.notesFailed}</FeedbackText>}
      </View>
    </View>
  );

  const empty = notes.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1].map((i) => <Skeleton key={i} height={88} />)}
    </View>
  ) : notes.isError ? (
    <Notice alert action={<ActionButton variant="secondary" onPress={() => notes.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.dossier.loadFailed}</Notice>
  ) : (
    <Notice>{COPY.dossier.noNotes}</Notice>
  );

  return (
    <FlatList
      data={sorted}
      keyExtractor={(n) => n.id}
      renderItem={({ item }) => <NoteCard note={item} clientId={clientId} />}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xl },
  compose: { padding: spacing.md, gap: spacing.sm },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  skeletons: { paddingHorizontal: spacing.md, gap: spacing.sm },
  note: {
    marginHorizontal: spacing.md, marginBottom: 12, padding: 12, gap: 6, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border,
  },
  body: { fontSize: fontSize.base, lineHeight: 23, color: colors.foreground },
});
