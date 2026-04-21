import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/constants/theme';
import { socialApi } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';

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

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    try {
      const data = await socialApi.getNotificationCounts();
      setSocialCount(data.total ?? 0);
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
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
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
          // Hidden for free users pending IAP setup
          href: user?.tier === 'pro' || user?.tier === 'enterprise' ? undefined : null,
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
