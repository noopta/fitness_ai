/*
 * ============================================================================
 *  <!-- Draft for counsel review --> 16 October 2026
 *  Rewritten against the code (audit SECURITY_AND_LEGAL_AUDIT_2026-10.md,
 *  legal-report H1). Values in [SQUARE BRACKETS] are unknown facts the founder
 *  must fill (see components/legal/LegalPage.tsx LEGAL constants).
 *  Assumes the parallel 2026-10 remediation ships with it: health-data prompts
 *  sent to OpenAI directly (chatClient sensitive routing), the coach agent on
 *  Anthropic, other prompts via OpenRouter pinned to US hosts
 *  (fireworks/together/deepinfra/baseten) with data_collection 'deny',
 *  consent timestamps recorded, web cookie banner gating PostHog, Twilio
 *  operational alerts. If any of those does not ship, edit the matching
 *  paragraph before publishing.
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LEGAL, Mail, Section, Sub, List } from "@/components/legal/LegalPage";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains what Axiom collects, why, who we share it with, how long we keep it, and the choices you have.
          We have tried to write it in plain English. If something is unclear, email <Mail />.
          If you live in Washington, Nevada or another state with a consumer health data law, also read our{" "}
          <Link href="/health-data" className="text-primary hover:underline">Consumer Health Data Privacy Policy</Link>.
        </p>
      }
    >
      <Section title="1. Who we are">
        <p>
          Axiom ("Axiom", "we", "us") runs the Axiom website at {LEGAL.site}, the Axiom iOS and Android apps, and related services
          (together, the "Service"). The controller of your personal data is {LEGAL.entity}, {LEGAL.postalAddress}.
        </p>
        <List>
          <li><strong>Privacy contact:</strong> <Mail /> (general support: <Mail to={LEGAL.supportEmail} />).</li>
          <li><strong>EU representative (GDPR Art. 27):</strong> {LEGAL.euRepresentative}.</li>
          <li><strong>UK representative (UK GDPR Art. 27):</strong> {LEGAL.ukRepresentative}.</li>
        </List>
        <p className="mt-2">
          If you joined Axiom through a personal trainer or an institution (a team, gym or school), see Section 9. For data a trainer
          uploads about their clients, the trainer decides what is collected and Axiom handles it on their behalf.
        </p>
      </Section>

      <Section title="2. What we collect">
        <Sub>2.1 What you give us</Sub>
        <List>
          <li><strong>Account:</strong> name, email address, password (stored only as a bcrypt hash), username, profile photo, and your sign-in provider ID if you use Google or Apple sign-in.</li>
          <li><strong>Date of birth:</strong> required at sign-up or first sign-in. We use it to enforce our minimum age (13), to apply our under-18 protections, and to calculate energy needs.</li>
          <li><strong>Health and fitness data:</strong> height, weight and body-weight history, sex, training history and goals, available equipment, working weights and workout logs, sleep, stress, mood and energy check-ins, and anything you tell us about <strong>injuries, pain, medical conditions, medications or supplements, hormonal factors</strong> (for example pregnancy or menstrual cycle) and the health screening questions in the coach intake.</li>
          <li><strong>Body video and stills:</strong> videos you record or upload for form checks and lift diagnostics, and, only if you switch it on for an upload, up to three still frames saved from that video ("reference stills").</li>
          <li><strong>Food and nutrition:</strong> meals you log, meal photos, nutrition-label photos, order screenshots, barcodes you scan, recipes, and your nutrition targets.</li>
          <li><strong>Voice notes:</strong> audio you record to log a meal or talk to the coach. We convert it to text.</li>
          <li><strong>Coach chat:</strong> your conversations with Anakin, our AI coach, and the notes and long-term memory the coach keeps to personalise your coaching.</li>
          <li><strong>Social content:</strong> posts, comments, reactions, shared workouts and programs, direct messages, group chats, friend connections, and reports you file about other users.</li>
          <li><strong>Payments:</strong> your subscription status and the IDs our payment providers give us. Card details go directly to Stripe, Apple or Google; we never see or store them.</li>
          <li><strong>Support and feedback:</strong> what you send us by email, in-app feedback, or the exit survey when you delete your account.</li>
        </List>

        <Sub>2.2 What we collect automatically</Sub>
        <List>
          <li><strong>Device and log data:</strong> IP address, device type, operating system, app version, browser, time stamps, and the requests your app makes to our servers.</li>
          <li><strong>Product analytics:</strong> which screens you open and which features you use, linked to your account ID (see PostHog in Section 4).</li>
          <li><strong>Error reports:</strong> crash and error details from the app and our servers (see Sentry in Section 4).</li>
          <li><strong>Push token:</strong> if you allow notifications, a token that lets us send them to your device.</li>
          <li><strong>Cookies and local storage:</strong> see Section 12.</li>
        </List>

        <Sub>2.3 What we get from others</Sub>
        <List>
          <li><strong>Google or Apple sign-in:</strong> your name and email (or Apple's private relay address).</li>
          <li><strong>App stores and Stripe:</strong> confirmation that you paid, renewed, cancelled or were refunded.</li>
          <li><strong>Your trainer or institution:</strong> if a trainer imports a client list, or a coach invites you to an institution, they may give us your name, contact details, goals and notes about you (Section 9).</li>
          <li><strong>Other users:</strong> content that mentions or is sent to you, and reports about content.</li>
          <li><strong>Affiliates:</strong> the referral code in the link you used to sign up (Section 10).</li>
        </List>
        <p className="mt-2">
          We do <strong>not</strong> collect your precise location, contacts, or data from Apple Health, Google Health Connect or wearables.
          We do not perform facial recognition or create biometric identifiers from your video; videos are analysed for movement quality only.
        </p>
      </Section>

      <Section title="3. Why we use it, and our legal bases">
        <p>Under EU/UK law we must tell you the legal basis for each use. Elsewhere, the same uses apply.</p>
        <List>
          <li><strong>To provide the Service you signed up for</strong> (contract, GDPR Art. 6(1)(b)): your account, programs, workout and meal logging, form checks, coach chat, social features, subscriptions, and account emails such as verification codes and receipts.</li>
          <li><strong>Health data</strong> (explicit consent, GDPR Art. 9(2)(a)): we process injuries, conditions, medications, body measurements, body video and other health information only because you agreed to it when you set up your coach, and you can withdraw that consent (Section 7). If you withdraw it, features that depend on it (personalised programs, form checks, nutrition plans) stop working for you.</li>
          <li><strong>Optional features you switch on</strong> (consent, Art. 6(1)(a)): reference stills, push notifications, marketing email, and on the web, analytics cookies and session replay.</li>
          <li><strong>Security, fraud and abuse prevention, and keeping the Service working</strong> (legitimate interests, Art. 6(1)(f)): rate limiting, moderation of public and shared content, error monitoring, operational alerts, and keeping records of content flagged as abusive.</li>
          <li><strong>Improving Axiom</strong> (legitimate interests): aggregate product analytics. We do not use your health data to train AI models, and our AI providers do not use it to train theirs (Section 5).</li>
          <li><strong>Legal obligations</strong> (Art. 6(1)(c)): tax and accounting records, responding to lawful requests, and reporting child sexual abuse material as US law requires.</li>
        </List>
        <p className="mt-2">
          We do not sell your personal data. We do not use it for targeted advertising, and we do not share it with advertisers or data brokers.
        </p>
      </Section>

      <Section title="4. Who we share it with">
        <p>
          We use the service providers ("processors") below. Each handles data only to provide its service to us, under a contract
          that limits what it can do with it. Unless stated otherwise, they process data in the United States.
        </p>
        <List>
          <li><strong>Anthropic (Claude):</strong> runs Anthropic's Claude models behind Anakin, the AI coach (in the app and in the personal-training tools), and helps personal trainers map spreadsheet columns when importing client lists. Receives your coach messages and the profile, training, nutrition, check-in and health details the coach needs to answer you.</li>
          <li><strong>OpenAI:</strong> every other AI request that contains health information goes to OpenAI directly: program generation, nutrition plans, reading your workout and coach notes, the older chat screen, and message, check-in and program drafts for personal trainers. OpenAI also provides voice-note transcription (Whisper), automated moderation of messages, comments, posts and profile photos, and the text embeddings used to find relevant coaching material. Receives the text, audio or image being processed.</li>
          <li><strong>Google Cloud (Vertex AI / Gemini, Cloud Storage):</strong> analyses form-check and lift-diagnostic videos, meal, label and order photos, and looks up foods you search or scan; video is held briefly in Google Cloud Storage while it is analysed.</li>
          <li><strong>OpenRouter:</strong> routes AI requests that contain no health information (for example feed summaries, recipe text and meal descriptions you type) to open-weight models. Our main model is pinned to US-hosted providers (Fireworks, Together AI, DeepInfra and Baseten), and every request is restricted to providers that do not store prompts or train on them. Prompts that contain health information are never sent through OpenRouter.</li>
          <li><strong>Stripe:</strong> web subscription billing, and payouts to affiliates (Stripe Connect). Receives your email, name and account ID.</li>
          <li><strong>Apple (App Store) and Google (Google Play):</strong> in-app subscription billing; we receive transaction IDs and status. Also Sign in with Apple and Google sign-in.</li>
          <li><strong>SendGrid (Twilio):</strong> sends our emails. Receives your email address and the email content.</li>
          <li><strong>Twilio (SMS):</strong> sends operational alerts to Axiom's founder, for example when an account is created, someone signs in, a coach joins the coaching beta list, or a server error happens. Sign-up, sign-in and coach beta alerts include the person's name and email address (coach beta alerts also include the social handle, client count and coaching type they gave us); they go only to Axiom staff and are not used for marketing. We do not send you marketing text messages.</li>
          <li><strong>PostHog:</strong> product analytics, linked to your account ID. On the web, analytics cookies and session replay run only after you accept them in the cookie banner, and session replay masks what you type. Session replay is off in the mobile apps.</li>
          <li><strong>Sentry:</strong> crash and error reports from the apps and our servers, which may include device details and the part of a request that failed.</li>
          <li><strong>Expo:</strong> delivers push notifications and app updates. Receives your push token and the notification text.</li>
          <li><strong>Amazon Web Services and Cloudflare:</strong> host our servers, database and website, and protect them from attacks. United States.</li>
          <li><strong>Open Food Facts and USDA FoodData Central:</strong> we look up barcodes and food names in these public databases. We send only the barcode or food name, never anything about you. Food data from Open Food Facts is available under the Open Database License.</li>
          <li><strong>YouTube:</strong> exercise demonstration videos are embedded from YouTube, which may collect data under Google's privacy policy when you play them.</li>
        </List>
        <p className="mt-2">We also share data:</p>
        <List>
          <li>with the people you choose to share with: friends, group members, your trainer or institution coach (Sections 8 and 9);</li>
          <li>when the law requires it, or to protect someone's safety, including reports to the National Center for Missing &amp; Exploited Children;</li>
          <li>with a buyer or successor if Axiom is sold or merged, who must keep honouring this policy.</li>
        </List>
        <p className="mt-2">
          If you message Axiom's Instagram account, Meta passes that message and your Instagram user ID to us.
        </p>
      </Section>

      <Section title="5. AI and automated processing">
        <p>
          Axiom's coaching, program generation, form feedback and meal estimates are produced by AI models from Anthropic, OpenAI and Google
          (and, for requests without health information, open-weight models reached through OpenRouter), combined with our own deterministic calculations (for example estimated one-rep max, strength scores and calorie targets).
        </p>
        <List>
          <li><strong>No training on your data.</strong> We use these providers' business APIs, under which your inputs are not used to train their models. We do not use your health data, videos, photos or chats to train models of our own.</li>
          <li><strong>Minimised prompts.</strong> We send each provider what the feature needs, not your whole account, and never your password or payment details.</li>
          <li><strong>AI can be wrong.</strong> Output is coaching information, not medical advice (see our <Link href="/terms" className="text-primary hover:underline">Terms</Link>). Changes to your program are proposed and wait for your approval.</li>
          <li><strong>No significant automated decisions.</strong> We do not make decisions with legal or similarly significant effects about you by automated means alone.</li>
        </List>
      </Section>

      <Section title="6. How long we keep it">
        <List>
          <li><strong>Your account and everything in it</strong> (profile, logs, programs, coach conversations and memory, meals, check-ins, posts, messages): kept while your account exists. Coach conversations are not automatically pruned; they are deleted when you delete your account.</li>
          <li><strong>When you delete your account:</strong> deletion is immediate and permanent. We do not keep a recovery copy, and you cannot undo it. At the same time we cancel any web (Stripe) subscription, delete your analytics profile at PostHog, and remove your address from our blog subscriber list. Nightly database backups are kept for <strong>7 days</strong>, so a copy of your data can remain in a backup for up to 7 days; where we keep an encrypted off-site copy of those backups, it is kept for up to <strong>30 days</strong>. Backups are used only to recover from a failure, and if one is ever restored we delete your account again.</li>
          <li><strong>Form-check and diagnostic videos:</strong> deleted as soon as analysis finishes; a storage rule in Google Cloud Storage deletes any leftover copy within <strong>1 day</strong>. We do not keep the video. The one exception: if our automated safety screening flags a video as possible child sexual abuse material, it is withheld from deletion so a person can review it and, if confirmed, preserved and reported as US law requires.</li>
          <li><strong>Reference stills:</strong> kept with the analysis until you delete that analysis or your account.</li>
          <li><strong>Meal, label and order photos:</strong> used to estimate the meal. We keep the estimate in your log, not the photo, unless you put the photo in a post or message.</li>
          <li><strong>Voice notes:</strong> the audio is used for transcription and not kept; the text is kept like any other message.</li>
          <li><strong>Moderation records:</strong> if our moderation system flags content as abusive, we keep a short excerpt, the category and the date, even after the account is deleted, so that people cannot erase a record of abuse by re-registering. They are kept for up to [MODERATION RECORD RETENTION — suggest 2 years].</li>
          <li><strong>Billing records:</strong> kept as long as tax law requires (up to 7 years). These are held mainly by Stripe, Apple and Google.</li>
          <li><strong>Server logs:</strong> web-server access logs are kept for 14 days; application logs are overwritten on a rolling basis once they reach a fixed size limit. Error reports in Sentry and analytics events in PostHog are kept for the retention period of our plan with those providers.</li>
          <li><strong>Blog subscriber list:</strong> until you unsubscribe; we keep your address on a do-not-email list after that so the unsubscribe sticks.</li>
          <li><strong>Coaching beta list</strong> (the For coaches page): what you entered in the form, plus the time you gave consent and the IP address and browser it came from (kept as a record of that consent), until you unsubscribe or ask us to delete it. After you unsubscribe we keep your address marked as unsubscribed so we don't email it again.</li>
        </List>
      </Section>

      <Section title="7. Your rights and choices">
        <List>
          <li><strong>Access and export:</strong> download a copy of your data from Settings in the app or on the web. It comes as a machine-readable file, which also covers your right to data portability.</li>
          <li><strong>Correction:</strong> edit your profile, logs and coach notes in the app, or ask the coach to update them.</li>
          <li><strong>Deletion:</strong> delete your account in the app (Settings → Delete Account) or on the web (Settings → Delete account), or see <Link href="/delete-account" className="text-primary hover:underline">{LEGAL.site}/delete-account</Link>. You can also delete individual logs, meals, analyses, posts and messages.</li>
          <li><strong>Withdraw consent:</strong> turn off reference stills, notifications or marketing email in Settings; unsubscribe from any marketing email; change cookie choices with the "Cookie settings" link on our website; or withdraw consent to health-data processing by deleting that data or your account. Withdrawing consent does not affect what we did before.</li>
          <li><strong>Object or restrict:</strong> object to processing based on legitimate interests (for example analytics) by emailing <Mail />.</li>
          <li><strong>Complain:</strong> you can complain to your local data protection authority (in the UK, the ICO at ico.org.uk). We would appreciate the chance to fix it first.</li>
        </List>
        <p className="mt-2">
          Anything you cannot do in the app, email <Mail />. We answer within 30 days (45 days where US state law allows), and may ask you to confirm
          the request from the email on your account so nobody can get your data by pretending to be you. You can use an authorised agent where the law allows.
          We will not treat you differently for using your rights.
        </p>
      </Section>

      <Section title="8. Social features, groups and Train Together">
        <List>
          <li><strong>Profile:</strong> your name, username and profile photo can be found by other Axiom users through search.</li>
          <li><strong>Posts:</strong> visible to your friends, or to everyone on Axiom if you choose a public post. Comments and reactions are visible to people who can see the post.</li>
          <li><strong>Direct messages and group chats:</strong> visible to the people in the conversation. Messages are scanned automatically for abuse (Section 4); we do not routinely read them, but may when investigating a report, for safety, or when the law requires.</li>
          <li><strong>Groups and Train Together:</strong> members of a group you join see your name, username and photo, your group messages, which days you logged a workout, and, for Train Together, the planned focus of your sessions (for example "legs" on Tuesday) so the group can find shared training days. They do not see your weights, body data, nutrition, health information or coach chats.</li>
          <li><strong>Shared workout cards</strong> show what you choose to put on them.</li>
        </List>
        <p className="mt-2">Think before sharing health information in posts or messages; other people may copy what you share.</p>
      </Section>

      <Section title="9. Personal trainers and institutions">
        <Sub>If you train with a personal trainer on Axiom</Sub>
        <List>
          <li>When you link your account to a trainer, the trainer can see your training, program, workout logs, body-weight trend, nutrition logs, check-in answers and messages between you, so they can coach you. You can unlink at any time.</li>
          <li>Trainers can use Axiom's AI to help draft messages, check-ins and programs for you. The trainer reviews what is sent.</li>
          <li>A trainer may have imported information about you from their own records (for example a client spreadsheet with your name, contact details, goals, injuries or notes) before you joined, or without you joining. For that information the trainer is the controller and Axiom processes it for them under our <Link href="/trainer-terms" className="text-primary hover:underline">Trainer Terms</Link>. Ask your trainer first; you can also email <Mail /> and we will pass the request on and help delete it.</li>
        </List>
        <Sub>If you join an institution (a team, gym or school)</Sub>
        <List>
          <li>The institution's coaches can see your name, email, age, training, body weight, nutrition logs and wellness check-ins (mood, stress, sleep), to coach you. Ask to leave the institution at any time and the sharing stops.</li>
        </List>
      </Section>

      <Section title="10. Affiliates and referrals">
        <p>
          If you sign up through an affiliate's referral link, we record the referral code with your account and your subscription so we can give
          you the referral discount or trial and pay the affiliate a commission. The affiliate sees commission amounts, not your name, email or any
          of your training or health data. Affiliates are paid through Stripe Connect, which collects the information needed for payouts and tax.
          See the <Link href="/affiliate-terms" className="text-primary hover:underline">Affiliate Terms</Link>.
        </p>
      </Section>

      <Section title="11. Emails">
        <List>
          <li><strong>Account emails</strong> (verification codes, password resets, receipts, security notices, your welcome email) are part of the Service.</li>
          <li><strong>Marketing email</strong> (blog posts, product news, offers) is sent only if you opted in. Every one has an unsubscribe link that works in one click.</li>
          <li><strong>Blog subscribers</strong> who are not Axiom users are added only after confirming by email.</li>
          <li><strong>Coaching beta list:</strong> trainers who sign up on the <Link href="/coaches" className="text-primary hover:underline">For coaches</Link> page, and tick the box asking for email about the beta and launch, get a confirmation email, their invite and launch news. Every one has an unsubscribe link.</li>
          <li>The <strong>weekly wins email</strong> is a summary of your own week; turn it off with the link in the email or in your notification settings.</li>
        </List>
      </Section>

      <Section title="12. Cookies, local storage and analytics">
        <List>
          <li><strong>Strictly necessary:</strong> a sign-in cookie (and secure storage on your phone) that keeps you logged in, and storage that remembers your settings and cookie choice. These cannot be turned off.</li>
          <li><strong>Analytics (website, optional):</strong> PostHog cookies and local storage, and session replay with typed text masked. Off until you accept them in the cookie banner; change your choice any time with "Cookie settings".</li>
          <li><strong>Referral:</strong> if you arrive through a referral link, we store the code in your browser until you sign up.</li>
          <li>We do not use advertising cookies or third-party ad trackers.</li>
        </List>
      </Section>

      <Section title="13. Children and teens">
        <List>
          <li><strong>Under 13:</strong> Axiom is not for children under 13. If the date of birth given at sign-up shows someone is under 13, we refuse the account and delete what was collected. If you believe a child under 13 is using Axiom, email <Mail /> and we will delete the account.</li>
          <li><strong>13 to 17:</strong> teens may use Axiom with a parent or guardian's permission. In the EU and UK, if you are under the age of digital consent in your country (13 to 16), a parent or guardian must agree for you. For users under 18, reference stills are turned off on our servers and cannot be switched on. If we cannot tell your age, we treat you as under 18 for this purpose.</li>
        </List>
      </Section>

      <Section title="14. International transfers">
        <p>
          Axiom and its processors are based in the United States, so if you use Axiom from elsewhere your data is transferred to the US.
          For transfers from the EEA, UK and Switzerland we rely on the EU-US Data Privacy Framework (and its UK and Swiss extensions) where the
          provider is certified, and otherwise on the European Commission's Standard Contractual Clauses (with the UK Addendum), plus encryption in
          transit. Email <Mail /> for a copy of the relevant safeguards.
        </p>
      </Section>

      <Section title="15. Security">
        <p>
          We use encryption in transit (TLS), hashed passwords, access controls on our servers and database, automated abuse detection, and regular
          security reviews. No system is perfectly secure. If a breach affects your data, we will tell you and the authorities as the law requires.
        </p>
      </Section>

      <Section title="16. US state privacy rights">
        <Sub>California (CCPA/CPRA)</Sub>
        <p className="mt-1">In the last 12 months we collected these categories of personal information, for the purposes in Section 3, from the sources in Section 2, and disclosed them to the service providers in Section 4:</p>
        <List>
          <li>Identifiers (name, email, username, account and device IDs, IP address)</li>
          <li>Customer records and commercial information (subscription status and history)</li>
          <li>Characteristics of protected classifications (age, sex)</li>
          <li>Internet or network activity (app and website usage)</li>
          <li>Audio and visual information (voice notes, body video, reference stills, photos)</li>
          <li>Sensitive personal information: account login, and health information (injuries, conditions, medications, body measurements)</li>
          <li>Inferences (training level, suggested targets)</li>
        </List>
        <p className="mt-2">
          We do <strong>not sell</strong> personal information and do <strong>not share</strong> it for cross-context behavioural advertising, and have not
          done so in the last 12 months. We do not knowingly sell or share data of anyone under 16. We use sensitive personal information only to provide
          the Service you asked for, as allowed by Cal. Code Regs. tit. 11 § 7027(m), so the "limit the use of my sensitive personal information" right does
          not require a separate link. You have the rights to know, delete, correct, and not be discriminated against; use them as described in Section 7.
        </p>
        <p className="mt-2">
          <strong>Medical information (CMIA):</strong> to the extent the California Confidentiality of Medical Information Act applies to health information
          you give us, we keep it confidential and do not disclose it except to provide the Service, with your authorisation, or as the law permits.
        </p>
        <Sub>Washington, Nevada and other states</Sub>
        <p className="mt-1">
          Our <Link href="/health-data" className="text-primary hover:underline">Consumer Health Data Privacy Policy</Link> explains your rights under
          Washington's My Health My Data Act, Nevada SB 370 and similar laws. Residents of other states with privacy laws (for example Colorado, Connecticut,
          Virginia, Texas, Oregon) have similar rights to access, correct, delete and port data, to opt out of sale, targeted ads and profiling (we do none of these),
          and to appeal our decision on a request: reply to our decision email with "Appeal" in the subject, and if you still disagree you can contact your state Attorney General.
        </p>
        <Sub>Canada</Sub>
        <p className="mt-1">You can access and correct your personal information and withdraw consent under PIPEDA and provincial laws, as described in Section 7.</p>
      </Section>

      <Section title="17. Changes to this policy">
        <p>
          We will post any changes here and update the date at the top. If a change is material, for example a new kind of data or a new way of
          sharing health data, we will tell you in the app or by email before it takes effect and, where the law requires, ask for your consent again.
        </p>
      </Section>

      <Section title="18. Contact us">
        <p>
          Email <Mail /> or write to {LEGAL.entity}, {LEGAL.postalAddress}. EU representative: {LEGAL.euRepresentative}. UK representative: {LEGAL.ukRepresentative}.
        </p>
      </Section>
    </LegalPage>
  );
}
