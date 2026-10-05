// MealItemsReview — itemised review for a meal photo (mealPhotoV2, classic UI).
// Each row: name · grams · kcal. Tap to edit (grams rescale from per100g, or
// kcal when nothing else is known), ✕ to remove, "Missed anything?" / "+ Add
// item" parse text into more rows. Totals recompute live from the rows.
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontWeight } from '../../../../constants/theme';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../../ui/KeyboardDoneBar';
import { applyEdit, editMode, itemSubtitle, totalsOf, type ReviewItem } from '../mealItems';

interface Props {
  items: ReviewItem[];
  onChange: (items: ReviewItem[]) => void;
  /** Parse free text ("cooked in butter", "a latte") into items to append. */
  onAddText: (text: string) => Promise<void>;
  addingText: boolean;
}

export function MealItemsReview({ items, onChange, onAddText, addingText }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [extra, setExtra] = useState('');
  const extraRef = useRef<TextInput>(null);
  const totals = totalsOf(items);

  const startEdit = (it: ReviewItem) => {
    Haptics.selectionAsync().catch(() => {});
    setEditingId(it.id);
    const mode = editMode(it);
    setDraft(mode === 'grams' ? (it.grams != null ? String(Math.round(it.grams)) : '') : String(it.calories));
  };
  const commitEdit = () => {
    if (!editingId) return;
    const it = items.find((i) => i.id === editingId);
    if (it && draft.trim()) onChange(items.map((i) => (i.id === editingId ? applyEdit(i, draft) : i)));
    setEditingId(null);
    setDraft('');
  };
  const remove = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (editingId === id) setEditingId(null);
    onChange(items.filter((i) => i.id !== id));
  };
  const submitExtra = async () => {
    const t = extra.trim();
    if (t.length < 3 || addingText) return;
    await onAddText(t);
    setExtra('');
  };

  return (
    <View>
      <KeyboardDoneBar />
      <Text style={styles.copy}>Photo estimates are a starting point — tap any item to adjust.</Text>

      <View style={styles.list}>
        {items.length === 0 ? (
          <Text style={styles.empty}>No items yet — add what you ate below.</Text>
        ) : items.map((it, idx) => {
          const editing = editingId === it.id;
          const mode = editMode(it);
          const sub = itemSubtitle(it);
          return (
            <View key={it.id} style={[styles.row, idx === items.length - 1 && { borderBottomWidth: 0 }]}>
              <TouchableOpacity
                style={styles.rowMain}
                onPress={() => (editing ? commitEdit() : startEdit(it))}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${it.name}, ${it.grams != null ? `${Math.round(it.grams)} grams, ` : ''}${it.calories} calories. Tap to adjust.`}
              >
                <Text style={styles.name} numberOfLines={1}>{it.name}</Text>
                {editing ? (
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.editInput}
                      value={draft}
                      onChangeText={setDraft}
                      keyboardType="decimal-pad"
                      autoFocus
                      selectTextOnFocus
                      onSubmitEditing={commitEdit}
                      onBlur={commitEdit}
                      inputAccessoryViewID={KEYBOARD_DONE_ID}
                      accessibilityLabel={mode === 'grams' ? `Grams of ${it.name}` : `Calories in ${it.name}`}
                    />
                    <Text style={styles.editUnit}>{mode === 'grams' ? 'g' : 'kcal'}</Text>
                  </View>
                ) : (
                  <Text style={styles.sub} numberOfLines={1}>{sub || (mode === 'grams' ? 'tap to set grams' : 'tap to adjust kcal')}</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.kcal}>{it.calories}</Text>
              <TouchableOpacity onPress={() => remove(it.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${it.name}`}>
                <Ionicons name="close" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <View style={styles.totals}>
        <Total label="Kcal" value={totals.calories} strong />
        <Total label="Protein" value={totals.proteinG} unit="g" />
        <Total label="Carbs" value={totals.carbsG} unit="g" />
        <Total label="Fat" value={totals.fatG} unit="g" />
      </View>

      <Text style={styles.fieldLabel}>MISSED ANYTHING?</Text>
      <View style={styles.addRow}>
        <TextInput
          ref={extraRef}
          style={styles.addInput}
          value={extra}
          onChangeText={setExtra}
          placeholder='e.g. "cooked in butter", "a latte"'
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="done"
          onSubmitEditing={() => void submitExtra()}
          editable={!addingText}
          accessibilityLabel="Add something the photo missed"
        />
        <TouchableOpacity
          style={[styles.addBtn, (extra.trim().length < 3 || addingText) && { opacity: 0.5 }]}
          onPress={() => (extra.trim().length >= 3 ? void submitExtra() : extraRef.current?.focus())}
          disabled={addingText}
          accessibilityRole="button"
          accessibilityLabel="Add item"
        >
          {addingText ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : (
            <Text style={styles.addBtnText}>+ Add item</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Total({ label, value, unit, strong }: { label: string; value: number; unit?: string; strong?: boolean }) {
  return (
    <View style={styles.totalCell}>
      <Text style={[styles.totalValue, strong && { fontWeight: fontWeight.bold }]}>{value}{unit ?? ''}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 12, color: colors.mutedForeground, marginBottom: 8, lineHeight: 17 },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12 },
  empty: { fontSize: 13, color: colors.mutedForeground, paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flex: 1 },
  name: { fontSize: 14, fontWeight: fontWeight.semibold, color: colors.foreground },
  sub: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  kcal: { fontSize: 14, fontWeight: fontWeight.semibold, color: colors.foreground, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'right' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  editInput: {
    minWidth: 72, backgroundColor: colors.muted, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
    fontSize: 14, color: colors.foreground, fontVariant: ['tabular-nums'],
  },
  editUnit: { fontSize: 12, color: colors.mutedForeground },
  totals: { flexDirection: 'row', marginTop: 12, gap: 8 },
  totalCell: { flex: 1, backgroundColor: colors.muted, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  totalValue: { fontSize: 15, fontWeight: fontWeight.semibold, color: colors.foreground, fontVariant: ['tabular-nums'] },
  totalLabel: { fontSize: 10, color: colors.mutedForeground, marginTop: 1, letterSpacing: 0.4 },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 12, marginBottom: 4,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: {
    flex: 1, backgroundColor: colors.muted, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.foreground,
  },
  addBtn: { backgroundColor: colors.primary, borderRadius: 10, height: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: colors.primaryForeground, fontSize: 13, fontWeight: fontWeight.bold },
});
