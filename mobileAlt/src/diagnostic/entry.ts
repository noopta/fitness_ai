/**
 * Where "start a lift diagnostic" goes. The conversational flow is rolled out
 * behind the server's `liftDiagnosticConversation` flag (/auth/me); everyone
 * else keeps the 4-screen wizard exactly as before.
 */
export function diagnosticEntryRoute(features: { liftDiagnosticConversation?: boolean } | undefined): '/diagnostic/conversation' | '/diagnostic/onboarding' {
  return features?.liftDiagnosticConversation ? '/diagnostic/conversation' : '/diagnostic/onboarding';
}
