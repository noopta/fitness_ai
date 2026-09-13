import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COPY,
  DX,
  isValidSet,
  parseNumber,
  type ComposerView,
  type DiagnosticController,
  type WeightUnit,
} from '@axiom/diagnostic-core';
import { Chip, InkButton, OutlineButton, QuietButton, SendButton } from './primitives';
import type { PickedClip } from '../api';

const C = DX.color;
const MAX_CLIP_SECONDS = 60;
// Same preference key as Form Analysis: stills are opt-in there, and stay so here.
const SAVE_FRAMES_KEY = 'form_analysis_save_frames';

interface Props {
  view: ComposerView;
  controller: DiagnosticController;
  onOpenReport: () => void;
  onDone: () => void;
}

/**
 * The composer is the only input surface in the flow (§1). Its control set is
 * a pure function of the stage — see composerView() in the shared core.
 */
export function Composer({ view, controller, onOpenReport, onDone }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {Platform.OS === 'ios' ? <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.inner}>{renderMode(view, controller, onOpenReport, onDone)}</View>
    </View>
  );
}

function renderMode(view: ComposerView, c: DiagnosticController, onOpenReport: () => void, onDone: () => void) {
  switch (view.mode) {
    case 'chips':
      return <ChipsComposer view={view} controller={c} />;
    case 'typing':
      return <TypingComposer view={view} controller={c} />;
    case 'numbers':
      return <NumbersComposer unit={view.unit as WeightUnit} disabled={view.disabled} onSend={(set) => c.act({ type: 'main', set })} />;
    case 'accessory':
      return <AccessoryComposer view={view} controller={c} />;
    case 'video':
      return <VideoComposer disabled={view.disabled} controller={c} />;
    case 'generate':
      return <InkButton label={view.label} disabled={view.disabled} onPress={() => c.act({ type: 'verdict' })} />;
    case 'waiting':
      return (
        <View style={styles.waiting} accessibilityLiveRegion="polite">
          <ActivityIndicator color={C.ink} />
          <Text style={styles.waitingText}>{view.label}</Text>
        </View>
      );
    case 'done':
      return (
        <View style={styles.row}>
          <InkButton label={COPY.openReport} onPress={onOpenReport} style={{ flex: 1 }} />
          <OutlineButton label={COPY.done} onPress={onDone} style={{ paddingHorizontal: 24 }} />
        </View>
      );
    case 'blocked':
      return <Text style={styles.caption}>{view.caption}</Text>;
  }
}

function ChipsComposer({ view, controller }: { view: Extract<ComposerView, { mode: 'chips' }>; controller: DiagnosticController }) {
  const state = controller.getState();
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => setPressed(null), [state.stage]);

  const pick = (opt: { id: string; label: string; flags: string[] }) => {
    setPressed(opt.id);
    if (state.stage === 'lift') {
      controller.act({ type: 'lift', lift: opt.id as never });
    } else if (state.stage === 'q0' || state.stage === 'q1' || state.stage === 'q2') {
      controller.act({ type: 'answer', question: state.stage, optionId: opt.id, text: opt.label, flags: opt.flags });
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.chips}>
        {view.options.map((o) => (
          <Chip key={o.id} label={o.label} active={pressed === o.id} disabled={view.disabled} onPress={() => pick(o)} />
        ))}
      </View>
      {view.typeInstead ? (
        <QuietButton label={COPY.typeInstead} disabled={view.disabled} onPress={() => controller.setTypeInstead(true)} />
      ) : null}
    </View>
  );
}

function TypingComposer({ view, controller }: { view: Extract<ComposerView, { mode: 'typing' }>; controller: DiagnosticController }) {
  const [text, setText] = useState('');
  const stage = controller.getState().stage;
  const send = () => {
    if (stage !== 'q0' && stage !== 'q1' && stage !== 'q2') return;
    if (controller.act({ type: 'answer', question: stage, text, flags: [] })) setText('');
  };
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={view.placeholder}
          placeholderTextColor={C.disabled}
          style={styles.textInput}
          multiline
          maxLength={1000}
          autoFocus
          editable={!view.disabled}
        />
        <SendButton onPress={send} disabled={view.disabled || !text.trim()} />
      </View>
      <QuietButton label={COPY.backToQuick} onPress={() => controller.setTypeInstead(false)} />
    </View>
  );
}

function NumericField({
  label, value, onChange, width, inputRef, onSubmit,
}: { label: string; value: string; onChange: (v: string) => void; width: number | 'flex'; inputRef?: React.RefObject<TextInput | null>; onSubmit?: () => void }) {
  return (
    <View style={width === 'flex' ? { flex: 1 } : { width }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9.,]/g, ''))}
        keyboardType={label.startsWith('Weight') ? 'decimal-pad' : 'number-pad'}
        style={styles.numeric}
        accessibilityLabel={label}
        returnKeyType="next"
        onSubmitEditing={onSubmit}
      />
    </View>
  );
}

