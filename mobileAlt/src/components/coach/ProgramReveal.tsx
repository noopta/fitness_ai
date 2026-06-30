import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { Reveal } from '../../onboarding/motion/Reveal';
import {
  BRAND_CERTIFICATIONS, BRAND_SCIENCE_PAGES, studiesCitedCount, refsForSection,
  buildPhases, buildExercises, buildVolumeTiles, buildNutrition, firstNameOf,
  type RevealSource, type RevealSection,
} from './revealModel';

// ─── Spec tokens (design spec §3) ───────────────────────────────────────────────
// A few values aren't in the shared theme; define them here, scoped to this screen.
const T = {
  fg: '#09090b',
  fgMuted: '#52525b',
  fgSubtle: '#71717a',
  fgFaint: '#a1a1aa',
  bg: '#ffffff',
  bgMuted: '#f4f4f5',
  border: '#e4e4e7',
  borderStrong: '#d4d4d8',
  successFill: '#22c55e',
  successSoft: '#dcfce7',
  successBorder: '#bbf7d0',
  successInk: '#15803d',
};
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

interface ProgramRevealProps {
  program: any;
  /** Advances forward in the funnel (→ review/paywall). Spec: forward-only CTA. */
  onNext: () => void;
  onBack?: () => void;
  /** Onboarding step label, e.g. "Step 4 of 4". Omitted when not provided. */
  stepLabel?: string;
}

const SECTION_META: Array<{ key: RevealSection; index: string; eyebrow: string }> = [
  { key: 'periodization', index: '01', eyebrow: 'PERIODIZATION' },
  { key: 'exercise', index: '02', eyebrow: 'EXERCISE SELECTION' },
  { key: 'volume', index: '03', eyebrow: 'VOLUME & INTENSITY' },
  { key: 'nutrition', index: '04', eyebrow: 'NUTRITION' },
];

