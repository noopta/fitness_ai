import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/constants/theme';
import { socialApi, formAnalysisApi } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';

// AsyncStorage key for the most-recent form-analysis id the user has seen.
// Used to gate the Diagnostics tab badge — count = analyses with status
// 'complete' whose createdAt is newer than the last-viewed id's row.
const LAST_SEEN_FORM_KEY = 'diagnostics-tab:last-seen-form-id:v1';

function DiagnosticsTabIcon({ color, size, count }: { color: string; size: number; count: number }) {
  return (
    <View>
      <Ionicons name="analytics-outline" size={size} color={color} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </View>
  );
}

function SocialTabIcon({ color, size, totalCount }: { color: string; size: number; totalCount: number }) {
  return (
    <View>
      <Ionicons name="people-outline" size={size} color={color} />
      {totalCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{totalCount > 99 ? '99+' : totalCount}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const { user } = useAuth();
  const [socialCount, setSocialCount] = useState(0);
  // Count of completed form-video analyses the user hasn't viewed since
  // last visit to the Diagnostics tab. The Diagnostics screen itself marks
  // everything as seen on mount (handled inside (tabs)/history.tsx).
  const [diagnosticsCount, setDiagnosticsCount] = useState(0);

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    try {
      const data = await socialApi.getNotificationCounts();
      setSocialCount(data.total ?? 0);
    } catch { /* silent */ }
    // Form-analyses unseen count — separate try/catch so a social fetch
    // failure doesn't take this one down with it.
    try {
      const [list, lastSeen] = await Promise.all([
        formAnalysisApi.list(),
        AsyncStorage.getItem(LAST_SEEN_FORM_KEY).catch(() => null),
      ]);
      const analyses = Array.isArray(list?.analyses) ? list.analyses : [];
      // Find the createdAt of the lastSeen id (if any), then count complete
      // analyses newer than that. Sorted server-side by createdAt desc.
      const seenIdx = lastSeen ? analyses.findIndex((a) => a.id === lastSeen) : -1;
      const newer = seenIdx >= 0 ? analyses.slice(0, seenIdx) : analyses;
      setDiagnosticsCount(newer.filter((a) => a.status === 'complete').length);
    } catch { /* silent */ }
  }, [user]);

  // Poll on mount and whenever the app comes to foreground
  useEffect(() => {
    fetchCounts();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchCounts();
    });
    // Refresh every 60 seconds while app is open
    const interval = setInterval(fetchCounts, 60_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [fetchCounts]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Diagnostics',
          tabBarIcon: ({ color, size }) => (
            <DiagnosticsTabIcon color={color} size={size} count={diagnosticsCount} />
          ),
        }}
        // Mark all-seen the moment the user taps the tab so the badge
        // clears even before the screen finishes its own first paint.
        listeners={{
          tabPress: () => {
            void (async () => {
              try {
                const list = await formAnalysisApi.list();
                const top = Array.isArray(list?.analyses) && list.analyses.length > 0 ? list.analyses[0].id : null;
                if (top) await AsyncStorage.setItem(LAST_SEEN_FORM_KEY, top).catch(() => {});
              } catch { /* silent */ }
              setDiagnosticsCount(0);
              setTimeout(fetchCounts, 1500);
            })();
          },
        }}
      />
      <Tabs.Screen
        name="strength-profile"
        options={{
          title: 'Strength',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: 'Social',
          tabBarIcon: ({ color, size }) => (
            <SocialTabIcon color={color} size={size} totalCount={socialCount} />
          ),
        }}
        listeners={{ tabPress: () => { setTimeout(fetchCounts, 1500); } }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
          // Visible to all tiers: free users go through onboarding + plan
          // generation, then hit the in-dashboard upgrade gate (see coach.tsx).
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#ef4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
});
