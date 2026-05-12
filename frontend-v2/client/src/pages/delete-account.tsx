import { Navbar } from "@/components/Navbar";

// Public-facing page describing how to request account deletion. Required by
// Google Play (and Apple) — must be reachable without login so uninstalled
// users can find it. Linked from the Play Console "Data safety" section as
// the deletion request URL.

export default function DeleteAccount() {
  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-12 sm:py-16">
        <div className="max-w-3xl mx-auto space-y-6 text-sm text-muted-foreground">
          <h1 className="text-2xl font-bold text-foreground mb-1">Delete Your Axiom Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Last updated: May 12, 2026</p>

          <section>
            <p>
              You can permanently delete your Axiom account and all associated data at any time. This page explains exactly what gets deleted, what we retain (and why), and how to submit a deletion request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. What gets deleted</h2>
            <p>When you delete your account, the following data is permanently removed from our servers:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account profile:</strong> name, email address, hashed password, username, date of birth, profile photo, and any Google or Apple sign-in identifiers linked to your account.</li>
              <li><strong>Fitness and health data:</strong> height, weight, body composition goals, training age, available equipment, physical constraints or injuries, body weight log entries, and all other fitness/health information you provided.</li>
              <li><strong>Workout history:</strong> all workout logs, exercise entries, sets, reps, weights, notes, and any saved program data.</li>
              <li><strong>Nutrition data:</strong> all meal entries, daily nutrition logs, saved foods, and any meal photos previously uploaded for analysis.</li>
              <li><strong>Diagnostic sessions:</strong> lift diagnostic transcripts, exercise snapshots, and any AI-generated plans associated with your sessions.</li>
              <li><strong>AI Coach data:</strong> coach onboarding profile, coaching goals, conversation history with the AI coach, and any cached coaching insights.</li>
              <li><strong>Wellness data:</strong> all wellness check-ins (mood, energy, sleep, stress).</li>
              <li><strong>Social activity:</strong> posts you've shared, comments, reactions, friend connections, friend requests sent or received, and direct messages you've sent or received.</li>
              <li><strong>Notifications:</strong> push notification tokens and any notification preferences.</li>
              <li><strong>Streaks and progress markers:</strong> workout streaks, nutrition streaks, streak freezes, and related reinforcement state.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. What we retain, and why</h2>
            <p>A small amount of data is retained after deletion, only as required by law or for legitimate business purposes:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Payment and subscription records:</strong> retained for up to 7 years to comply with tax, accounting, and audit obligations. These records contain your Stripe customer ID, subscription tier, and transaction history. We do not retain your card details — those are handled exclusively by Stripe, Apple, or Google.</li>
              <li><strong>Anonymized aggregate analytics:</strong> retained indefinitely with no personal identifiers tied to them. Once your account is deleted, any future analysis cannot link these aggregates back to you.</li>
              <li><strong>Server and application logs:</strong> retained for up to 90 days for security, debugging, and abuse prevention, then automatically purged.</li>
              <li><strong>Data we are legally required to retain</strong> in response to a valid legal process (e.g., subpoena, court order, or regulatory inquiry) for the duration required by law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How to delete your account</h2>

            <p className="font-medium text-foreground mt-4">Option A — In the app (fastest)</p>
            <p className="mt-1">
              Open Axiom on your phone, go to <strong>Settings → Delete Account</strong>, and confirm. Your account and associated data are deleted immediately. You will be signed out and cannot recover the account.
            </p>

            <p className="font-medium text-foreground mt-4">Option B — Email request (if you no longer have the app)</p>
            <p className="mt-1">
              Email <a href="mailto:inquiries@axiomtraining.io?subject=Account%20Deletion%20Request" className="text-foreground underline">inquiries@axiomtraining.io</a> from the email address associated with your Axiom account, with the subject line <strong>"Account Deletion Request"</strong>.
            </p>
            <p className="mt-2">
              Please include in the body of the email:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>The email address registered on your Axiom account (so we can identify your account).</li>
              <li>Your username, if you remember it.</li>
              <li>Confirmation that you understand the deletion is permanent.</li>
            </ul>
            <p className="mt-2">
              We will verify the request, confirm receipt within 3 business days, and complete the deletion within 30 days. We may need to contact you for additional verification before processing.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Subscriptions</h2>
            <p>
              Deleting your Axiom account does not automatically cancel an active subscription billed through Apple, Google Play, or Stripe. To cancel your subscription:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>iOS (Apple):</strong> Settings → [Your Apple ID] → Subscriptions → Axiom → Cancel Subscription.</li>
              <li><strong>Android (Google Play):</strong> Google Play Store → Profile icon → Payments &amp; subscriptions → Subscriptions → Axiom → Cancel subscription.</li>
              <li><strong>Web (Stripe):</strong> reply to your most recent Stripe billing email or email <a href="mailto:inquiries@axiomtraining.io" className="text-foreground underline">inquiries@axiomtraining.io</a> and we will cancel on your behalf.</li>
            </ul>
            <p className="mt-2">
              We recommend cancelling your subscription <em>before</em> requesting account deletion so you don't continue to be billed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Questions</h2>
            <p>
              If you have questions about the deletion process or what happens to your data, contact us at <a href="mailto:inquiries@axiomtraining.io" className="text-foreground underline">inquiries@axiomtraining.io</a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
