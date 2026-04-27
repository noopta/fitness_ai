import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  SafeAreaView, ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

export interface FeedItem {
  id: string;
  type: 'research' | 'article';
  title: string;
  summary: string;
  url: string;
  source: string;
  tags: string[];
  publishedAt: string | null;
  fetchedAt: string;
}

const TAG_LABEL: Record<string, string> = {
  strength: 'Strength',
  hypertrophy: 'Muscle Building',
  fat_loss: 'Fat Loss',
  nutrition: 'Nutrition',
  recovery: 'Recovery',
  cardio: 'Cardio',
  lifestyle: 'Lifestyle',
  general: 'Fitness',
};

const TAG_COLOR: Record<string, string> = {
  strength: '#6366f1',
  hypertrophy: '#8b5cf6',
  fat_loss: '#f59e0b',
  nutrition: '#f97316',
  recovery: '#22c55e',
  cardio: '#38bdf8',
  lifestyle: '#ec4899',
  general: '#64748b',
};

interface Props {
  item: FeedItem;
}

export function FeedItemCard({ item }: Props) {
  const [webViewOpen, setWebViewOpen] = useState(false);
  const [webViewLoading, setWebViewLoading] = useState(true);

  const primaryTag = item.tags[0] ?? 'general';
  const tagColor = TAG_COLOR[primaryTag] ?? TAG_COLOR.general;
  const tagLabel = TAG_LABEL[primaryTag] ?? 'Fitness';
  const isResearch = item.type === 'research';

  return (
    <>
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => setWebViewOpen(true)}
      >
        {/* Top row: type badge + source */}
        <View style={styles.topRow}>
          <View style={[styles.typeBadge, { backgroundColor: tagColor + '18' }]}>
            <Ionicons
              name={isResearch ? 'document-text-outline' : 'newspaper-outline'}
              size={11}
              color={tagColor}
            />
            <Text style={[styles.typeBadgeText, { color: tagColor }]}>
              {isResearch ? 'RESEARCH' : 'ARTICLE'}
            </Text>
          </View>
          <Text style={styles.source}>{item.source}</Text>
        </View>

        {/* Title */}
        <Text style={styles.title} numberOfLines={3}>{item.title}</Text>

        {/* GPT summary */}
        <Text style={styles.summary} numberOfLines={4}>{item.summary}</Text>

        {/* Bottom row: tag pill + read more */}
        <View style={styles.bottomRow}>
          <View style={[styles.tagPill, { backgroundColor: tagColor + '18' }]}>
            <Text style={[styles.tagPillText, { color: tagColor }]}>{tagLabel}</Text>
          </View>
          <View style={styles.readMore}>
            <Text style={styles.readMoreText}>Read more</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.mutedForeground} />
          </View>
        </View>
      </TouchableOpacity>

      {/* Full-screen WebView modal */}
      <Modal
        visible={webViewOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setWebViewOpen(false)}
      >
        <SafeAreaView style={styles.webViewContainer}>
          {/* Header */}
          <View style={styles.webViewHeader}>
            <TouchableOpacity onPress={() => setWebViewOpen(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={styles.webViewTitle} numberOfLines={1}>{item.source}</Text>
            <View style={{ width: 30 }} />
          </View>

          {/* WebView */}
          <WebView
            source={{ uri: item.url }}
            style={styles.webView}
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
            onError={() => setWebViewLoading(false)}
          />

          {/* Loading overlay */}
          {webViewLoading && (
            <View style={styles.webViewLoader}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
  },
  source: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  title: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    lineHeight: 22,
  },

  summary: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },

  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  tagPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  tagPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readMoreText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  // WebView modal
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    padding: 4,
  },
  webViewTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.xs,
  },
  webView: {
    flex: 1,
  },
  webViewLoader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
