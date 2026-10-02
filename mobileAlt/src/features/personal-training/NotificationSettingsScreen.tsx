// Notification settings (design handoff §6.7): a delivery tier per event type,
// a live estimate of how often the trainer will be interrupted, channels,
// quiet hours and per-client overrides. Every change saves on its own.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import {
  COPY, hourLabel,
  type MeResponse, type NotificationGroup, type NotificationOverride, type NotificationSettings, type Tier,
} from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, MAX_FONT_SCALE, Notice } from './components';
import { ActionButton, FeedbackText, IconButton, PickerField, SegmentedControl, SwitchRow, TextArea } from './controls';
import { useNotificationSettings, useRoster, useSaveNotificationSettings } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { Screen } from './Screen';
import { OptionSheet, type Option } from './Sheet';

const TIERS: Tier[] = ['immediate', 'briefing', 'timeline'];
const GROUPS: NotificationGroup[] = ['Safety', 'Engagement', 'Client activity', 'Insights'];
const HOURS: Option<number>[] = Array.from({ length: 24 }, (_, value) => ({ value, label: hourLabel(value) }));
const TIER_OPTIONS: Option<Tier>[] = TIERS.map((value) => ({ value, label: COPY.notifications.tiers[value] }));
const stripNames = (overrides: NotificationOverride[]) => overrides.map(({ clientName: _n, ...o }) => o);

type Picker = 'start' | 'end' | 'client' | 'event' | 'tier' | null;

