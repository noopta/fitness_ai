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
          <p className="text-sm text-muted-foreground mt-1">Last updated: April 2, 2026</p>

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
              <li><strong>Account information:</strong> Name, email address, hashed password, date of birth, and profile photo when you register or sign in with Google OAuth.</li>
              <li><strong>Profile and identity:</strong> Username, profile picture you upload, and any optional bio or display information.</li>
              <li><strong>Fitness and health data:</strong> Height, weight, body composition goals, training age, available equipment, physical constraints or injuries, working weights, exercise logs, workout history, and other health-related information you choose to provide.</li>
              <li><strong>AI Coach interactions:</strong> Onboarding interview responses, chat messages with the AI coach, nutrition logs, wellness check-ins, program preferences, and strength diagnostic answers.</li>
              <li><strong>Lift diagnostic data:</strong> Selected lifts, sets, reps, weights, video form descriptions, diagnostic conversation transcripts, and generated analysis plans.</li>
              <li><strong>Nutrition and food photos:</strong> Images you submit for AI-powered meal analysis and calorie/macro estimation. These images are processed and are not permanently stored after analysis unless you explicitly save the result.</li>
              <li><strong>Social content:</strong> Text posts, shared workouts, shared programs, and media you post or share with friends on the platform.</li>
              <li><strong>Direct messages:</strong> Messages you send to other users via the in-app messaging feature.</li>
              <li><strong>Payment information:</strong> Billing is processed entirely by Stripe. We do not collect or store full payment card details. We store your Stripe customer ID, subscription tier, and subscription status.</li>
            </ul>

            <p className="font-medium text-foreground mt-4">2.2 Information Collected Automatically</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Usage data:</strong> Pages or screens visited, features used, buttons tapped, session duration, and interaction patterns.</li>
              <li><strong>Device and technical data:</strong> IP address, device type, operating system version, app version, browser type, and unique device identifiers.</li>
              <li><strong>Push notification tokens:</strong> If you grant permission, we collect your Expo push notification token to send you training reminders, coaching updates, and social notifications. You can withdraw this permission at any time in your device settings.</li>
              <li><strong>Cookies and local storage:</strong> We use cookies, secure storage, and similar technologies for authentication session management, preference storage, and security purposes.</li>
              <li><strong>Log data:</strong> Server logs recording requests, timestamps, error events, and performance metrics.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide, operate, personalize, and improve the Service, including AI-powered lift diagnostics, coaching, nutrition analysis, and program generation.</li>
              <li>Process your subscription, manage billing via Stripe, and maintain your account.</li>
              <li>Generate personalized training programs, nutrition recommendations, and coaching responses using AI models.</li>
              <li>Enable social features including friend connections, feed posts, and direct messaging.</li>
              <li>Send push notifications, transactional emails, and in-app alerts relevant to your training and account activity.</li>
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
              <li><strong>OpenAI (openai.com):</strong> Powers the AI coach chat, lift diagnostic analysis, training program generation, and coaching insight features. Your messages and fitness data are sent to OpenAI's API to generate responses. OpenAI's privacy policy governs their data handling.</li>
              <li><strong>Google – Gemini (ai.google.dev):</strong> Powers the AI photo meal analysis feature. Food photos you submit are processed by Google's Gemini API to estimate nutritional content. Google's privacy policy governs their data handling.</li>
              <li><strong>Google – Authentication (accounts.google.com):</strong> If you sign in with Google, we receive your name and email address from Google OAuth. We do not receive your Google password.</li>
              <li><strong>Google – YouTube (youtube.com):</strong> Exercise demonstration videos are embedded from YouTube. YouTube may collect data per their own privacy policy when you view these videos.</li>
              <li><strong>Stripe (stripe.com):</strong> Processes all subscription payments. We share your email and billing intent with Stripe. Your full card details are handled exclusively by Stripe and never pass through our servers.</li>
              <li><strong>Twilio (twilio.com):</strong> Used for internal administrative SMS notifications. Twilio may process the phone numbers used for these notifications.</li>
              <li><strong>Expo / EAS (expo.dev):</strong> Our mobile app is built and distributed using Expo's infrastructure. Expo handles over-the-air app updates and push notification delivery. Your push notification token is shared with Expo's push notification service.</li>
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
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Children's Privacy</h2>
            <p>
              The Service is not directed to or intended for use by individuals under the age of 18. We do not knowingly collect personal information from children under 18. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately at <a href="mailto:inquiries@axiomtraining.io" className="text-primary hover:underline">inquiries@axiomtraining.io</a> and we will delete such information promptly.
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
              The Service uses AI models from OpenAI and Google (Gemini) to process your fitness data, food photos, and coaching conversations. These AI systems generate recommendations automatically. We do not make solely automated decisions that produce significant legal or similarly significant effects on you without human oversight. AI-generated outputs are informational only — see our Terms of Service for full disclaimers.
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
