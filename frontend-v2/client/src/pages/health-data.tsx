/*
 * ============================================================================
 *  <!-- Draft for counsel review --> 16 October 2026
 *  Consumer Health Data Privacy Policy: Washington My Health My Data Act
 *  (RCW 19.373, esp. .020 policy contents, .030 consent, .040 rights, .050
 *  processors, .070 no sale without authorisation, .080 geofencing) and Nevada
 *  SB 370 (NRS 603A.400–.550). RCW 19.373.020(1)(b) requires a prominent link
 *  to this page on the homepage: see the footer in pages/features.tsx.
 *  Applies to ALL users (we treat health data the same everywhere).
 *  Assumes the 2026-10 LLM rerouting shipped (health-data prompts to OpenAI
 *  directly, coach agent on Anthropic, OpenRouter only for non-health prompts
 *  on US hosts with data_collection 'deny'); if not, Section 4 is inaccurate.
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LEGAL, Mail, Section, List } from "@/components/legal/LegalPage";

const link = "text-primary hover:underline";

export default function HealthDataPolicy() {
  return (
    <LegalPage
      title="Consumer Health Data Privacy Policy"
      intro={
        <p>
          This policy covers "consumer health data" as defined by Washington's My Health My Data Act, Nevada's consumer health data law (SB 370)
          and similar state laws. We apply it to every Axiom user, wherever you live. It adds to our{" "}
          <Link href="/privacy" className={link}>Privacy Policy</Link>, which covers everything else.
        </p>
      }
    >
      <Section title="1. Who is responsible">
        <p>{LEGAL.entity} ("Axiom"), {LEGAL.postalAddress}. Contact: <Mail />.</p>
      </Section>

      <Section title="2. The consumer health data we collect">
        <List>
          <li><strong>Body measurements and characteristics:</strong> height, weight and weight history, sex, age and date of birth, body-composition goals.</li>
          <li><strong>Health conditions and treatment:</strong> injuries and pain, medical conditions, medications and supplements, hormonal factors (for example pregnancy, postpartum, menstrual cycle), and your answers to the health screening questions in the coach intake.</li>
          <li><strong>Fitness and bodily function:</strong> workouts, sets, weights, training history, estimated strength, recovery, sleep, stress, energy and mood check-ins.</li>
          <li><strong>Nutrition:</strong> meals, meal and label photos, calorie and nutrient intake and targets, dietary restrictions and allergies you tell us about.</li>
          <li><strong>Images and video of your body:</strong> form-check and lift-diagnostic videos, and reference stills if you switch them on.</li>
          <li><strong>Voice and text about your health:</strong> voice notes, coach conversations and the coach's notes about you.</li>
          <li><strong>Inferences:</strong> things we derive, such as training level, suggested calorie targets, or that a movement may be aggravating an injury you described.</li>
          <li>If you train with a personal trainer, information about you the trainer adds or imports, such as injury notes (see Section 6).</li>
        </List>
        <p className="mt-2">
          We do <strong>not</strong> collect precise location, and we do not use geofencing around healthcare facilities. We do not create biometric
          identifiers from your face or body.
        </p>
      </Section>

      <Section title="3. Where it comes from, and why we use it">
        <p><strong>Sources:</strong> you (what you enter, record, upload or tell the coach); your personal trainer or institution coach, if you link with one; and our own calculations from that data.</p>
        <p className="mt-2"><strong>Purposes.</strong> We collect and use consumer health data only to:</p>
        <List>
          <li>build and adjust your training program and nutrition targets;</li>
          <li>give you coaching, form feedback and meal estimates;</li>
          <li>show your progress and history;</li>
          <li>let your trainer or institution coach you, if you link with one;</li>
          <li>keep the Service safe (for example, steering the coach away from advice that conflicts with an injury you described) and fix errors;</li>
          <li>meet legal obligations.</li>
        </List>
        <p className="mt-2">
          We do not use it for advertising, we do not sell it, and we do not share it with anyone for their own purposes.
        </p>
      </Section>

      <Section title="4. Who we share it with">
        <p>
          We share consumer health data only with processors that handle it on our behalf, under contracts that bind them to our instructions,
          and with people you choose:
        </p>
        <List>
          <li><strong>Anthropic</strong>: AI coach (your coach messages and the health details the coach needs).</li>
          <li><strong>OpenAI</strong>: program generation, nutrition plans, reading workout and coach notes, the older chat screen, and drafts for personal trainers; also voice-note transcription, safety moderation of messages and images, and search over coaching material.</li>
          <li><strong>Google Cloud (Vertex AI / Gemini, Cloud Storage)</strong>: analysis of body videos and meal photos; temporary video storage.</li>
          <li><strong>Amazon Web Services and Cloudflare</strong>: hosting of our servers and database.</li>
          <li><strong>Sentry</strong>: error reports, which can occasionally include part of a request containing health data.</li>
          <li><strong>PostHog</strong>: product analytics events linked to your account ID, such as that you logged a workout or meal or which lift you chose (not the contents of your logs or chats).</li>
          <li><strong>Expo</strong>: push notification delivery (notification text, which may mention your training).</li>
          <li><strong>Your trainer, institution coach, friends or group members</strong>, only to the extent you link with them or share content with them (Privacy Policy Sections 8 and 9).</li>
        </List>
        <p className="mt-2">
          Requests containing health information are not sent to OpenRouter or to AI providers hosted outside the United States. The complete list of
          providers, with what each one does, is in our <Link href="/privacy" className={link}>Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="5. Your consent">
        <List>
          <li>We ask for your consent to collect and use consumer health data when you set up your coach, separately from accepting our Terms. We record when you gave it.</li>
          <li>We ask again, separately, before saving reference stills from a video.</li>
          <li>We will not share consumer health data beyond the processors and people listed in Section 4 without asking for your separate consent first, and we will never sell it without a signed authorisation that the law requires.</li>
          <li>You can withdraw consent at any time (Section 7).</li>
        </List>
      </Section>

      <Section title="6. If your trainer uploaded information about you">
        <p>
          A personal trainer may upload records about their clients. For that information the trainer decides what is collected and why, and Axiom
          processes it for the trainer. Ask your trainer to correct or delete it, or email <Mail /> and we will help, including deleting it if you are
          not an Axiom user.
        </p>
      </Section>

      <Section title="7. Your rights and how to use them">
        <p>You have the right to:</p>
        <List>
          <li><strong>Confirm and access:</strong> know whether we collect, share or sell your consumer health data (we never sell it), get a copy of it, and get a list of all third parties and affiliates with whom we have shared it, with their contact details.</li>
          <li><strong>Withdraw consent</strong> to our collection and sharing of your consumer health data.</li>
          <li><strong>Delete</strong> your consumer health data. We delete it from our systems and instruct our processors to delete it.</li>
        </List>
        <p className="mt-2"><strong>How:</strong></p>
        <List>
          <li><strong>In the app or on the web:</strong> Settings → download your data; Settings → Delete Account; delete individual logs, meals, check-ins and analyses; turn off reference stills.</li>
          <li><strong>By email:</strong> <Mail /> with "Health data request" in the subject, saying which right you want to use. To withdraw consent without deleting your account, say so; the features that depend on health data will then stop working for you.</li>
        </List>
        <p className="mt-2">
          We may need to confirm your request comes from you, usually by asking you to reply from the email on your account. We respond within 45
          days; if we need longer (up to another 45 days) we will tell you why. Requests are free up to twice a year. Account deletion in the app is
          immediate; we pass deletion requests to our processors within 30 days.
        </p>
      </Section>

      <Section title="8. If we say no: appeals">
        <p>
          If we decline your request, in whole or in part, you can appeal. Reply to our decision email, or email <Mail /> with "Health data appeal" in
          the subject. Someone who did not make the original decision will review it, and we will tell you the outcome and our reasons in writing within
          45 days. If the appeal is denied, you can contact the Washington State Attorney General (atg.wa.gov/file-complaint) or the Nevada Attorney
          General (ag.nv.gov), or your own state's Attorney General.
        </p>
      </Section>

      <Section title="9. How long we keep it, and security">
        <p>
          We keep consumer health data while your account exists and delete it when you delete it or your account. Body videos are deleted after analysis
          (and in all cases within 1 day). Nightly backups are kept for 7 days (an encrypted off-site copy, where we keep one, for up to 30 days) and are used only to recover from failures. Full details are in Privacy Policy Section 6. Access to consumer
          health data is limited to the staff and processors who need it to provide the Service, and it is encrypted in transit.
        </p>
      </Section>

      <Section title="10. Changes and contact">
        <p>
          If we change this policy in a way that affects how we collect, use or share consumer health data, we will update the date above and ask for
          your consent again where the law requires. Questions: <Mail />, or {LEGAL.entity}, {LEGAL.postalAddress}.
        </p>
      </Section>
    </LegalPage>
  );
}
