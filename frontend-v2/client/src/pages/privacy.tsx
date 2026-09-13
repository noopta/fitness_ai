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
          <p className="text-sm text-muted-foreground mt-1">Last updated: September 4, 2026</p>

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
              <li><strong>Form-check videos:</strong> If you use the Form Analysis feature, you upload a short video (up to 60 seconds) of yourself performing a lift. The video is transmitted to Google's Vertex AI for analysis and is <strong>permanently deleted from our systems as soon as the analysis completes</strong> — typically within one minute. We never retain your video.</li>
              <li><strong>Reference stills (optional):</strong> Within the Form Analysis feature you may separately choose to save "reference stills." When you switch this on for an upload, we extract up to three individual frames from that video — the specific moments the analysis is commenting on — draw a marker around the relevant area, and store those images with your analysis so you can see what the feedback refers to. This setting is <strong>off unless you turn it on</strong>, is confirmed for each upload, and is unavailable to users under 18. The stills are stored with that analysis record and are deleted when you delete the analysis or your account. Declining does not limit the written analysis in any way.</li>
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
              <li><strong>Google – Vertex AI (cloud.google.com/vertex-ai):</strong> Powers the AI photo meal analysis and the Form Analysis video feature. Food photos and form-check videos you submit are processed by Google's Gemini models running on Google Cloud's Vertex AI platform. Under Google Cloud's terms, customer data submitted to Vertex AI is not used to train Google's models. Media is deleted from Google Cloud storage immediately after processing. Reference stills, when you enable them, are produced on our own servers and are never sent to any third party.</li>
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
              <li><strong>Form-check videos:</strong> Deleted immediately after the analysis completes, typically within one minute. Never retained.</li>
              <li><strong>Reference stills:</strong> Only created if you switch them on for a given upload. Stored as part of that analysis record and deleted when you delete the analysis (available in the app on each analysis) or your account. They are not used for any purpose other than displaying your own feedback to you, are never shown to other users, and are never used for advertising or model training.</li>
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

            <p className="font-medium text-foreground mt-4">European Economic Area and United Kingdom (GDPR / UK GDPR)</p>
            <p className="mt-1">
              If you are located in the EEA or the UK, the following applies to you in addition to the rights listed above.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Controller:</strong> Axiom is the data controller for the personal data described in this policy. Contact us at <a href="mailto:inquiries@axiomtraining.io" className="text-primary hover:underline">inquiries@axiomtraining.io</a> for any request under this section.</li>
              <li><strong>Lawful bases.</strong> We process your account and usage data to <em>perform our contract</em> with you (Art. 6(1)(b)); we process data for security, fraud prevention and product improvement on the basis of our <em>legitimate interests</em> (Art. 6(1)(f)); and we rely on your <em>consent</em> (Art. 6(1)(a)) for push notifications and for optional features you switch on.</li>
              <li><strong>Health data.</strong> Fitness, body, nutrition and form-check data are special category data under Art. 9. We process them only on the basis of your <strong>explicit consent</strong>, which you give by choosing to provide them and which you may withdraw at any time by deleting the data or your account. Withdrawal does not affect processing already carried out.</li>
              <li><strong>Reference stills.</strong> Because these are retained images of your body, they are processed only where you give a separate, explicit opt-in for that upload. You may withhold it, change it at any time, and delete any stored still by deleting the analysis — none of which limits your access to the rest of the Service.</li>
              <li><strong>International transfers.</strong> Our servers and processors are in the United States. Where we transfer personal data out of the EEA or UK we rely on the European Commission's Standard Contractual Clauses (and the UK Addendum), together with supplementary technical measures including encryption in transit. A copy of the relevant transfer mechanism is available on request.</li>
              <li><strong>Retention.</strong> See Section 6. We keep personal data no longer than necessary for the purposes described, and you can shorten that at any time by deleting individual records or your account.</li>
              <li><strong>Automated decision-making.</strong> We do not make decisions producing legal or similarly significant effects about you by solely automated means. AI-generated training and nutrition output is advisory and you remain free to disregard it.</li>
              <li><strong>Complaints.</strong> You have the right to lodge a complaint with your local supervisory authority, or with the UK Information Commissioner's Office (ico.org.uk), if you believe we have handled your data unlawfully. We would ask that you raise it with us first so we can try to resolve it.</li>
            </ul>

            <p className="font-medium text-foreground mt-4">Washington, Nevada and Connecticut — Consumer Health Data</p>
            <p className="mt-1">
              Washington's My Health My Data Act, Nevada SB 370 and comparable state laws give residents specific rights over "consumer health data." Much of what Axiom processes — your workouts, body weight, nutrition, injuries, form-check videos and any reference stills — falls within that definition, and we treat it as consumer health data for all users, not only those in these states.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>What we collect and why:</strong> the categories in Section 2, for the purposes in Section 3. We collect consumer health data only to provide the Service to you.</li>
              <li><strong>Consent to collect.</strong> Health data is collected only from what you choose to enter or upload. Optional processing that goes beyond providing a feature you requested — notably saving reference stills from a form-check video — requires a separate opt-in that is off by default.</li>
              <li><strong>We do not sell it.</strong> We do not sell consumer health data, and we do not share it with third parties for their own purposes. Our processors (Section 4) act only on our instructions.</li>
              <li><strong>Right to withdraw and delete.</strong> You may withdraw consent, and you may require us to delete your consumer health data, by deleting the individual records, deleting your account in the app, or emailing <a href="mailto:inquiries@axiomtraining.io" className="text-primary hover:underline">inquiries@axiomtraining.io</a>. We will process deletion requests within 30 days and will pass them on to our processors.</li>
              <li><strong>Right to access.</strong> You may request a list of the third parties with whom we have shared your consumer health data, and a copy of the data itself, at the same address.</li>
              <li><strong>No geofencing.</strong> We do not operate geofences around healthcare facilities or use location to infer health status.</li>
            </ul>

            <p className="font-medium text-foreground mt-4">Biometric Data</p>
            <p className="mt-1">
              We want to be explicit about what we do not do, because form-check video could otherwise raise the question. Axiom does <strong>not</strong> perform facial recognition, does not extract face, hand or body geometry as an identifier, does not attempt to identify or match individuals across videos or photos, and does not create, store or use biometric identifiers or biometric information as those terms are defined under the Illinois Biometric Information Privacy Act, the Texas Capture or Use of Biometric Identifier Act, or comparable laws. Form-check videos are analyzed for movement quality and then deleted.
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
              <strong>Additional protection for users under 18.</strong> The optional "reference stills" feature described in Section 2.1 is disabled for accounts under 18 years old and cannot be enabled by them. Minors receive the full written form analysis; we do not retain still images of them. This restriction is enforced on our servers using the date of birth collected at registration, not by the app alone, and an account whose age we cannot determine is treated as under 18 for this purpose.
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
              Our servers are located in the United States. If you access the Service from outside the United States, your information will be transferred to and processed in the U.S., where data protection laws may differ from those in your jurisdiction. Where the law of your jurisdiction requires a specific safeguard for that transfer — including for users in the EEA and UK — we rely on the Standard Contractual Clauses and the measures described under "European Economic Area and United Kingdom" in Section 8, not on your consent alone. We also require our service providers to comply with applicable data protection frameworks.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. AI and Automated Processing</h2>
            <p>
              The Service uses AI models from OpenAI, and Google Gemini models running on Google Cloud's Vertex AI, to process your fitness data, food photos, form-check videos, meal descriptions, and coaching conversations. These AI systems generate recommendations automatically. We do not make solely automated decisions that produce significant legal or similarly significant effects on you without human oversight. AI-generated outputs are informational only — see our Terms of Service for full disclaimers.
            </p>
            <p className="mt-2 font-medium text-foreground">Strength Metrics and Automated Scoring</p>
            <p className="mt-1">
              The Strength Profile feature computes automated scores from your workout logs, including estimated one-rep maximums (using the Epley formula: weight × (1 + reps ÷ 30)), strength-to-bodyweight ratios compared against standard benchmarks, a composite Strength Index (0–100), a Strength Tier classification (Beginner through Elite), and a radar chart showing relative training volume across movement categories. These calculations are deterministic — no AI model is involved — and are updated each time new workout data is processed.
            </p>
            <p className="mt-2 font-medium text-foreground">Daily AI Insights</p>
            <p className="mt-1">
              When you have logged sufficient workout data (a minimum of 3 sessions with weighted exercises), your home screen may display "Anakin's Latest Insights" — up to five personalized observations generated by OpenAI's GPT-4 model based on your strength metrics, movement balance scores, recent training trends, and nutrition log averages. These insights are generated once per day and cached. The data sent to OpenAI for this purpose includes anonymized lift names, estimated 1RM values, training session counts, monthly trend percentages, and averaged macro totals — not raw conversation history.
            </p>
            <p className="mt-2 font-medium text-foreground">Form Analysis (Video)</p>
            <p className="mt-1">
              When you upload a lift video, it is analyzed by a Gemini model on Vertex AI, which returns a written critique — a form score, strengths, faults with coaching cues, drills and any safety flags. Where the model can identify the specific moment a fault occurs, it also returns a timestamp and a region of the frame. If, and only if, you have switched on reference stills for that upload, our own servers use those coordinates to cut up to three frames out of your video and mark the relevant area, and we store those images with your analysis. The video itself is deleted either way. This output is informational coaching feedback, not a medical or physiotherapeutic assessment, and it can be wrong — see our Terms of Service.
            </p>

            <p className="mt-2 font-medium text-foreground">Food Behavior Analysis</p>
            <p className="mt-1">
              When you log a meal using the AI-assisted "Describe" or "Scan" modes, the name and calorie content of the analyzed meal are evaluated against a set of criteria to determine whether the meal qualifies as a high-calorie junk food item. If it does, the system may send a motivational push notification. This analysis is entirely automated, uses no AI model, and applies a calorie threshold to avoid triggering on small or incidental treats. A maximum of one such notification is sent per 6-hour window. You can disable push notifications entirely in your device settings.
            </p>
            <p className="mt-2">
              Anonymized, aggregated usage patterns (not personally identifiable data) may be used to improve our own product features and algorithms. We do not share personally identifiable AI interaction data with third parties for their model training without your explicit consent. Your form-check videos, reference stills and food photos are never used to train any model, ours or a third party's.
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
