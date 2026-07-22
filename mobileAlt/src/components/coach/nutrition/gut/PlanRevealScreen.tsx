// Nutrition plan reveal — handoff §7.2. Register: clinical report. Numbers
// forward, hairline-ruled, citations inline. Doubles as the "living
// document" view opened later from Coach → Nutrition (mode='document').
import React, { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, Linking, StyleSheet } from 'react-native';
import { colors } from '../../../../constants/theme';
import { Eyebrow, CitationChip, EST_NOTE } from './GutPrimitives';

interface PlanSource {
  id: number; type: string; title: string; detail?: string | null; url?: string | null;
}
interface FocusNutrient {
  key: string; label: string; target: number; unit: string; why: string;
  foods: string[]; citationIds: number[];
}
export interface NutritionPlanPayload {
  plan: {
    summary: string;
    focusNutrients: FocusNutrient[];
    gutProtocol: { principles: Array<{ pillar: string; guidance: string; citationIds: number[] }> };
    supplements: Array<{ name: string; doseRange: string; rationale: string; citationIds: number[] }>;
    disclaimer: string;
    seeProfessional: boolean;
  };
  targets?: { targets: Array<{ key: string }>; focus: string[] };
  sources: PlanSource[];
}

const PILLAR_LABELS: Record<string, string> = {
  fiber: 'Fiber', plants: 'Plant diversity', ferment: 'Fermented foods',
  avoid: 'Whole foods', rhythm: 'Eating rhythm',
};

