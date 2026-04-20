<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Axiom backend. A new shared PostHog client (`backend/src/services/posthogClient.ts`) was created using the `posthog-node` SDK with exception autocapture enabled. The client is imported into 5 route files and the Express app entry point. User identification (`posthog.identify()`) is called on every successful login and signup to keep person profiles current. `posthog.captureException()` is wired into route-level catch blocks and the global Express error handler, ensuring all server errors are tracked. SIGINT/SIGTERM handlers were added to `index.ts` to flush the PostHog queue on graceful shutdown.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | New user completes email/password registration | `backend/src/routes/auth.ts` |
| `user_logged_in` | User logs in with email/password credentials | `backend/src/routes/auth.ts` |
| `user_google_oauth_completed` | User authenticates via Google OAuth (new or returning) | `backend/src/routes/auth.ts` |
| `user_apple_signin_completed` | User authenticates via Sign in with Apple on mobile (new or returning) | `backend/src/routes/auth.ts` |
| `user_account_deleted` | User permanently deletes their account | `backend/src/routes/auth.ts` |
| `diagnostic_session_created` | User starts a new diagnostic session for a selected lift | `backend/src/routes/sessions.ts` |
| `exercise_snapshots_added` | User submits exercise performance snapshots to a session | `backend/src/routes/sessions.ts` |
| `workout_plan_generated` | User successfully generates a personalized workout plan | `backend/src/routes/sessions.ts` |
| `session_shared` | User makes their session/plan public and gets a shareable link | `backend/src/routes/sessions.ts` |
| `subscription_checkout_completed` | Stripe checkout.session.completed webhook — user upgraded to Pro | `backend/src/routes/payments.ts` |
| `subscription_canceled` | Stripe customer.subscription.deleted webhook — tier reverts to free | `backend/src/routes/payments.ts` |
| `subscription_payment_failed` | Stripe invoice.payment_failed webhook — payment could not be collected | `backend/src/routes/payments.ts` |
| `apple_iap_verified` | Mobile user's Apple IAP verified and tier upgraded to Pro | `backend/src/routes/appleIap.ts` |
| `workout_logged` | User logs a completed workout session | `backend/src/routes/workouts.ts` |
| `nutrition_log_saved` | User saves or updates their daily macro nutrition entry | `backend/src/routes/nutrition.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics:** https://us.posthog.com/project/381498/dashboard/1464647
- **New Signups by Method** (daily signups by email/Google/Apple): https://us.posthog.com/project/381498/insights/v3mqasZa
- **Diagnostic Session Funnel** (session created → snapshots → plan generated): https://us.posthog.com/project/381498/insights/vCCLADv6
- **Subscription Revenue Events** (weekly upgrades, cancellations, payment failures): https://us.posthog.com/project/381498/insights/zpN8agkA
- **Daily Engagement: Workouts & Nutrition** (daily workout and nutrition activity): https://us.posthog.com/project/381498/insights/fy4R9a2B
- **Signup to Pro Conversion Funnel** (full funnel: signup → plan → subscription): https://us.posthog.com/project/381498/insights/RfsPAKtR

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