function NumbersComposer({
  unit, disabled, onSend, resetKey,
}: { unit: WeightUnit; disabled: boolean; onSend: (set: { weight: number; sets: number; reps: number; unit: WeightUnit }) => boolean; resetKey?: string }) {
  const [weight, setWeight] = useState('');
  const [sets, setSets] = useState('');
  const [reps, setReps] = useState('');
  const setsRef = useRef<TextInput>(null);
  const repsRef = useRef<TextInput>(null);
  useEffect(() => {
    setWeight('');
    setSets('');
    setReps('');
  }, [resetKey]);

  const valid = isValidSet(weight, sets, reps);
  const send = () => {
    if (!valid) return;
    onSend({ weight: parseNumber(weight)!, sets: parseNumber(sets)!, reps: parseNumber(reps)!, unit });
  };
  return (
    <View style={[styles.row, { alignItems: 'flex-end' }]}>
      <NumericField label={COPY.weightLabel(unit)} value={weight} onChange={setWeight} width="flex" onSubmit={() => setsRef.current?.focus()} />
      <NumericField label={COPY.setsLabel} value={sets} onChange={setSets} width={56} inputRef={setsRef} onSubmit={() => repsRef.current?.focus()} />
      <NumericField label={COPY.repsLabel} value={reps} onChange={setReps} width={56} inputRef={repsRef} onSubmit={send} />
      <SendButton onPress={send} disabled={disabled || !valid} />
    </View>
  );
}

function AccessoryComposer({ view, controller }: { view: Extract<ComposerView, { mode: 'accessory' }>; controller: DiagnosticController }) {
  const id = view.exerciseId;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.accHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.accName} numberOfLines={1}>{view.exerciseName}</Text>
          <Text style={[styles.counter, view.counter.atMinimum && { color: C.muted }]}>{view.counter.text}</Text>
        </View>
        {view.canChange ? (
          <QuietButton label={COPY.change} disabled={view.disabled} onPress={() => controller.act({ type: 'change', exerciseId: id })} />
        ) : null}
      </View>
      <NumbersComposer
        unit={view.unit as WeightUnit}
        disabled={view.disabled}
        resetKey={id}
        onSend={(set) => controller.act({ type: 'accessory', exerciseId: id, set })}
      />
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <OutlineButton label={COPY.dontTrain} disabled={view.disabled} onPress={() => controller.act({ type: 'untrained', exerciseId: id })} style={styles.smallButton} />
        {view.escape === 'moveOn' ? (
          <InkButton label={COPY.moveOn} disabled={view.disabled} onPress={() => controller.act({ type: 'moveOn' })} style={styles.smallButton} />
        ) : (
          <QuietButton label={COPY.skip} disabled={view.disabled} onPress={() => controller.act({ type: 'skip', exerciseId: id })} />
        )}
      </View>
    </View>
  );
}

function VideoComposer({ disabled, controller }: { disabled: boolean; controller: DiagnosticController }) {
  const [choosing, setChoosing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library') => {
    setNote(null);
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setNote(source === 'camera' ? 'Camera access is off — choose a clip instead.' : 'Photo access is off — record one instead.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_CLIP_SECONDS,
      quality: 0.7,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
    };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const durationSec = asset.duration ? asset.duration / 1000 : null;
    if (durationSec != null && durationSec > MAX_CLIP_SECONDS + 2) {
      setNote('Keep it under 60 seconds — one working rep is plenty.');
      return;
    }
    const saveFrames = (await AsyncStorage.getItem(SAVE_FRAMES_KEY).catch(() => null)) === '1';
    const clip: PickedClip = { uri: asset.uri, mimeType: asset.mimeType ?? 'video/mp4', durationSec, saveFrames };
    setChoosing(false);
    controller.act({ type: 'video', durationSec: durationSec ? Math.round(durationSec) : null, file: clip });
  };

  return (
    <View style={{ gap: 10 }}>
      {note ? <Text style={styles.caption}>{note}</Text> : null}
      {choosing ? (
        <View style={styles.row}>
          <InkButton label="Record" icon="videocam-outline" disabled={disabled} onPress={() => void pick('camera')} style={{ flex: 1 }} />
          <OutlineButton label="Choose clip" disabled={disabled} onPress={() => void pick('library')} style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={styles.row}>
          <InkButton label={COPY.attachSet} icon="attach-outline" disabled={disabled} onPress={() => setChoosing(true)} style={{ flex: 1 }} />
          <QuietButton label={COPY.skip} disabled={disabled} onPress={() => controller.act({ type: 'skipVideo' })} />
        </View>
      )}
      {choosing ? <QuietButton label={COPY.skip} disabled={disabled} onPress={() => controller.act({ type: 'skipVideo' })} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: Platform.OS === 'ios' ? DX.composerBg : C.white,
    overflow: 'hidden',
  },
  inner: { paddingHorizontal: 16, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: DX.chip.gap },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48 },
  waitingText: { fontSize: 14, fontWeight: '600', color: C.muted },
  caption: { fontSize: 13, fontWeight: '500', color: C.muted, textAlign: 'center', paddingVertical: 12 },
  textInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    color: C.ink,
  },
  fieldLabel: {
    fontSize: DX.numeric.labelSize,
    fontWeight: '600',
    letterSpacing: DX.numeric.labelSize * DX.numeric.labelTracking,
    textTransform: 'uppercase',
    color: C.muted,
  },
  numeric: {
    fontSize: DX.numeric.fontSize,
    fontWeight: '700',
    letterSpacing: DX.numeric.fontSize * DX.numeric.letterSpacing,
    color: C.ink,
    borderBottomWidth: 2,
    borderBottomColor: C.ink,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  accHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accName: { fontSize: 15, fontWeight: '600', color: C.ink },
  counter: { fontSize: 12, fontWeight: '600', color: C.ink, marginTop: 2 },
  smallButton: { minHeight: 40, paddingHorizontal: 16 },
});

