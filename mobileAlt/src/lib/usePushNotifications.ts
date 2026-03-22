import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { authApi } from './api';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Map notification data.screen → Expo Router path
function resolveDeepLink(data?: Record<string, unknown>): string | null {
  if (!data?.screen) return null;
  const screen = data.screen as string;
  const tab = data.tab as string | undefined;

  switch (screen) {
    case 'coach':
      return tab ? `/(tabs)/coach?tab=${tab}` : '/(tabs)/coach';
    case 'strength-profile':
      return '/(tabs)/strength-profile';
    case 'history':
      return '/(tabs)/history';
    default:
      return null;
  }
}

export function usePushNotifications(isAuthenticated: boolean) {
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Register for push notifications
    registerForPushNotifications().then(token => {
      if (token) {
        authApi.registerPushToken(token).catch(err =>
          console.warn('[push] Failed to register token:', err)
        );
      }
    });

    // Listen for notifications received while app is foregrounded (just log)
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('[push] Notification received:', notification.request.content.title);
    });

    // Listen for user tapping a notification — deep link into the app
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const path = resolveDeepLink(data);
      if (path) {
        // Small delay to ensure the navigation stack is mounted
        setTimeout(() => router.push(path as any), 300);
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isAuthenticated]);
}

async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications are not supported on web or simulators
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) {
    console.log('[push] Push notifications only work on physical devices');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[push] Push notification permission denied');
    return null;
  }

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Axiom',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366f1',
    });
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    console.log('[push] Expo push token registered');
    return tokenData.data;
  } catch (err) {
    console.warn('[push] Failed to get push token:', err);
    return null;
  }
}