export function PlanRevealScreen({
  visible, payload, mode, onContinue, onClose,
}: {
  visible: boolean;
  payload: NutritionPlanPayload | null;
  mode: 'reveal' | 'document';
  onContinue: () => void;
  onClose: () => void;
}) {
  const [sourceOpen, setSourceOpen] = useState<PlanSource | null>(null);
  const sourceById = useMemo(() => {
    const m = new Map<number, PlanSource>();
    (payload?.sources ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [payload]);

  if (!visible || !payload) return null;
  const { plan } = payload;
  const targetCount = payload.targets?.targets?.length ?? 18;

  const cite = (ids: number[]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {ids.map((id) => {
        const src = sourceById.get(id);
        if (!src) return null;
        return <CitationChip key={id} label={`${src.type === 'podcast' ? 'Ep' : 'Ref'} · ${src.title.slice(0, 28)}`} onPress={() => setSourceOpen(src)} />;
      })}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 64, paddingBottom: 120, gap: 20 }}>
          <View style={{ gap: 8 }}>
            <Eyebrow>{mode === 'reveal' ? 'Your plan is ready' : 'Living document'}</Eyebrow>
            <Text style={{ fontSize: 27, fontWeight: '700', letterSpacing: -0.8, color: colors.foreground }}>
              Nutrition & gut protocol
            </Text>
            {!!plan.summary && (
              <Text style={{ fontSize: 14, lineHeight: 21, color: colors.mutedForeground }}>{plan.summary}</Text>
            )}
          </View>

          {/* Summary tiles */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={[styles.tile, { flex: 1 }]}>
              <Text style={styles.tileNumber}>✓</Text>
              <Text style={styles.tileLabel}>Training program</Text>
            </View>
            <View style={[styles.tile, styles.tileEmphasis, { flex: 1 }]}>
              <Text style={styles.tileNumber}>{targetCount}</Text>
              <Text style={styles.tileLabel}>nutrient targets</Text>
            </View>
          </View>

          {/* Focus nutrients — hairline-ruled list */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardTitle}>Focus Nutrients</Text>
              <Text style={{ fontSize: 10, color: '#a1a1aa' }}>{EST_NOTE}</Text>
            </View>
            {plan.focusNutrients.map((f, i) => (
              <View key={f.key} style={[styles.focusRow, i > 0 && styles.hairlineTop]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{f.label}</Text>
                  {!!f.why && <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 17 }}>{f.why}</Text>}
                  {f.foods.length > 0 && (
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 17 }}>
                      {f.foods.join(' · ')}
                    </Text>
                  )}
                  {f.citationIds.length > 0 && cite(f.citationIds)}
                </View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                  {f.target}
                  <Text style={{ fontSize: 11, fontWeight: '400', color: colors.mutedForeground }}> {f.unit}</Text>
                </Text>
              </View>
            ))}
          </View>

          {/* Gut protocol */}
          {plan.gutProtocol.principles.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Gut Protocol</Text>
              {plan.gutProtocol.principles.map((p, i) => (
                <View key={p.pillar + i} style={[{ paddingVertical: 10, gap: 2 }, i > 0 && styles.hairlineTop]}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>
                    {PILLAR_LABELS[p.pillar] ?? p.pillar}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, lineHeight: 19 }}>{p.guidance}</Text>
                  {p.citationIds.length > 0 && cite(p.citationIds)}
                </View>
              ))}
            </View>
          )}

          {/* Food-first supplements */}
          {plan.supplements.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.muted, borderColor: colors.muted }]}>
              <Text style={styles.cardTitle}>Where food alone falls short</Text>
              {plan.supplements.map((s, i) => (
                <View key={s.name + i} style={{ paddingVertical: 8, gap: 2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>{s.name}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                      {s.doseRange}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 17 }}>{s.rationale}</Text>
                  {s.citationIds.length > 0 && cite(s.citationIds)}
                </View>
              ))}
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 6 }}>
                Not medical advice. {plan.disclaimer}
              </Text>
            </View>
          )}

          {plan.seeProfessional && (
            <View style={styles.professionalNote}>
              <Text style={{ fontSize: 13, lineHeight: 19, color: colors.warningInk }}>
                Because of the condition you flagged, this plan stays general. For anything
                condition-specific, work with your clinician — bring this plan along if it helps.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable onPress={onClose} style={[styles.ghostButton, { flex: 1 }]}>
            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 14 }}>
              {mode === 'reveal' ? 'Later' : 'Close'}
            </Text>
          </Pressable>
          <Pressable onPress={onContinue} style={[styles.primaryButton, { flex: 2 }]}>
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 15 }}>
              {mode === 'reveal' ? 'Continue' : 'Done'}
            </Text>
          </Pressable>
        </View>

        {/* Source detail sheet */}
        {sourceOpen && (
          <Pressable style={styles.sheetBackdrop} onPress={() => setSourceOpen(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Eyebrow>{sourceOpen.type === 'podcast' ? 'Podcast source' : 'Reference'}</Eyebrow>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground, marginTop: 6 }}>
                {sourceOpen.title}
              </Text>
              {!!sourceOpen.detail && (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 4 }}>{sourceOpen.detail}</Text>
              )}
              {!!sourceOpen.url && (
                <Pressable onPress={() => Linking.openURL(sourceOpen.url!)} style={[styles.primaryButton, { marginTop: 16 }]}>
                  <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 14 }}>
                    Watch the clip
                  </Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.foreground, marginBottom: 4 },
  tile: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16,
    gap: 4, backgroundColor: colors.card,
  },
  tileEmphasis: { borderWidth: 1.5, borderColor: colors.foreground },
  tileNumber: { fontSize: 24, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 11, color: colors.mutedForeground },
  focusRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 12, paddingVertical: 12,
  },
  hairlineTop: { borderTopWidth: 1, borderTopColor: colors.border },
  professionalNote: {
    borderWidth: 1, borderColor: colors.warningSoft, backgroundColor: '#fffbeb',
    borderRadius: 12, padding: 14,
  },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, padding: 20, paddingBottom: 32,
    backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border,
  },
  primaryButton: {
    backgroundColor: '#09090b', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  ghostButton: {
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e4e4e7',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    justifyContent: 'center', minHeight: 48,
  },
  sheetBackdrop: {
    position: 'absolute', inset: 0, backgroundColor: 'rgba(9,9,11,0.4)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
});
