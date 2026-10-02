import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ClientScreen } from '../../../src/features/personal-training/ClientScreen';
import { Gate } from '../../../src/features/personal-training/Gate';

export default function PersonalTrainingClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clientId = String(id ?? '');
  // Keyed by client: the route stays mounted between clients, and one client's open tab or draft must not carry to the next.
  return <Gate>{(me) => <ClientScreen key={clientId} me={me} clientId={clientId} />}</Gate>;
}
