import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/constants/theme';

export default function DiagnosticLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontWeight: '600', color: colors.foreground },
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ marginLeft: 4 }}
          >
            <Ionicons name="chevron-back" size={26} color={colors.foreground} />
          </TouchableOpacity>
        ),
      }}
    >
      {/* The conversational diagnostic owns its header (× · monogram · progress). */}
      <Stack.Screen name="conversation" options={{ headerShown: false, gestureEnabled: false }} />
      {/* Report: opaque, full-bleed, modal presentation with a fade. */}
      <Stack.Screen name="report" options={{ headerShown: false, presentation: 'modal', animation: 'fade' }} />
    </Stack>
  );
}