export function ProgramReveal({ program, onNext, onBack, stepLabel }: ProgramRevealProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const model = useMemo(() => {
    const sources: RevealSource[] = Array.isArray(program?.sources) ? program.sources : [];
    return {
      firstName: firstNameOf(user?.name),
      durationWeeks: Number(program?.durationWeeks) || null,
      sources,
      studiesCited: studiesCitedCount(sources),
      phases: buildPhases(program),
      exercises: buildExercises(program),
      volume: buildVolumeTiles(program),
      nutrition: buildNutrition(program),
    };
  }, [program, user?.name]);

  const { firstName, durationWeeks, sources, studiesCited, phases, exercises, volume, nutrition } = model;
  const ctaPad = Math.max(insets.bottom + 12, 26);

  // A ref chip renders only when the section actually has backing sources.
  const RefChips = ({ section }: { section: RevealSection }) => {
    const refs = refsForSection(sources, section);
    if (refs.length === 0) return null;
    return (
      <>
        {refs.map((r) => (
          <Text key={r.id} style={styles.refChip}>
            {sources.indexOf(r) + 1}
          </Text>
        ))}
      </>
    );
  };

  let block = 0; // running stagger index for the entrance animation

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Block A · Completion marker ───────────────────────────────── */}
        <Reveal index={block++}>
          <View style={styles.completionRow}>
            <View style={styles.successPill}>
              <View style={styles.successCheck}>
                <Ionicons name="checkmark" size={11} color="#ffffff" />
              </View>
              <Text style={styles.successPillText}>Program generated</Text>
            </View>
            {!!stepLabel && <Text style={styles.stepIndicator}>{stepLabel}</Text>}
          </View>
        </Reveal>

        {/* ── Block B · Title ───────────────────────────────────────────── */}
        <Reveal index={block++}>
          <View style={styles.titleBlock}>
            {!!durationWeeks && (
              <Text style={styles.eyebrow}>YOUR {durationWeeks}-WEEK PLAN</Text>
            )}
            <Text style={styles.headline}>Engineered around you, {firstName}.</Text>
            <Text style={styles.subhead}>
              Built from your working weights, training history, and the constraints you logged —
              then checked against the literature, line by line.
            </Text>
          </View>
        </Reveal>

        {/* ── Block C · Credentials hero (dark) ─────────────────────────── */}
        <Reveal index={block++}>
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>CONSTRUCTED FROM</Text>
            <View style={styles.heroStatRow}>
              <HeroStat value={String(BRAND_CERTIFICATIONS)} label={'trainer\ncertifications'} flex={1} first />
              <HeroStat value={BRAND_SCIENCE_PAGES.toLocaleString()} label={'pages of\nsports science'} flex={1.2} />
              {studiesCited > 0 && (
                <HeroStat value={String(studiesCited)} label={'studies cited\nin your plan'} flex={1} />
              )}
            </View>
            <View style={styles.heroDivider} />
            <Text style={styles.heroFooter}>
              {studiesCited > 0
                ? 'Every choice below traces back to peer-reviewed evidence. Tap a '
                : 'Every choice below is built on certified strength-and-conditioning science.'}
              {studiesCited > 0 && <Text style={styles.heroRefChip}> ref </Text>}
              {studiesCited > 0 ? ' to see the source.' : ''}
            </Text>
          </View>
        </Reveal>

        {/* ── Block D · Construction sections ───────────────────────────── */}
        {/* 01 Periodization */}
        {phases.length > 0 && (
          <Reveal index={block++}>
            <ConstructionSection meta={SECTION_META[0]} first refs={<RefChips section="periodization" />}>
              <Text style={styles.sectionTitle}>
                {phases.length === 1 ? 'A focused block, built to peak you.' : `${phases.length} phases, sequenced to peak you.`}
              </Text>
              {!!phases[0].rationale && <Text style={styles.rationale}>{phases[0].rationale}</Text>}
              <View style={styles.phaseBar}>
                {phases.map((p, i) => (
                  <View
                    key={i}
                    style={[
                      styles.phaseChip,
                      { flex: p.weeks },
                      p.isCurrent ? styles.phaseChipCurrent : styles.phaseChipRest,
                    ]}
                  >
                    <Text style={[styles.phaseChipName, p.isCurrent && styles.phaseChipNameCurrent]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[styles.phaseChipWeeks, p.isCurrent && styles.phaseChipWeeksCurrent]} numberOfLines={1}>
                      {p.weeksLabel}
                    </Text>
                  </View>
                ))}
              </View>
            </ConstructionSection>
          </Reveal>
        )}

        {/* 02 Exercise selection */}
        {exercises.length > 0 && (
          <Reveal index={block++}>
            <ConstructionSection meta={SECTION_META[1]} refs={<RefChips section="exercise" />}>
              <Text style={styles.sectionTitle}>Chosen for your body, not a template.</Text>
              <View style={{ gap: 8 }}>
                {exercises.map((ex, i) => (
                  <View key={i} style={styles.exerciseCard}>
                    <View style={styles.exerciseTop}>
                      <Text style={styles.exerciseName} numberOfLines={1}>{ex.name}</Text>
                      {!!ex.tag && <Text style={styles.exerciseTag}>{ex.tag}</Text>}
                    </View>
                    {!!ex.reason && <Text style={styles.exerciseReason}>{ex.reason}</Text>}
                  </View>
                ))}
              </View>
            </ConstructionSection>
          </Reveal>
        )}

        {/* 03 Volume & intensity */}
        {volume.length > 0 && (
          <Reveal index={block++}>
            <ConstructionSection meta={SECTION_META[2]} refs={<RefChips section="volume" />}>
              <Text style={styles.sectionTitle}>Dosed for adaptation, not exhaustion.</Text>
              <View style={styles.statTileRow}>
                {volume.map((t, i) => (
                  <View key={i} style={styles.statTile}>
                    <Text style={styles.statTileValue}>{t.value}</Text>
                    <Text style={styles.statTileLabel}>{t.label}</Text>
                  </View>
                ))}
              </View>
            </ConstructionSection>
          </Reveal>
        )}

        {/* 04 Nutrition */}
        {nutrition && (
          <Reveal index={block++}>
            <ConstructionSection meta={SECTION_META[3]} refs={<RefChips section="nutrition" />}>
              <Text style={styles.sectionTitle}>Fuel matched to the work.</Text>
              <View style={styles.nutritionContainer}>
                <View style={styles.nutritionStatRow}>
                  {nutrition.proteinG != null && (
                    <NutritionStat value={`${nutrition.proteinG} g`} label="Protein" />
                  )}
                  {nutrition.calories != null && (
                    <NutritionStat value={nutrition.calories.toLocaleString()} label="Calories" last={nutrition.percents == null} />
                  )}
                  {nutrition.percents && (
                    <NutritionStat value={`${nutrition.percents.protein}%`} label="From protein" last />
                  )}
                </View>
                {nutrition.percents && (
                  <>
                    <View style={styles.macroBar}>
                      <View style={[styles.macroSeg, { flex: nutrition.percents.protein, backgroundColor: T.fg }]} />
                      <View style={[styles.macroSeg, { flex: nutrition.percents.carbs, backgroundColor: T.fgSubtle }]} />
                      <View style={[styles.macroSeg, { flex: nutrition.percents.fat, backgroundColor: T.borderStrong }]} />
                    </View>
                    <View style={styles.legendRow}>
                      <Legend color={T.fg} label={`Protein ${nutrition.percents.protein}%`} />
                      <Legend color={T.fgSubtle} label={`Carbs ${nutrition.percents.carbs}%`} />
                      <Legend color={T.borderStrong} label={`Fat ${nutrition.percents.fat}%`} />
                    </View>
                  </>
                )}
              </View>
            </ConstructionSection>
          </Reveal>
        )}

        {/* ── Block E · Sources cited ───────────────────────────────────── */}
        {sources.length > 0 && (
          <Reveal index={block++}>
            <View style={styles.sourcesBlock}>
              <Text style={styles.sourcesTitle}>Sources cited</Text>
              {sources.map((s, i) => (
                <View key={s.id} style={styles.sourceRow}>
                  <Text style={styles.sourceIndex}>{String(i + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sourceName}>{s.source}</Text>
                    {!!s.chapter && <Text style={styles.sourceMeta}>{s.chapter}</Text>}
                  </View>
                </View>
              ))}
              <Text style={styles.sourcesFootnote}>
                Drawn from the certified science library that informed your plan.
              </Text>
            </View>
          </Reveal>
        )}
      </ScrollView>

      {/* ── Block F · Pinned CTA (frosted) ──────────────────────────────── */}
      <BlurView intensity={28} tint="light" style={[styles.ctaBar, { paddingBottom: ctaPad }]}>
        <View style={styles.ctaInner}>
          {!!onBack && (
            <Pressable onPress={onBack} hitSlop={10} style={styles.ctaBack}>
              <Ionicons name="chevron-back" size={20} color={T.fgSubtle} />
            </Pressable>
          )}
          <Pressable
            onPress={onNext}
            style={({ pressed }) => [styles.ctaButton, pressed && { opacity: 0.82 }]}
            accessibilityRole="button"
            accessibilityLabel="See your plan"
          >
            <Text style={styles.ctaButtonText}>See your plan</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" />
          </Pressable>
        </View>
        <Text style={styles.ctaMicrocopy}>
          {durationWeeks ? `${durationWeeks} weeks · ` : ''}adapts every session you log
        </Text>
      </BlurView>
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

function HeroStat({ value, label, flex, first }: { value: string; label: string; flex: number; first?: boolean }) {
  return (
    <View style={[styles.heroStat, { flex }, !first && styles.heroStatDivider]}>
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function ConstructionSection({
  meta, first, refs, children,
}: {
  meta: { index: string; eyebrow: string };
  first?: boolean;
  refs?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, !first && styles.sectionDivider]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionIndex}>{meta.index}</Text>
        <Text style={styles.sectionEyebrow}>{meta.eyebrow}</Text>
        <View style={styles.sectionRefs}>{refs}</View>
      </View>
      {children}
    </View>
  );
}

function NutritionStat({ value, label, last }: { value: string; label: string; last?: boolean }) {
  return (
    <View style={[styles.nutritionStat, !last && styles.nutritionStatDivider]}>
      <Text style={styles.nutritionStatValue}>{value}</Text>
      <Text style={styles.nutritionStatLabel}>{label}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────────

const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, gap: 24 },

  // Block A
  completionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  successPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: T.successSoft, borderWidth: 1, borderColor: T.successBorder,
    borderRadius: 9999, paddingTop: 5, paddingBottom: 5, paddingLeft: 7, paddingRight: 11,
  },
  successCheck: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: T.successFill,
    alignItems: 'center', justifyContent: 'center',
  },
  successPillText: { fontSize: 11, fontWeight: '700', color: T.successInk },
  stepIndicator: { fontFamily: MONO, fontSize: 10.5, letterSpacing: 1, color: T.fgFaint, textTransform: 'uppercase' },

  // Block B
  titleBlock: { gap: 10 },
  eyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5, color: T.fgSubtle, textTransform: 'uppercase' },
  headline: { fontSize: 33, lineHeight: 34, fontWeight: '800', letterSpacing: -1, color: T.fg },
  subhead: { fontSize: 14.5, lineHeight: 22, color: T.fgMuted },

  // Block C — dark hero
  hero: {
    backgroundColor: T.fg, borderRadius: 22, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.5, shadowRadius: 50, elevation: 12,
  },
  heroEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' },
  heroStatRow: { flexDirection: 'row', marginTop: 16 },
  heroStat: { paddingHorizontal: 12 },
  heroStatDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.14)' },
  heroStatValue: { ...numeric, fontSize: 30, fontWeight: '800', letterSpacing: -0.9, color: '#ffffff' },
  heroStatLabel: { fontSize: 10.5, lineHeight: 14, color: 'rgba(255,255,255,0.62)', marginTop: 6 },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 16 },
  heroFooter: { fontSize: 12.5, lineHeight: 19, color: 'rgba(255,255,255,0.82)' },
  heroRefChip: {
    fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.82)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 4,
  },

  // Block D — construction sections
  section: { gap: 12 },
  sectionDivider: { borderTopWidth: 1, borderTopColor: T.border, paddingTop: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionIndex: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: T.fg },
  sectionEyebrow: { flex: 1, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5, color: T.fgSubtle, textTransform: 'uppercase' },
  sectionRefs: { flexDirection: 'row', gap: 4 },
  sectionTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, color: T.fg },
  rationale: { fontSize: 13.5, lineHeight: 21, color: T.fgMuted },
  refChip: {
    fontFamily: MONO, fontSize: 9, fontWeight: '700', color: T.fgSubtle,
    borderWidth: 1, borderColor: T.borderStrong, borderRadius: 5,
    minWidth: 16, height: 15, lineHeight: 14, textAlign: 'center', overflow: 'hidden',
  },

  // Periodization phase bar
  phaseBar: { flexDirection: 'row', gap: 5, marginTop: 2 },
  phaseChip: { height: 54, borderRadius: 9, padding: 8, justifyContent: 'space-between' },
  phaseChipCurrent: { backgroundColor: T.fg },
  phaseChipRest: { backgroundColor: T.bgMuted, borderWidth: 1, borderColor: T.border },
  phaseChipName: { fontSize: 11, fontWeight: '700', color: T.fg },
  phaseChipNameCurrent: { color: '#ffffff' },
  phaseChipWeeks: { fontSize: 9.5, color: T.fgSubtle },
  phaseChipWeeksCurrent: { color: 'rgba(255,255,255,0.7)' },

  // Exercise cards
  exerciseCard: { borderWidth: 1, borderColor: T.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, gap: 4 },
  exerciseTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  exerciseName: { flex: 1, fontSize: 14, fontWeight: '700', color: T.fg },
  exerciseTag: { fontFamily: MONO, fontSize: 11, color: T.fgSubtle },
  exerciseReason: { fontSize: 12, lineHeight: 17, color: T.fgMuted },

  // Volume stat tiles
  statTileRow: { flexDirection: 'row', gap: 8 },
  statTile: { flex: 1, borderWidth: 1, borderColor: T.border, borderRadius: 12, padding: 13, gap: 6 },
  statTileValue: { ...numeric, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: T.fg },
  statTileLabel: { fontSize: 11, lineHeight: 14, color: T.fgSubtle },

  // Nutrition
  nutritionContainer: { borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, gap: 14 },
  nutritionStatRow: { flexDirection: 'row' },
  nutritionStat: { flex: 1, paddingHorizontal: 12 },
  nutritionStatDivider: { borderRightWidth: 1, borderRightColor: T.border },
  nutritionStatValue: { ...numeric, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: T.fg },
  nutritionStatLabel: { fontSize: 11, color: T.fgSubtle, marginTop: 4 },
  macroBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 0 },
  macroSeg: { height: 8 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: T.fgSubtle },

  // Block E — sources
  sourcesBlock: { borderTopWidth: 1, borderTopColor: T.border, paddingTop: 24, gap: 12 },
  sourcesTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, color: T.fg },
  sourceRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  sourceIndex: { fontFamily: MONO, fontSize: 10, fontWeight: '700', color: T.fg, width: 16, marginTop: 2 },
  sourceName: { fontSize: 11.5, lineHeight: 16, fontWeight: '600', color: T.fg },
  sourceMeta: { fontSize: 11.5, lineHeight: 16, color: T.fgMuted },
  sourcesFootnote: { fontSize: 11, color: T.fgFaint, marginTop: 2 },

  // Block F — pinned CTA
  ctaBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: 1, borderTopColor: T.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 20, paddingTop: 12, gap: 8,
  },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaBack: {
    width: 44, height: 52, borderRadius: 14, borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaButton: {
    flex: 1, height: 52, borderRadius: 14, backgroundColor: T.fg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  ctaButtonText: { fontSize: 15.5, fontWeight: '700', color: '#ffffff' },
  ctaMicrocopy: { fontSize: 11, color: T.fgSubtle, textAlign: 'center' },
});
