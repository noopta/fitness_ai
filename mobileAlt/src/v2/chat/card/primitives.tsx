// Card primitives (CHAT_CARDS_RN_SPEC §4) — the text-shaped ones. Charts and
// media live in charts.tsx. Every primitive is pure presentation plus a
// callback; the card decides what a tap means.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Platform } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { Card, CardAction, CardRow } from '@axiom/agent-ui-core';
import { primaryActionIndex, undoOpen } from '@axiom/agent-ui-core';
import { K, S } from './tokens';
import { useCardHandlers } from './context';
import { haptics } from '../../haptics';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };
export const MASK = '•••• Tap to show';

// ── MetaLine ────────────────────────────────────────────────────────────────
export function MetaLine({ label, onOpen }: { label: string; onOpen?: () => void }) {
  return (
    <View style={st.meta}>
      <Text style={[S.meta, { flex: 1 }]} numberOfLines={2}>{label}</Text>
      {onOpen ? (
        <Pressable onPress={onOpen} hitSlop={HIT} accessibilityRole="link" accessibilityLabel={`Open ${label}`}>
          <Text style={S.open}>Open →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Rows (with inline edit and toggles) ─────────────────────────────────────
export function Rows({ card, rows, masked, onReveal, disabled }: { card: Card; rows: CardRow[]; masked?: boolean; onReveal?: () => void; disabled?: boolean }) {
  const h = useCardHandlers();
  return (
    <View>
      {rows.map((r, i) => (
        <RowLine key={`${r.key}-${i}`} card={card} row={r} first={i === 0} masked={masked} onReveal={onReveal} disabled={disabled}
          onPressRow={r.action && !disabled ? () => { const a = card.actions?.find((x) => x.id === r.action) ?? { id: r.action!, label: r.key, kind: 'secondary' as const }; void h.act(card, a); } : undefined} />
      ))}
    </View>
  );
}

function RowLine({ card, row, first, masked, onReveal, disabled, onPressRow }: { card: Card; row: CardRow; first: boolean; masked?: boolean; onReveal?: () => void; disabled?: boolean; onPressRow?: () => void }) {
  const markChar = row.mark === 'add' ? '+' : row.mark === 'del' ? '−' : row.mark === 'chg' ? '•' : null;
  const ref = useRef<View>(null);
  const body = (
    <View ref={ref} collapsable={false} style={[st.row, !first && st.rowLine, row.mark === 'muted' && { opacity: 0.55 }]}>
      {markChar ? <Text style={[S.mark, { width: 14 }]}>{markChar}</Text> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={S.rowKey}>{row.key}</Text>
        {row.sub ? <Text style={[S.rowSub, { marginTop: 2 }]}>{row.sub}</Text> : null}
      </View>
      {row.toggle ? (
        <Toggle card={card} field={row.toggle.field} on={row.toggle.on} label={row.key} disabled={disabled} />
      ) : row.value != null || row.editable ? (
        masked ? (
          <Pressable onPress={onReveal} hitSlop={HIT} accessibilityLabel="Hidden value. Tap to show">
            <Text style={[S.rowValue, { color: K.faint }]}>{MASK}</Text>
          </Pressable>
        ) : row.editable && !disabled ? (
          <EditableValue card={card} row={row} rowRef={ref} />
        ) : (
          <View style={st.valueCol}>
            {row.was ? <Text style={S.diffFrom}>{row.was}</Text> : null}
            <Text style={S.rowValue}>{row.value}</Text>
          </View>
        )
      ) : row.mark === 'lock' ? <Text style={S.rowSub}>Locked</Text> : null}
    </View>
  );
  return onPressRow ? <Pressable onPress={onPressRow} accessibilityRole="button">{body}</Pressable> : body;
}

/** Dotted-underline value → same-size TextInput in place (§7.3). time/date open the native picker. */
function EditableValue({ card, row, rowRef }: { card: Card; row: CardRow; rowRef: React.RefObject<View | null> }) {
  const h = useCardHandlers();
  const ed = row.editable!;
  const active = h.editing?.cardId === card.id && h.editing.field === ed.field;
  const [iosPicker, setIosPicker] = useState<Date | null>(null);
  const [wasShown, setWasShown] = useState<string | null>(null);
  useEffect(() => { if (!row.was) return; setWasShown(row.was); const t = setTimeout(() => setWasShown(null), 3000); return () => clearTimeout(t); }, [row.was]);

  const start = () => {
    haptics.select();
    if (ed.kind === 'time' || ed.kind === 'date') {
      const now = parsePickerValue(ed.kind, row.value);
      if (Platform.OS === 'android') {
        DateTimePickerAndroid.open({
          value: now, mode: ed.kind, is24Hour: false,
          onChange: (e, d) => { if (e.type === 'set' && d) void h.edit(card, ed.field, formatPicker(ed.kind as 'time' | 'date', d)); },
        });
      } else setIosPicker(now);
      return;
    }
    h.beginEdit({ cardId: card.id, field: ed.field, kind: ed.kind, initial: row.value ?? '', value: stripUnit(row.value ?? '') });
    setTimeout(() => h.reveal(rowRef.current), 60);
  };

  if (iosPicker) {
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <DateTimePicker value={iosPicker} mode={ed.kind as 'time' | 'date'} display="compact" onChange={(_e, d) => d && setIosPicker(d)} />
        <View style={{ flexDirection: 'row', gap: 18, marginTop: 6 }}>
          <Pressable onPress={() => setIosPicker(null)} hitSlop={HIT}><Text style={S.secondary}>Cancel</Text></Pressable>
          <Pressable onPress={() => { const d = iosPicker; setIosPicker(null); void h.edit(card, ed.field, formatPicker(ed.kind as 'time' | 'date', d)); }} hitSlop={HIT}><Text style={S.primary}>Save</Text></Pressable>
        </View>
      </View>
    );
  }
  if (active) {
    return (
      <TextInput
        autoFocus
        value={h.editing!.value}
        onChangeText={h.setEditValue}
        onBlur={() => h.endEdit()}
        selectTextOnFocus
        keyboardType={ed.kind === 'text' ? 'default' : 'decimal-pad'}
        style={[S.rowValue, st.editing]}
        accessibilityLabel={`Edit ${row.key}`}
      />
    );
  }
  return (
    <Pressable onPress={start} hitSlop={HIT} accessibilityRole="button" accessibilityLabel={`${row.key}, ${row.value}. Double tap to edit`} style={st.valueCol}>
      {wasShown ? <Text style={S.diffFrom}>{wasShown}</Text> : null}
      <Text style={[S.rowValue, st.dotted]}>{row.value || '—'}</Text>
    </Pressable>
  );
}

const stripUnit = (v: string) => (v.match(/^-?[\d.,]+(\s*[x×]\s*\d+)?/)?.[0] ?? v).replace(/,/g, '');
function parsePickerValue(kind: 'time' | 'date', v?: string): Date {
  const d = new Date();
  if (!v) return d;
  if (kind === 'date') { const x = new Date(`${v.slice(0, 10)}T12:00:00`); return Number.isNaN(x.getTime()) ? d : x; }
  const m = /(\d{1,2}):?(\d{2})?\s*([ap]m)?/i.exec(v);
  if (m) {
    let hr = Number(m[1]);
    if (m[3]) hr = (hr % 12) + (/p/i.test(m[3]) ? 12 : 0);
    d.setHours(hr, Number(m[2] ?? 0), 0, 0);
  }
  return d;
}
function formatPicker(kind: 'time' | 'date', d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return kind === 'date' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Toggle (40 × 24; writes immediately — change_undo) ──────────────────────
export function Toggle({ card, field, on, label, disabled }: { card: Card; field: string; on: boolean; label: string; disabled?: boolean }) {
  const h = useCardHandlers();
  const [val, setVal] = useState(on);
  useEffect(() => setVal(on), [on]);
  const x = useSharedValue(on ? 16 : 0);
  useEffect(() => { x.value = withTiming(val ? 16 : 0, { duration: 180 }); }, [val, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const flip = async () => {
    if (disabled) return;
    const next = !val;
    setVal(next); haptics.select();
    try { await h.toggle(card, field, next); } catch { setVal(!next); }
  };
  return (
    <Pressable onPress={flip} hitSlop={HIT} accessibilityRole="switch" accessibilityState={{ checked: val, disabled }} accessibilityLabel={label}
      style={[st.toggle, { backgroundColor: val ? K.ink : K.hairline, opacity: disabled ? 0.5 : 1 }]}>
      <Animated.View style={[st.knob, knob]} />
    </Pressable>
  );
}

// ── ChangeValue / DiffRows ──────────────────────────────────────────────────
export function ChangeValue({ change }: { change: NonNullable<Card['change']> }) {
  return (
    <View accessible accessibilityLabel={`${change.key}, from ${change.from} to ${change.to}`}>
      <Text style={S.changeKey}>{change.key}</Text>
      <View style={st.changeLine}>
        <Text style={S.changeFrom}>{change.from}</Text>
        <Text style={S.changeArrow}>→</Text>
        <Text style={S.changeTo}>{change.to}</Text>
      </View>
      {change.note ? <Text style={[S.note, { marginTop: 6 }]}>{change.note}</Text> : null}
    </View>
  );
}

export function DiffRows({ diff }: { diff: NonNullable<Card['diff']> }) {
  return (
    <View>
      {diff.map((d, i) => (
        <View key={`${d.key}-${i}`} style={[st.diff, i > 0 && st.rowLine]} accessible accessibilityLabel={d.from ? `${d.key}, from ${d.from} to ${d.to}` : `${d.key}, ${d.to}`}>
          <Text style={[S.diffKey, { flex: 0.8 }]}>{d.key}</Text>
          <View style={{ flex: 1.2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, justifyContent: 'flex-end' }}>
            {d.from ? <Text style={S.diffFrom}>{d.from}</Text> : null}
            <Text style={[S.diffTo, d.removed && { color: K.faint }]}>{d.to}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Text blocks ─────────────────────────────────────────────────────────────
export const Why = ({ text }: { text: string }) => <Text style={S.note}>{text}</Text>;
export const Note = Why;
export const EmptyLine = ({ text }: { text: string }) => <Text style={S.empty}>{text}</Text>;

// ── Ask / OptionRows ────────────────────────────────────────────────────────
export function AskBlock({ q, options, typeInstead, onPick, onType, chosen }: { q?: string; options: string[]; typeInstead?: boolean; onPick: (i: number) => void; onType?: () => void; chosen?: number | null }) {
  return (
    <View>
      {q ? <Text style={[S.askQ, { marginBottom: 12 }]}>{q}</Text> : null}
      {options.map((o, i) => <OptionRow key={`${o}-${i}`} label={o} height={q ? 48 : 44} onPress={() => onPick(i)} state={chosen == null ? 'idle' : chosen === i ? 'chosen' : 'other'} />)}
      {typeInstead && onType ? (
        <Pressable onPress={onType} style={[st.option, { height: 48 }]} accessibilityRole="button">
          <Text style={[S.option, { color: K.faint, flex: 1 }]}>Or type it</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function OptionRow({ label, height, onPress, state }: { label: string; height: number; onPress: () => void; state: 'idle' | 'chosen' | 'other' }) {
  const o = useSharedValue(1), x = useSharedValue(0);
  useEffect(() => {
    o.value = withTiming(state === 'other' ? 0.25 : 1, { duration: 300 });
    x.value = withTiming(state === 'chosen' ? 6 : 0, { duration: 300 });
  }, [state, o, x]);
  const fade = useAnimatedStyle(() => ({ opacity: o.value }));
  const arrow = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View style={fade}>
      <Pressable onPress={() => { if (state === 'idle') { haptics.select(); onPress(); } }} style={[st.option, { height }]} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={[S.option, { flex: 1 }]} numberOfLines={2}>{label}</Text>
        <Animated.Text style={[S.option, { color: K.faint }, arrow]}>→</Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Segmented (scope: This day / Everywhere) ────────────────────────────────
export function Segmented({ options, value, onChange, disabled }: { options: string[]; value: number; onChange: (i: number) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 18 }} accessibilityRole="tablist">
      {options.map((o, i) => (
        <Pressable key={o} onPress={() => { if (!disabled) { haptics.select(); onChange(i); } }} hitSlop={HIT} accessibilityRole="tab" accessibilityState={{ selected: i === value }}>
          <Text style={[S.segment, i === value && { color: K.ink, textDecorationLine: 'underline' }]}>{o}</Text>
          {i === value ? <View style={st.segLine} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

// ── FlowProgress ────────────────────────────────────────────────────────────
export function FlowProgress({ done }: { done: [string, string][] }) {
  if (!done.length) return null;
  return (
    <View>
      {done.map(([k, v], i) => (
        <View key={`${k}-${i}`} style={[st.flowRow, i > 0 && st.rowLine]}>
          <Text style={[S.flowKey, { flex: 1 }]}>{k}</Text>
          <Text style={S.flowValue}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

// ── DraftBody ───────────────────────────────────────────────────────────────
export function DraftBody({ draft }: { draft: NonNullable<Card['draft']> }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={st.meta}>
        <Text style={S.draftTo}>To {draft.to}</Text>
        <Text style={S.meta}>{draft.audience}</Text>
      </View>
      {draft.body ? <Text style={S.draftBody}>{draft.body}</Text> : null}
      {draft.attachment ? (
        <View style={st.attach}>
          <Text style={S.tileTitle}>{draft.attachment.title}</Text>
          {draft.attachment.sub ? <Text style={S.meta}>{draft.attachment.sub}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

// ── LoseList / TypedConfirm ─────────────────────────────────────────────────
export function LoseList({ items, keep }: { items: string[]; keep?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={[S.lose, { color: K.faint }]}>–</Text>
          <Text style={[S.lose, { flex: 1 }]}>{t}</Text>
        </View>
      ))}
      {keep ? <Text style={S.note}>{keep}</Text> : null}
    </View>
  );
}

export function TypedConfirm({ word, value, onChange, onFocusField }: { word: string; value: string; onChange: (v: string) => void; onFocusField: (on: boolean) => void }) {
  return (
    <View>
      <Text style={S.note}>Type {word} to confirm</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.toUpperCase())}
        autoCorrect={false}
        autoCapitalize="characters"
        returnKeyType="done"
        onFocus={() => onFocusField(true)}
        onBlur={() => onFocusField(false)}
        style={[S.typed, st.typed]}
        accessibilityLabel={`Type ${word} to confirm`}
      />
    </View>
  );
}

// ── HandoffButton ───────────────────────────────────────────────────────────
export function HandoffButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={() => { haptics.light(); onPress(); }} style={({ pressed }) => [st.handoff, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={S.handoff}>{label}</Text>
      <Text style={[S.handoff, { color: K.muted, marginLeft: 8 }]}>↗</Text>
    </Pressable>
  );
}

// ── Actions ─────────────────────────────────────────────────────────────────
export function Actions({ actions, onPress, busyId, typed }: { actions: CardAction[]; onPress: (a: CardAction) => void; busyId?: string | null; typed?: string }) {
  const primary = primaryActionIndex(actions);
  return (
    <View style={st.actions}>
      {actions.map((a, i) => {
        const isPrimary = i === primary || a.kind === 'destructive';
        const locked = !!a.requiresTyped && typed !== a.requiresTyped;
        const busy = busyId === a.id;
        const label = isPrimary && !/[→↗]$/.test(a.label) ? `${a.label} →` : a.label;
        return (
          <Pressable key={a.id} onPress={() => { if (!locked && !busyId) onPress(a); }} disabled={locked} hitSlop={{ top: 12, bottom: 12 }} style={{ minHeight: 44, justifyContent: 'center' }}
            accessibilityRole="button" accessibilityState={{ disabled: locked, busy }} accessibilityLabel={a.label}>
            <Text style={[isPrimary ? S.primary : S.secondary, locked && { color: K.faint }, busy && { opacity: 0.5 }]}>{busy ? `${a.label}…` : label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── StateLine (outside the dimmed body) ─────────────────────────────────────
export function StateLine({ card, line, onUndo, onOpen, onReplaced }: { card: Card; line: string; onUndo?: () => void; onOpen?: () => void; onReplaced?: () => void }) {
  const canUndo = !!onUndo && undoOpen(card);
  const status = card.state?.status;
  return (
    <Animated.View entering={FadeIn.duration(K.fade)} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <Text style={S.stateLine} onPress={status === 'replaced' ? onReplaced : undefined}>
        {line}{status === 'replaced' && !/↓$/.test(line) ? ' ↓' : ''}
      </Text>
      {canUndo ? <Text style={S.stateLine}> · <Text style={{ textDecorationLine: 'underline' }} onPress={onUndo} accessibilityRole="button">Undo</Text></Text> : null}
      {onOpen && (status === 'changed' || status === 'posted') ? <Text style={S.stateLine}> · <Text onPress={onOpen} accessibilityRole="link">Open →</Text></Text> : null}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: K.rowLine },
  valueCol: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 0, maxWidth: '55%', flexWrap: 'wrap', justifyContent: 'flex-end' },
  // iOS draws it dotted; Android has no dotted text decoration, so a faint solid underline.
  dotted: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: K.faint },
  editing: { minWidth: 64, textAlign: 'right', paddingVertical: 0, borderBottomWidth: 1, borderBottomColor: K.ink },
  toggle: { width: 40, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  changeLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, marginTop: 4 },
  diff: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 10, gap: 12 },
  option: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: K.hairline, gap: 12 },
  segLine: { height: 1.5, backgroundColor: K.ink, marginTop: 3 },
  flowRow: { flexDirection: 'row', paddingVertical: 8, gap: 12 },
  attach: { backgroundColor: K.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  typed: { height: 44, borderBottomWidth: 1, borderBottomColor: K.ink, paddingVertical: 0, marginTop: 6 },
  handoff: { alignSelf: 'flex-start', height: 44, paddingHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: K.ink, flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 22 },
});
