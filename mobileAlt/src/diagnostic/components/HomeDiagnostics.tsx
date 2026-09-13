import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { COPY, DX, historyRow, homeHero, type DiagnosticListRow } from '@axiom/diagnostic-core';
import { listDiagnostics } from '../api';
import { RichText } from './primitives';
import { DiagnosticPaywall } from './DiagnosticPaywall';
import { useAuth } from '../../context/AuthContext';

const C = DX.color;

/**
 * Home's diagnostic surfaces (§3): dark hero → Diagnostics list → upgrade
 * card (free only). The hero is context-aware: an unfinished conversation
 * takes it over with "Finish your … diagnostic" / Resume (§8).
 *
 * `proHero` lets Pro users keep their Coach hero when nothing is in progress.
 */
export function HomeDiagnostics({ isPro, proHero }: { isPro: boolean; proHero: React.ReactNode }) {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [rows, setRows] = useState<DiagnosticListRow[]>([]);
  const [paywall, setPaywall] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      listDiagnostics().then((r) => live && setRows(r)).catch(() => {});
      return () => { live = false; };
    }, []),
  );

  const hero = homeHero(rows);
  const openRow = (r: DiagnosticListRow) => {
    if (r.flow === 'wizard') {
      router.push({ pathname: r.status === 'complete' ? '/diagnostic/plan' : '/diagnostic/chat', params: { sessionId: r.id } });
    } else if (r.status === 'complete') {
      router.push({ pathname: '/diagnostic/report', params: { sessionId: r.id } });
    } else {
      router.push({ pathname: '/diagnostic/conversation', params: { sessionId: r.id } });
    }
  };

  return (
    <>
      {hero.kind === 'start' && isPro ? (
        proHero
      ) : (
        <TouchableOpacity
          style={styles.hero}
          activeOpacity={0.85}
          accessibilityRole="button"
          onPress={() =>
            hero.kind === 'resume'
              ? router.push({ pathname: '/diagnostic/conversation', params: { sessionId: hero.sessionId } })
              : router.push('/diagnostic/conversation')
          }
        >
          <View style={styles.heroIcon}>
            <Ionicons name={hero.kind === 'resume' ? 'chatbubble-ellipses-outline' : 'barbell-outline'} size={22} color={C.white} />
          </View>
          <View style={{ gap: 8 }}>
            <RichText text={hero.title} style={styles.heroTitle} />
            <Text style={styles.heroBody}>{hero.body}</Text>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>{hero.cta}</Text>
              <Ionicons name="arrow-forward" size={16} color={C.ink} />
            </View>
          </View>
        </TouchableOpacity>
      )}

      {rows.length ? (
        <View style={styles.listCard}>
          <Text style={styles.eyebrow}>{COPY.diagnostics}</Text>
          {rows.slice(0, 5).map((r, i) => {
            const row = historyRow(r);
            return (
              <TouchableOpacity key={r.id} style={[styles.row, i > 0 && styles.divider]} onPress={() => openRow(r)} accessibilityRole="button">
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{row.subtitle}</Text>
                </View>
                {row.confidence != null ? <Text style={styles.rowMeta}>{row.confidence}%</Text> : null}
                <Ionicons name="chevron-forward" size={16} color={C.disabled} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {!isPro ? (
        <View style={styles.upgrade}>
          <Text style={styles.upgradeTitle}>{COPY.upgradeTitle}</Text>
          <Text style={styles.upgradeBody}>{COPY.upgradeBody}</Text>
          <TouchableOpacity style={styles.upgradeCta} onPress={() => setPaywall(true)} accessibilityRole="button">
            <Text style={styles.upgradeCtaText}>{COPY.startFreeMonth}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <DiagnosticPaywall
        visible={paywall}
        source="diagnostic_report"
        onClose={() => setPaywall(false)}
        onSuccess={async () => {
          setPaywall(false);
          await refreshUser();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: C.ink, borderRadius: 20, padding: 24, minHeight: 220, justifyContent: 'space-between', gap: 20 },
  heroIcon: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.8, lineHeight: 33, color: C.white },
  heroBody: { fontSize: 14, lineHeight: 20, color: C.inverseBody },
  heroCta: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.white,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4,
  },
  heroCtaText: { fontSize: 14, fontWeight: '600', color: C.ink },
  listCard: { borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  eyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: C.surface },
  rowTitle: { fontSize: 14, fontWeight: '600', color: C.ink },
  rowSub: { fontSize: 13, color: C.muted },
  rowMeta: { fontSize: 13, fontWeight: '600', color: C.body2 },
  upgrade: { borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, gap: 6 },
  upgradeTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  upgradeBody: { fontSize: 13, lineHeight: 19, color: C.muted },
  upgradeCta: { alignSelf: 'flex-start', backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  upgradeCtaText: { fontSize: 14, fontWeight: '600', color: C.white },
});
