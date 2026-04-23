import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { BrandLogo } from "@/components/BrandLogo";

export default function Privacy() {
  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-12 sm:py-16">
        <div className="max-w-3xl mx-auto space-y-6 text-sm text-muted-foreground">
          <h1 className="text-2xl font-bold text-foreground mb-1">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mt-1">Last updated: April 23, 2026</p>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Introduction</h2>
            <p>
              Axiom ("we," "our," or "us") operates the Axiom platform, including our website at axiomtraining.io, our iOS and Android mobile applications, and all related services (collectively, the "Service"). This Privacy Policy explains how we collect, use, disclose, and safeguard your personal information when you use our Service. Please read it carefully. By accessing or using the Service, you acknowledge that you have read, understood, and agree to the practices described in this Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Information We Collect</h2>
            <p className="font-medium text-foreground">2.1 Information You Provide Directly</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account information:</strong> Name, email address, hashed password, and profile photo when you register or sign in with Google or Apple. We require a date of birth at registration or first sign-in to verify that you meet our minimum age requirement of 13 years old. Date of birth is stored and used solely for age verification.</li>
              <li><strong>Profile and identity:</strong> Username, profile picture you upload, and any optional bio or display information.</li>
              <li><strong>Fitness and health data:</strong> Height, weight, body composition goals, training age, available equipment, physical constraints or injuries, working weights, exercise logs, workout history, and other health-related information you choose to provide. This includes body weight log entries you record over time.</li>
              <li><strong>AI Coach interactions:</strong> Onboarding interview responses, chat messages with the AI coach, nutrition logs, wellness check-ins, program preferences, and strength diagnostic answers.</li>
              <li><strong>Lift diagnostic data:</strong> Selected lifts, sets, reps, weights, video form descriptions, diagnostic conversation transcripts, and generated analysis plans.</li>
              <li><strong>Workout logs:</strong> Exercise entries including exercise name, sets, reps, weight used, and any session notes you record through the app's workout logging features.</li>
              <li><strong>Nutrition and food logs:</strong> Meal entries including name, meal type, calorie count, macronutrient breakdown, and any notes. Images you submit for AI-powered meal analysis and calorie/macro estimation are processed in real time and are not permanently stored after analysis unless you explicitly save the result to your log.</li>
              <li><strong>Social content:</strong> Text posts, shared workouts, shared programs, forwarded posts, reactions, comments, and media you post or share with friends on the platform.</li>
              <li><strong>Direct messages:</strong> Messages you send to other users via the in-app messaging feature, including any posts forwarded through direct messages.</li>
              <li><strong>Payment information:</strong> Billing is processed entirely by Stripe. We do not collect or store full payment card details. We store your Stripe customer ID, subscription tier, and subscription status.</li>
            </ul>

            <p className="font-medium text-foreground mt-4">2.2 Information Collected Automatically</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Usage and analytics data:</strong> Screens visited, features used, buttons tapped, session duration, and interaction patterns. We use PostHog (posthog.com) as our first-party analytics provider. Analytics events are linked to your user ID to enable personalized product improvements. PostHog operates on servers in the United States. Analytics data is not used for third-party advertising.</li>
              <li><strong>Device and technical data:</strong> IP address, device type, operating system version, app version, browser type, and unique device identifiers.</li>
              <li><strong>Push notification tokens:</strong> If you grant permission, we collect your Expo push notification token to send you training reminders, coaching updates, motivational nudges, and social notifications (friend requests, messages, likes, comments). You can withdraw this permission at any time in your device settings or in the app's notification settings.</li>
              <li><strong>Cookies and local storage:</strong> We use cookies, secure storage, and similar technologies for authentication session management, preference storage, and security purposes.</li>
              <li><strong>Log data:</strong> Server logs recording requests, timestamps, error events, and performance metrics.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide, operate, personalize, and improve the Service, including AI-powered lift diagnostics, coaching, nutrition analysis, and program generation.</li>
              <li>Process your subscription, manage billing via Stripe, and maintain your account.</li>
              <li>Verify your age at account creation to enforce our minimum age requirement of 13 years old.</li>
              <li>Generate personalized training programs, nutrition recommendations, and coaching responses using AI models.</li>
              <li>Generate daily AI-powered insights ("Anakin's Latest Insights") displayed on your home screen, derived from your workout history, estimated strength metrics, and nutrition logs. These insights are refreshed once per day and cached on our servers.</li>
              <li>Compute automated strength metrics including estimated one-rep maximums (using the Epley formula), strength-to-bodyweight ratios, movement pattern balance scores, and a composite Strength Index displayed on your Strength Profile screen. These scores are derived deterministically from your logged workout data and are informational only.</li>
              <li>Enable social features including friend connections, feed posts, reactions, comments, post forwarding, and direct messaging.</li>
              <li>Send push notifications relevant to your activity, including: training reminders, program schedule alerts, streak milestones, personal record detections, weekly summaries, social activity (friend requests, messages, likes, comments), and motivational nudges based on logged behaviors such as nutrition choices. You can opt out of non-essential notifications in your device settings.</li>
              <li>Send behavioral coaching nudges: if our system detects a high-calorie junk food item in a meal you log via the AI analysis feature, you may receive a motivational push notification. This analysis occurs only when you use the "Describe" or "Scan" meal entry modes (not manual entry) and is designed as an optional accountability feature. No more than one such nudge is sent per 6-hour window per user.</li>
              <li>Analyze aggregate, anonymized usage patterns to improve our algorithms, features, and user experience.</li>
              <li>Detect and prevent fraud, abuse, unauthorized access, and security incidents.</li>
              <li>Comply with applicable legal obligations and enforce our Terms of Service.</li>
              <li>Respond to your support requests and communications.</li>
            </ul>
            <p className="mt-2">
              We do not use your personal health or fitness data for advertising purposes and do not sell your personal information to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Third-Party Service Providers</h2>
            <p>We share data with the following third-party processors to operate the Service. Each is contractually required to protect your data and use it only for the services they provide to us:</p>
            <ul className="list-disc pl-6 mt-2 space-y-2">
              <li><strong>OpenAI (openai.com):</strong> Powers the AI coach chat, lift diagnostic analysis, training program generation, daily home insights, nutrition meal parsing, and coaching insight features. Your messages, fitness data, and meal descriptions are sent to OpenAI's API to generate responses. OpenAI's privacy policy governs their data handling.</li>
              <li><strong>Google – Gemini (ai.google.dev):</strong> Powers the AI photo meal analysis feature. Food photos you submit are processed by Google's Gemini API to estimate nutritional content. Google's privacy policy governs their data handling.</li>
              <li><strong>Google – Authentication (accounts.google.com):</strong> If you sign in with Google, we receive your name and email address from Google OAuth. We do not receive your Google password. New accounts created via Google OAuth are prompted to provide a date of birth before accessing the app.</li>
              <li><strong>Apple – Sign In (apple.com):</strong> If you sign in with Apple, we receive your name and email address (or Apple's private relay address) via Apple's Sign In service. We do not receive your Apple password. New accounts created via Apple Sign In are prompted to provide a date of birth before accessing the app.</li>
              <li><strong>Google – YouTube (youtube.com):</strong> Exercise demonstration videos are embedded from YouTube. YouTube may collect data per their own privacy policy when you view these videos.</li>
              <li><strong>Stripe (stripe.com):</strong> Processes all subscription payments. We share your email and billing intent with Stripe. Your full card details are handled exclusively by Stripe and never pass through our servers.</li>
              <li><strong>PostHog (posthog.com):</strong> Our first-party product analytics platform. We send anonymized screen view events, feature interaction events, and session data to PostHog linked to your user ID to understand how the product is used. PostHog does not use this data for advertising and does not sell it to third parties. Data is stored on PostHog's US servers. You may request deletion of your analytics data as part of a broader account deletion request.</li>
              <li><strong>Twilio (twilio.com):</strong> Used for internal administrative SMS notifications. Twilio may process the phone numbers used for these notifications.</li>
              <li><strong>Expo / EAS (expo.dev):</strong> Our mobile app is built and distributed using Expo's infrastructure. Expo handles over-the-air app updates and push notification delivery. Your push notification token is shared with Expo's push notification service to deliver notifications to your device.</li>
              <li><strong>Hosting and infrastructure:</strong> Our servers and database are hosted on cloud infrastructure. Data is stored and processed in the United States.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Social Features and User-Generated Content</h2>
            <p>
              When you use social features — including posting to the feed, sharing workouts or programs, or messaging other users — the content you share becomes visible to the intended recipients (friends, or your social feed audience depending on your settings). We are not responsible for how other users may use or share content you post. Exercise discretion when sharing personal health information publicly.
            </p>
            <p className="mt-2">
              Direct messages are stored on our servers to enable the messaging feature. We do not routinely review private messages but may access them in connection with a safety investigation, legal obligation, or violation of our Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Data Retention</h2>
            <p>We retain your data for as long as your account is active or as needed to provide the Service:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account data:</strong> Retained while your account is active and for up to 90 days after deletion to allow recovery, then permanently deleted.</li>
              <li><strong>Workout and diagnostic history:</strong> Retained while your account is active. Deleted when your account is deleted.</li>
              <li><strong>AI coach conversation threads:</strong> Retained for up to 90 days of inactivity, after which older thread data may be pruned.</li>
              <li><strong>Food photos:</strong> Processed in real time; not permanently stored after analysis unless you save the result to your log.</li>
              <li><strong>Billing records:</strong> Retained for up to 7 years as required by financial and tax regulations.</li>
              <li><strong>Server logs:</strong> Retained for up to 90 days for security and debugging purposes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Security</h2>
            <p>
              We implement industry-standard security measures including TLS encryption in transit, hashed passwords (bcrypt), JWT authentication, access-controlled infrastructure, and regular security reviews. No method of data transmission over the internet is 100% secure. We cannot guarantee absolute security of your data and encourage you to use a strong, unique password and protect your account credentials.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Your Privacy Rights and Choices</h2>
            <p>Depending on your location, you may have the following rights regarding your personal information:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data.</li>
              <li><strong>Deletion:</strong> Request deletion of your account and all associated personal data. To submit a deletion request, email <a href="mailto:inquiries@axiomtraining.io" className="text-primary hover:underline">inquiries@axiomtraining.io</a> with the subject "Data Deletion Request." We will process your request within 30 days. Note that we may retain certain data as required by law (e.g., billing records).</li>
              <li><strong>Portability:</strong> Request an export of your data in a machine-readable format.</li>
              <li><strong>Opt-out of marketing:</strong> Unsubscribe from non-transactional emails via the link in any email, or by contacting us.</li>
              <li><strong>Push notifications:</strong> Disable push notifications at any time in your device settings.</li>
              <li><strong>Restrict processing:</strong> Object to or request restriction of certain processing activities.</li>
            </ul>

            <p className="font-medium text-foreground mt-4">California Residents (CCPA/CPRA)</p>
            <p className="mt-1">
              California residents have additional rights under the California Consumer Privacy Act, including the right to know what personal information is collected, the right to delete, the right to opt out of sale (we do not sell personal information), and the right to non-discrimination for exercising these rights. To make a verifiable consumer request, contact us at the email below.
            </p>

            <p className="font-medium text-foreground mt-4">Canadian Residents (PIPEDA)</p>
            <p className="mt-1">
              Canadian residents may have rights under the Personal Information Protection and Electronic Documents Act (PIPEDA), including the right to access and correct personal information we hold. Contact our privacy office at the address below to exercise these rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Children's Privacy and Age Requirements</h2>
            <p>
              The Service is intended for users who are at least 13 years of age. We do not knowingly collect personal information from children under 13. To enforce this requirement, we collect your date of birth during account registration — including when you sign in for the first time via Google or Apple OAuth — and deny access to any user who does not meet the 13-year minimum age threshold.
            </p>
            <p className="mt-2">
              Users between the ages of 13 and 17 ("minors") may use the Service with the awareness and, where required by law, the consent of a parent or legal guardian. By allowing a minor to use the Service, the parent or guardian agrees to these terms and this Privacy Policy on the minor's behalf. We encourage parents and guardians to monitor their minor children's use of the app, including their fitness data submissions, social interactions, and AI coaching conversations.
            </p>
            <p className="mt-2">
              This Service is designed for general fitness tracking and strength training guidance. Health and fitness data collected from minor users is used solely to provide and personalize the Service and is not shared with third parties for marketing or advertising purposes.
            </p>
            <p className="mt-2">
              If you are a parent or guardian and believe your child under 13 has created an account or provided us with personal information without your consent, please contact us immediately at <a href="mailto:inquiries@axiomtraining.io" className="text-primary hover:underline">inquiries@axiomtraining.io</a>. We will delete such information promptly upon verification.
            </p>
            <p className="mt-2 font-medium text-foreground">COPPA (Children's Online Privacy Protection Act)</p>
            <p className="mt-1">
              We comply with the Children's Online Privacy Protection Act. We do not knowingly collect, use, or disclose personal information from children under 13. Our age verification process at registration is designed to prevent under-13 users from accessing the Service. If we discover that a user is under 13, we will immediately suspend the account and delete all associated personal data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. International Data Transfers</h2>
            <p>
              Our servers are located in the United States. If you access the Service from outside the United States, your information will be transferred to and processed in the U.S., where data protection laws may differ from those in your jurisdiction. By using the Service, you consent to this transfer. We take steps to ensure appropriate safeguards are in place, including relying on service providers who comply with applicable data protection frameworks.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. AI and Automated Processing</h2>
            <p>
              The Service uses AI models from OpenAI and Google (Gemini) to process your fitness data, food photos, meal descriptions, and coaching conversations. These AI systems generate recommendations automatically. We do not make solely automated decisions that produce significant legal or similarly significant effects on you without human oversight. AI-generated outputs are informational only — see our Terms of Service for full disclaimers.
            </p>
            <p className="mt-2 font-medium text-foreground">Strength Metrics and Automated Scoring</p>
            <p className="mt-1">
              The Strength Profile feature computes automated scores from your workout logs, including estimated one-rep maximums (using the Epley formula: weight × (1 + reps ÷ 30)), strength-to-bodyweight ratios compared against standard benchmarks, a composite Strength Index (0–100), a Strength Tier classification (Beginner through Elite), and a radar chart showing relative training volume across movement categories. These calculations are deterministic — no AI model is involved — and are updated each time new workout data is processed.
            </p>
            <p className="mt-2 font-medium text-foreground">Daily AI Insights</p>
            <p className="mt-1">
              When you have logged sufficient workout data (a minimum of 3 sessions with weighted exercises), your home screen may display "Anakin's Latest Insights" — up to five personalized observations generated by OpenAI's GPT-4 model based on your strength metrics, movement balance scores, recent training trends, and nutrition log averages. These insights are generated once per day and cached. The data sent to OpenAI for this purpose includes anonymized lift names, estimated 1RM values, training session counts, monthly trend percentages, and averaged macro totals — not raw conversation history.
            </p>
            <p className="mt-2 font-medium text-foreground">Food Behavior Analysis</p>
            <p className="mt-1">
              When you log a meal using the AI-assisted "Describe" or "Scan" modes, the name and calorie content of the analyzed meal are evaluated against a set of criteria to determine whether the meal qualifies as a high-calorie junk food item. If it does, the system may send a motivational push notification. This analysis is entirely automated, uses no AI model, and applies a calorie threshold to avoid triggering on small or incidental treats. A maximum of one such notification is sent per 6-hour window. You can disable push notifications entirely in your device settings.
            </p>
            <p className="mt-2">
              Anonymized, aggregated usage patterns (not personally identifiable data) may be used to improve our own product features and algorithms. We do not share personally identifiable AI interaction data with third parties for their model training without your explicit consent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. We will notify you of material changes by posting the updated policy on this page, updating the "Last updated" date, and, where appropriate, sending an in-app notification or email. Your continued use of the Service after the effective date of any changes constitutes your acceptance of the revised policy. If you do not agree, you must stop using the Service and may request deletion of your account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">13. Contact Us</h2>
            <p>
              For questions, concerns, or requests regarding this Privacy Policy or our data practices, contact us at:
            </p>
            <p className="mt-2">
              <strong>Email:</strong>{" "}
              <a href="mailto:inquiries@axiomtraining.io" className="text-primary hover:underline">inquiries@axiomtraining.io</a>
            </p>
            <p className="mt-1">
              We aim to respond to all legitimate privacy inquiries within 30 days.
            </p>
          </section>
        </div>

        <footer className="border-t py-10 mt-12">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BrandLogo height={24} className="h-6 w-auto" />
              <span>Axiom — AI-Powered Strength Training</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
              <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
