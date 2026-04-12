import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getLogs, clearLogs, subscribeToLogs, type LogEntry } from '../lib/debugLog';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

const LEVEL_COLOR: Record<string, string> = {
  info:  '#6b7280',
  warn:  '#d97706',
  error: '#ef4444',
};

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <View style={styles.row}>
      <Text style={styles.ts}>{entry.ts}</Text>
      <Text style={[styles.level, { color: LEVEL_COLOR[entry.level] }]}>
        {entry.level.toUpperCase().padEnd(5)}
      </Text>
      <Text style={styles.msg} selectable>{entry.msg}</Text>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function DebugLogPanel({ visible, onClose }: Props) {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);

  useEffect(() => {
    if (!visible) return;
    setEntries(getLogs());
    const unsub = subscribeToLogs(() => setEntries([...getLogs()]));
    return unsub;
  }, [visible]);

  const copyAll = useCallback(async () => {
    const text = entries
      .map(e => `${e.ts} ${e.level.toUpperCase().padEnd(5)} [${e.tag}] ${e.msg}`)
      .join('\n');
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${entries.length} log entries copied to clipboard.`);
  }, [entries]);

  const handleClear = useCallback(() => {
    clearLogs();
    setEntries([]);
  }, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Debug Logs</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={copyAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 14 }}>
              <Ionicons name="copy-outline" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="trash-outline" size={20} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </View>

        {entries.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="terminal-outline" size={36} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>No logs yet. Open the upgrade sheet to trigger IAP events.</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {[...entries].reverse().map((e, i) => <LogRow key={i} entry={e} />)}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>{entries.length} entries · newest first</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: '#e6edf3',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#21262d',
    flexWrap: 'wrap',
  },
  ts: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#8b949e',
    width: 56,
  },
  level: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: fontWeight.bold,
    width: 40,
  },
  msg: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#c9d1d9',
    flex: 1,
    flexWrap: 'wrap',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: '#8b949e',
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#30363d',
    alignItems: 'center',
  },
  footerText: { fontSize: fontSize.xs, color: '#8b949e' },
});