function Settings({ settings }: { settings: NotificationSettings }) {
  const save = useSaveNotificationSettings();
  const roster = useRoster();
  const [draft, setDraft] = useState<{ clientId: string; eventType: string; tier: Tier; note: string }>({ clientId: '', eventType: '*', tier: 'immediate', note: '' });
  const [picker, setPicker] = useState<Picker>(null);
  const clients = roster.data?.clients ?? [];
  const eventOptions: Option<string>[] = [{ value: '*', label: COPY.notifications.allEvents }, ...settings.rules.map((r) => ({ value: r.eventType, label: r.label }))];
  const eventLabel = (eventType: string) => (eventType === '*' ? COPY.notifications.allEvents : settings.rules.find((r) => r.eventType === eventType)?.label ?? eventType);
  const closePicker = () => setPicker(null);

  function addOverride() {
    if (!draft.clientId) return;
    const rest = settings.overrides.filter((o) => !(o.clientId === draft.clientId && o.eventType === draft.eventType));
    save.mutate(
      { overrides: [...stripNames(rest), { clientId: draft.clientId, eventType: draft.eventType, tier: draft.tier, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }] },
      { onSuccess: () => setDraft((d) => ({ ...d, clientId: '', note: '' })) },
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.block}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={styles.estimate}>{COPY.notifications.estimate(settings.weeklyEstimate)}</Text>
        <View style={styles.counts}>
          {TIERS.map((t) => (
            <Text key={t} maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.count}>
              {`${COPY.notifications.tiers[t]} `}
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.countValue}>{settings.tierCounts[t]}</Text>
            </Text>
          ))}
        </View>
        {save.isError && <FeedbackText error>{(save.error as Error).message || COPY.notifications.saveFailed}</FeedbackText>}
        {save.isSuccess && <FeedbackText>{COPY.notifications.saved}</FeedbackText>}
      </View>

      {GROUPS.map((group) => {
        const rules = settings.rules.filter((r) => r.group === group);
        if (rules.length === 0) return null;
        return (
          <View key={group} style={styles.block}>
            <Eyebrow>{group}</Eyebrow>
            <View style={styles.card}>
              {rules.map((r, i) => (
                <View key={r.eventType} style={[styles.rule, i > 0 && styles.rowBorder]}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>{r.label}</Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.captionNumber}>
                    {r.locked ? `${COPY.notifications.perWeek(r.perWeek)} · ${COPY.notifications.locked}` : COPY.notifications.perWeek(r.perWeek)}
                  </Text>
                  <SegmentedControl
                    label={r.label}
                    value={r.tier}
                    onChange={(tier) => save.mutate({ rules: { [r.eventType]: tier } })}
                    // Pain and injury can never be recorded silently: the segment is disabled, and the caption above says why.
                    options={TIERS.map((t) => ({ value: t, label: COPY.notifications.tiers[t], disabled: !!r.locked && t === 'timeline' }))}
                  />
                </View>
              ))}
            </View>
          </View>
        );
      })}

      <View style={styles.block}>
        <Eyebrow>{COPY.notifications.channels}</Eyebrow>
        <View style={styles.card}>
          {(['push', 'email'] as const).map((c, i) => (
            <View key={c} style={[styles.channel, i > 0 && styles.rowBorder]}>
              <SwitchRow label={COPY.notifications[c]} value={settings.channels[c]} onValueChange={(v) => save.mutate({ channels: { [c]: v } })} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.notifications.quietHours}</Eyebrow>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.help}>{COPY.notifications.quietHelp}</Text>
        <View style={styles.pair}>
          {(['start', 'end'] as const).map((edge) => {
            const label = edge === 'start' ? COPY.notifications.from : COPY.notifications.to;
            return (
              <View key={edge} style={styles.flex}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.fieldLabel}>{label}</Text>
                <PickerField label={label} value={hourLabel(settings.quietHours[edge])} onPress={() => setPicker(edge)} />
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.notifications.overrides}</Eyebrow>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.help}>{COPY.notifications.overridesHelp}</Text>
        {settings.overrides.length > 0 && (
          <View style={styles.card}>
            {settings.overrides.map((o, i) => (
              <View key={`${o.clientId}-${o.eventType}`} style={[styles.override, i > 0 && styles.rowBorder]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.overrideText}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>{o.clientName ?? MOBILE_COPY.notifications.clientFallback}</Text>
                  {`: ${eventLabel(o.eventType).toLowerCase()} → ${COPY.notifications.tiers[o.tier].toLowerCase()}${o.note ? ` · ${o.note}` : ''}`}
                </Text>
                <IconButton
                  icon={Trash2}
                  label={`${COPY.notifications.removeOverride}: ${o.clientName ?? MOBILE_COPY.notifications.clientFallback}`}
                  onPress={() => save.mutate({ overrides: stripNames(settings.overrides.filter((_, j) => j !== i)) })}
                />
              </View>
            ))}
          </View>
        )}
        {roster.isError && <FeedbackText error>{COPY.roster.loadFailed}</FeedbackText>}
        <PickerField
          label={MOBILE_COPY.notifications.client}
          value={clients.find((c) => c.id === draft.clientId)?.name ?? MOBILE_COPY.notifications.client}
          disabled={clients.length === 0}
          onPress={() => setPicker('client')}
        />
        <View style={styles.pair}>
          <PickerField style={styles.flex} label={MOBILE_COPY.notifications.event} value={eventLabel(draft.eventType)} onPress={() => setPicker('event')} />
          <PickerField style={styles.flex} label={MOBILE_COPY.notifications.tier} value={COPY.notifications.tiers[draft.tier]} onPress={() => setPicker('tier')} />
        </View>
        <TextArea
          multiline={false}
          accessibilityLabel={COPY.notifications.overrideNote}
          value={draft.note}
          maxLength={120}
          placeholder={COPY.notifications.overrideNotePlaceholder}
          onChangeText={(note) => setDraft((d) => ({ ...d, note }))}
        />
        <ActionButton variant="secondary" disabled={!draft.clientId || save.isPending} onPress={addOverride}>{COPY.notifications.addOverride}</ActionButton>
      </View>

      <OptionSheet
        visible={picker === 'start' || picker === 'end'}
        onClose={closePicker}
        title={picker === 'end' ? COPY.notifications.to : COPY.notifications.from}
        options={HOURS}
        value={picker === 'end' ? settings.quietHours.end : settings.quietHours.start}
        onSelect={(hour) => { if (picker === 'start' || picker === 'end') save.mutate({ quietHours: { ...settings.quietHours, [picker]: hour } }); }}
      />
      <OptionSheet
        visible={picker === 'client'}
        onClose={closePicker}
        title={MOBILE_COPY.notifications.client}
        options={clients.map((c) => ({ value: c.id, label: c.name }))}
        value={draft.clientId || null}
        onSelect={(clientId) => setDraft((d) => ({ ...d, clientId }))}
      />
      <OptionSheet visible={picker === 'event'} onClose={closePicker} title={MOBILE_COPY.notifications.event} options={eventOptions} value={draft.eventType} onSelect={(eventType) => setDraft((d) => ({ ...d, eventType }))} />
      <OptionSheet visible={picker === 'tier'} onClose={closePicker} title={MOBILE_COPY.notifications.tier} options={TIER_OPTIONS} value={draft.tier} onSelect={(tier) => setDraft((d) => ({ ...d, tier }))} />
    </ScrollView>
  );
}

export function NotificationSettingsScreen({ me }: { me: MeResponse }) {
  const settings = useNotificationSettings();
  return (
    <Screen me={me} title={COPY.notifications.title} active={null} back>
      {settings.isPending ? (
        <View style={styles.loading} accessibilityState={{ busy: true }}><Skeleton width={240} height={28} /><Skeleton height={240} /></View>
      ) : settings.isError ? (
        <Notice alert action={<ActionButton variant="secondary" onPress={() => settings.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.notifications.loadFailed}</Notice>
      ) : (
        <Settings settings={settings.data} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { padding: spacing.md, gap: 12 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },
  block: { gap: spacing.sm },
  estimate: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, letterSpacing: -0.2, color: colors.foreground },
  counts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4 },
  count: { fontSize: 12, color: colors.zinc600 },
  countValue: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.foreground, fontVariant: ['tabular-nums'] },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  rule: { padding: 12, gap: 6 },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  captionNumber: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  channel: { paddingHorizontal: 12 },
  help: { fontSize: 12, lineHeight: 17, color: colors.zinc600 },
  pair: { flexDirection: 'row', gap: spacing.sm },
  fieldLabel: { marginBottom: 4, fontSize: 12, color: colors.zinc600 },
  override: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  overrideText: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.foreground },
});
