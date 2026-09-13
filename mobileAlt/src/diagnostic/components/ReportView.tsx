import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COPY,
  DX,
  reportSections,
  sharpenList,
  verdictHeadline,
  type Candidate,
  type Verdict,
} from '@axiom/diagnostic-core';
import { shareDiagnostic } from '../api';
import { DiagnosticRadar, EfficiencyGauge } from './Charts';
import { VideoCard, tagStyle } from './ThreadItems';
import { Eyebrow, InkButton, OutlineButton } from './primitives';

const C = DX.color;

const RANK_LABEL: Record<Candidate['rank'], string> = {
  primary: COPY.primary,
  secondary: COPY.secondary,
  ruled_out: COPY.ruledOut,
  leading: COPY.leading,
  open: COPY.open,
};

interface Props {
  verdict: Verdict;
  onClose: () => void;
  onUpgrade: () => void;
  /** Present only when re-scoring is possible from here. */
  onAddNumbers?: () => void;
  readOnly?: boolean;
}

/** Header (share · close) / verdict / evidence / charts / video / fix / track (§3). */
export function ReportView({ verdict, onClose, onUpgrade, onAddNumbers, readOnly }: Props) {
  const insets = useSafeAreaInsets();
  const { eyebrow, headline } = verdictHeadline(verdict);
  const sections = reportSections(verdict);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const share = async () => {
    try {
      const url = await shareDiagnostic(verdict.sessionId);
      await Clipboard.setStringAsync(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), DX.motion.shareConfirmMs);
    } catch {
      /* inline only — no alerts in this flow; the icon simply stays put */
    }
  };

  const basis = [
    `${verdict.ratiosLogged} ${verdict.ratiosLogged === 1 ? 'ratio' : 'ratios'}`,
    verdict.hasVideo ? 'video' : null,
    verdict.answersGiven ? `${verdict.answersGiven} ${verdict.answersGiven === 1 ? 'answer' : 'answers'}` : null,
  ].filter(Boolean).join(', ');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {!readOnly ? (
          <TouchableOpacity onPress={share} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={COPY.share}>
            <Ionicons name={copied ? 'checkmark' : 'share-outline'} size={20} color={C.ink} />
            {copied ? <Text style={styles.copied}>{COPY.linkCopied}</Text> : null}
          </TouchableOpacity>
        ) : <View />}
        <TouchableOpacity onPress={onClose} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={COPY.close}>
          <Ionicons name="close" size={22} color={C.ink} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
        <View style={{ gap: 6 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.confidence}>{COPY.confidence(verdict.confidence)} · {basis}</Text>
        </View>

        {verdict.evidence.length ? (
          <Section title={COPY.evidence}>
            {verdict.evidence.map((e, i) => (
              <View key={i} style={[styles.evidenceRow, i > 0 && styles.divider]}>
                <Text style={tagStyle}>{e.tag}</Text>
                <Text style={styles.evidenceText}>{e.text}</Text>
              </View>
            ))}
          </Section>
        ) : null}

        {verdict.candidates.length ? (
          <Section title={COPY.candidates}>
            {verdict.candidates.map((c, i) => (
              <View key={c.key} style={[styles.candidateRow, i > 0 && styles.divider]}>
                <Text style={[styles.candidateLabel, c.rank === 'ruled_out' && { color: C.muted }]}>{c.label}</Text>
                <Text style={[styles.rank, (c.rank === 'primary' || c.rank === 'leading') && styles.rankStrong]}>
                  {RANK_LABEL[c.rank]}
                  {c.score != null ? ` · ${c.score}` : ''}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}

        {sections.charts && verdict.charts ? (
          <View style={styles.chartsRow}>
            {Object.keys(verdict.charts.indices).length ? (
              <View style={[styles.card, styles.chartCard]}>
                <Eyebrow>{COPY.strengthProfile}</Eyebrow>
                <DiagnosticRadar lift={verdict.lift} indices={verdict.charts.indices} size={150} />
              </View>
            ) : null}
            <View style={[styles.card, styles.chartCard]}>
              <Eyebrow>{COPY.efficiency}</Eyebrow>
              <EfficiencyGauge score={verdict.charts.efficiency} size={130} />
            </View>
          </View>
        ) : null}

        {sections.notEnoughLiftsNote ? (
          <View style={[styles.card, styles.mutedCard]}>
            <Text style={styles.note}>{COPY.notEnoughLifts}</Text>
          </View>
        ) : null}

        {sections.validationTest && verdict.validationTest ? (
          <Section title={COPY.validationTest}>
            <Text style={styles.cardTitle}>{verdict.validationTest.description}</Text>
            <Text style={styles.bodyText}>{verdict.validationTest.howToRun}</Text>
          </Section>
        ) : null}

        {sections.sharpen ? (
          <Section title={COPY.sharpenThis}>
            {sharpenList(verdict).map((s) => (
              <View key={s} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bodyText}>{s}</Text>
              </View>
            ))}
            {onAddNumbers && verdict.missingLifts.length ? (
              <OutlineButton label={COPY.addMissingNumbers} onPress={onAddNumbers} style={{ marginTop: 8 }} />
            ) : null}
          </Section>
        ) : null}

        {verdict.video ? <VideoCard result={verdict.video} animate={false} /> : null}

        <FixSection verdict={verdict} onUpgrade={onUpgrade} readOnly={readOnly} />

        {verdict.trackNextTime.length ? (
          <Section title={COPY.trackNextTime}>
            {verdict.trackNextTime.map((t) => (
              <View key={t} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bodyText}>{t}</Text>
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FixSection({ verdict, onUpgrade, readOnly }: { verdict: Verdict; onUpgrade: () => void; readOnly?: boolean }) {
  const fix = verdict.fix;
  if (fix.locked) {
    // 0 ratios: the paywall sells the confirmation test, not a protocol (§7).
    const title = verdict.grade === 0 ? COPY.confirmLockedTitle : COPY.fixLockedTitle;
    const body = verdict.grade === 0 ? COPY.confirmLockedBody : COPY.fixLockedBody(fix.accessoryCount);
    return (
      <View style={styles.inverse}>
        <Ionicons name="lock-closed-outline" size={18} color={C.white} />
        <Text style={styles.inverseTitle}>{title}</Text>
        <Text style={styles.inverseBody}>{body}</Text>
        {!readOnly ? (
          <>
            <InkButton label={COPY.startFreeMonth} onPress={onUpgrade} inverse style={{ marginTop: 6 }} />
            <Text style={styles.inverseFine}>{COPY.freeMonthFine}</Text>
          </>
        ) : null}
      </View>
    );
  }
  return (
    <Section title={COPY.fixTitle}>
      <View style={styles.protocolRow}>
        <Text style={styles.cardTitle}>{fix.primary.name}</Text>
        <Text style={styles.protocolMeta}>
          {fix.primary.sets} × {fix.primary.reps} · {fix.primary.intensity} · {fix.primary.restMinutes} min rest
        </Text>
      </View>
      {fix.accessories.map((a) => (
        <View key={a.exerciseId + a.name} style={[styles.protocolRow, styles.divider]}>
          <Text style={styles.cardTitle}>{a.name}</Text>
          <Text style={styles.protocolMeta}>{a.sets} × {a.reps}</Text>
          <Text style={styles.bodyText}>{a.why}</Text>
        </View>
      ))}
      {fix.progression.length ? (
        <View style={[styles.protocolRow, styles.divider]}>
          <Eyebrow>{COPY.progression}</Eyebrow>
          {fix.progression.map((p) => (
            <Text key={p} style={styles.bodyText}>{p}</Text>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Eyebrow style={{ marginBottom: 4 }}>{title}</Eyebrow>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, height: 52 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, minWidth: 44, minHeight: 44 },
  copied: { fontSize: 13, fontWeight: '600', color: C.muted },
  body: { paddingHorizontal: 16, gap: 14 },
  headline: { fontSize: 30, fontWeight: '700', letterSpacing: -1.05, lineHeight: 35, color: C.ink },
  confidence: { fontSize: 13, fontWeight: '600', color: C.muted },
  card: { borderRadius: DX.card.radius, borderWidth: 1, borderColor: C.border, padding: DX.card.pad, gap: 8, backgroundColor: C.white },
  mutedCard: { backgroundColor: C.surface, borderColor: C.surface },
  chartsRow: { flexDirection: 'row', gap: 10 },
  chartCard: { flex: 1, alignItems: 'center' },
  evidenceRow: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: C.surface },
  evidenceText: { flex: 1, fontSize: 14, lineHeight: 20, color: C.body },
  candidateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, gap: 12 },
  candidateLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  rank: { fontSize: 12, fontWeight: '600', color: C.muted },
  rankStrong: { color: C.ink },
  note: { fontSize: 14, lineHeight: 20, color: C.body2 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  bodyText: { flex: 1, fontSize: 14, lineHeight: 20, color: C.body },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, lineHeight: 20, color: C.disabled },
  inverse: { borderRadius: DX.card.radiusLarge, backgroundColor: C.ink, padding: DX.card.padLarge, gap: 8 },
  inverseTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5, color: C.white },
  inverseBody: { fontSize: 14, lineHeight: 20, color: C.inverseBody },
  inverseFine: { fontSize: 12, color: C.inverseBody, textAlign: 'center' },
  protocolRow: { gap: 3, paddingVertical: 8 },
  protocolMeta: { fontSize: 13, fontWeight: '600', color: C.muted },
});
