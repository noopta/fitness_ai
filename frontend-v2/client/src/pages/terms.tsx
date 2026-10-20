/*
 * ============================================================================
 *  <!-- Draft for counsel review --> 20 October 2026  (terms version "2026-10-20": §4 health screening, red flags, weight cutting)
 *  Updated per audit legal-report H1/C4/H3/M1: age 13+ with guardian
 *  permission, store-managed in-app subscriptions vs Stripe on the web,
 *  in-app/web deletion, minors carved out of arbitration and liability caps,
 *  processors moved to the Privacy Policy. [SQUARE BRACKETS] = founder fills.
 *  Counsel: confirm governing law (Delaware retained from the April draft)
 *  against where the operating entity is actually incorporated.
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LEGAL, Mail, Section, List } from "@/components/legal/LegalPage";

const link = "text-primary hover:underline";

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <Section title="1. Agreement to these Terms">
        <p>
          These Terms are an agreement between you and {LEGAL.entity} ("Axiom", "we", "us") for the Axiom apps, website and related services
          (the "Service"). By creating an account or using the Service you agree to these Terms (version {LEGAL.termsVersion}). Our{" "}
          <Link href="/privacy" className={link}>Privacy Policy</Link> and{" "}
          <Link href="/health-data" className={link}>Consumer Health Data Privacy Policy</Link> explain how we handle your data. If you do not agree,
          do not use the Service.
        </p>
        <p className="mt-2">
          Extra terms apply if you use Axiom as a personal trainer (<Link href="/trainer-terms" className={link}>Trainer Terms</Link>) or join our
          affiliate program (<Link href="/affiliate-terms" className={link}>Affiliate Terms</Link>).
        </p>
      </Section>

      <Section title="2. What Axiom is">
        <p>
          Axiom is an AI-assisted strength training and nutrition app. It includes lift diagnostics, program generation, an AI coach (Anakin),
          workout and meal logging, form feedback on videos, nutrition estimates, check-ins, social features, groups, and tools for personal trainers
          and institutions. Features differ between the free plan and Pro and may change over time.
        </p>
      </Section>

      <Section title="3. Not medical advice — please read">
        <p className="font-semibold text-foreground">
          AXIOM IS NOT A MEDICAL SERVICE. NOTHING IN THE SERVICE IS MEDICAL ADVICE, A DIAGNOSIS, OR TREATMENT.
        </p>
        <List>
          <li>Coaching, programs, "diagnostics", form feedback, calorie and macro targets and nutrition estimates are general fitness information. Words like "diagnostic" refer to training performance, not to your health.</li>
          <li>Talk to a doctor or other qualified clinician before starting a new program or diet, especially if you have an injury, pain, a heart, lung, metabolic or other medical condition, are pregnant or postpartum, take medication, have or have had an eating disorder, or are under 18.</li>
          <li>Do not ignore or delay professional medical advice because of something Axiom said.</li>
          <li>Stop exercising and get medical help if you feel chest pain, faintness, severe shortness of breath, sudden or sharp pain, or other worrying symptoms.</li>
          <li><strong>In an emergency, call your local emergency number (911 in the US and Canada, 112 in the EU, 999 in the UK).</strong> If you are thinking about harming yourself, call or text 988 in the US and Canada, or contact your local crisis line. Axiom cannot respond to emergencies.</li>
          <li>Photo-based nutrition estimates are approximate. Do not use them to manage a medical condition such as diabetes or a food allergy.</li>
        </List>
      </Section>

      <Section title="4. Exercise risk">
        <p>
          <strong>Strength training and exercise carry a risk of injury, and in rare cases serious injury or death.</strong> You choose whether and how to
          follow any suggestion, use proper technique and equipment, train within your limits, and stop if something hurts. To the extent the law allows,
          you accept these inherent risks. Nothing in these Terms limits liability that cannot legally be limited (Section 8).
        </p>
        <p className="mt-3"><strong>Health screening and red flags.</strong></p>
        <List>
          <li>When you join, and later in chat, Axiom asks about pain, injuries, symptoms and conditions. Some answers (for example pain or numbness down an arm or leg, an injury not yet cleared, or a heart or blood-pressure condition) are red flags: we recommend you see a doctor or physiotherapist before training, and we will not build heavy training around them.</li>
          <li>If you choose to train anyway (for example by starting a "gentle plan" before a clinician has checked you), or you tell us a clinician has cleared you, that is your decision and you make it at your own risk. We rely on what you tell us; we cannot examine you or verify a clearance. We keep a dated record of these choices (see the Privacy Policy).</li>
          <li>Stop and get medical help straight away if symptoms spread or get worse, or if you notice weakness, numbness in the groin or inner thighs, or changes in bladder or bowel control. These can be emergencies.</li>
        </List>
        <p className="mt-3"><strong>Weight cutting and making weight.</strong> If you compete in a weight class, Axiom can plan gradual fat loss toward a weigh-in, keeps planned loss within limits it considers safe, and will warn you when a pace carries more risk. Acute weight-cut methods (water loading, fluid, sodium or food restriction before a weigh-in, sweating or saunas) are your and your team's decisions, made under the supervision of your coach and a qualified professional. Axiom does not supervise or prescribe them, and rapid dehydration can cause serious harm.</p>
        <p className="mt-3"><strong>What you tell us.</strong> Plans are only as safe as the information behind them. Keep your injuries, conditions, medications and body weight up to date, and tell the coach when something changes. If what you tell us is wrong or incomplete, the advice may not suit you.</p>
      </Section>

      <Section title="5. AI-generated content">
        <List>
          <li>The Service uses AI models from third-party providers (listed in our <Link href="/privacy" className={link}>Privacy Policy</Link>) together with our own calculations.</li>
          <li>AI output can be wrong, incomplete, out of date, or unsuitable for you, even when it sounds confident. Check anything important, and use your own judgment.</li>
          <li>The coach is designed to stay within fitness and nutrition coaching and to point you to a clinician for medical questions, but it may not always do so. Do not rely on it for medical, mental-health, legal or financial decisions.</li>
          <li>Changes the coach suggests to your program or targets are proposals; they apply only when you approve them, and you can undo them.</li>
          <li>Do not try to make the coach produce harmful content or bypass its safeguards.</li>
        </List>
      </Section>

      <Section title="6. Who can use Axiom">
        <List>
          <li><strong>You must be at least 13.</strong> We ask for your date of birth to check this. Accounts of children under 13 are deleted.</li>
          <li><strong>If you are 13 to 17</strong>, you may use Axiom only with the permission of a parent or legal guardian, who must read and agree to these Terms for you and is responsible for your use. In the EU and UK, if you are under your country's age of digital consent, your parent or guardian must agree to our health-data processing for you. Some features are restricted for users under 18.</li>
          <li>You must give accurate information, including your date of birth, and keep your login secure. You are responsible for activity on your account. Tell us at <Mail to={LEGAL.supportEmail} /> if you think someone else has access.</li>
          <li>Usernames must be 3–30 letters, numbers or underscores and must not impersonate anyone or be offensive. We may change usernames that break this rule.</li>
          <li>If you use Axiom for an organisation, you confirm you can bind it to these Terms.</li>
        </List>
      </Section>

      <Section title="7. Subscriptions, trials, cancellation and refunds">
        <p>Some features need a paid Axiom Pro subscription. The price, billing period and any trial are shown before you confirm a purchase.</p>
        <List>
          <li><strong>Buying in the iPhone or Android app:</strong> the subscription is sold and billed by Apple (App Store) or Google (Google Play) through your store account, under the store's terms. Manage or cancel it in your device's subscription settings (iPhone: Settings → your name → Subscriptions; Android: Play Store → Payments &amp; subscriptions → Subscriptions). Refunds are handled by Apple or Google under their policies; we cannot issue them for store purchases.</li>
          <li><strong>Buying on the web:</strong> Pro is billed by Stripe at {LEGAL.webProPrice} per month (plus any applicable tax), unless a different price or discount is shown at checkout. Manage or cancel it on the web in Settings (which opens the Stripe billing portal), or email <Mail to={LEGAL.supportEmail} />.</li>
          <li><strong>Automatic renewal:</strong> every subscription renews automatically each month and your payment method is charged at the then-current price until you cancel. Cancel at least 24 hours before the renewal date to avoid the next charge. After you cancel you keep Pro until the end of the period you paid for.</li>
          <li><strong>Free trials:</strong> some offers include a free trial, for example a store introductory offer or a 30-day trial with an affiliate referral link on the web. The length is shown before you start. Unless you cancel before the trial ends, your subscription starts and you are charged automatically when the trial ends. One trial per person.</li>
          <li><strong>Refunds for web purchases:</strong> payments are non-refundable except where the law requires (for example, EU and UK consumers may cancel within 14 days of first purchase; by starting to use Pro immediately you agree that the refund may be reduced for the time used) or where we decide otherwise.</li>
          <li><strong>Price changes:</strong> we will tell you at least 30 days before a price increase takes effect, and you can cancel before then. Store subscriptions follow Apple's and Google's price-change rules.</li>
          <li><strong>Deleting your account does not cancel a store subscription.</strong> Cancel it with Apple or Google first. If you delete your account while a web subscription is active, we cancel it; if you are charged after deleting, email us and we will refund that charge.</li>
          <li><strong>Free plan:</strong> the free plan may have usage limits that can change.</li>
        </List>
      </Section>

      <Section title="8. Limits on our liability">
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE EXTENT THE LAW ALLOWS, WE DISCLAIM ALL WARRANTIES, INCLUDING MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND NON-INFRINGEMENT, AND WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR
          PUNITIVE DAMAGES, OR LOST PROFITS OR DATA. TO THE EXTENT THE LAW ALLOWS, OUR TOTAL LIABILITY FOR ALL CLAIMS IS LIMITED TO THE GREATER OF WHAT YOU
          PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR US$100.
        </p>
        <p className="mt-2">
          These limits do not apply to liability for death or personal injury caused by our negligence, fraud, gross negligence or wilful misconduct,
          or anything else that cannot be limited by law. If you live in the EU, UK or another place whose consumer law gives you rights that cannot be
          waived, these Terms do not take those rights away. <strong>If you are under 18, this section, Section 9 (release and indemnity) and Section 18
          (arbitration) do not apply to you</strong>, and your rights are those the law gives you.
        </p>
      </Section>

      <Section title="9. Release and indemnity">
        <p>
          To the extent the law allows, you release Axiom and its officers, employees and contractors from claims arising from your voluntary choice
          to follow training or nutrition information, except where caused by our negligence or misconduct. You agree to cover our reasonable costs
          if your content or a breach of these Terms by you causes a claim against us.
        </p>
      </Section>

      <Section title="10. Your content">
        <List>
          <li>You own what you post or upload ("your content"). You give us a worldwide, non-exclusive, royalty-free licence to host, store, process, display and share it as needed to run the Service and as your settings direct (for example, showing a post to your friends). The licence ends when you delete the content or your account, except for copies others have already re-shared and records we must keep (see the Privacy Policy).</li>
          <li>You confirm you have the right to post your content and that it does not break the law or anyone's rights.</li>
          <li>Do not upload other people's personal or health information without their permission. Trainers uploading client data must follow the Trainer Terms.</li>
        </List>
      </Section>

      <Section title="11. Community rules and moderation">
        <p>You must not post, send or share content that:</p>
        <List>
          <li>sexualises minors in any way. We report child sexual abuse material to the National Center for Missing &amp; Exploited Children and to the police;</li>
          <li>harasses, bullies, threatens, or promotes hatred or violence against anyone;</li>
          <li>is sexually explicit, or shares anyone's intimate images without consent;</li>
          <li>encourages self-harm, eating disorders, extreme restriction, or unsafe drug use including steroids or SARMs;</li>
          <li>gives dangerous health or medical misinformation;</li>
          <li>is spam, a scam, or unauthorised advertising (affiliates must follow the Affiliate Terms disclosure rules);</li>
          <li>impersonates someone, or infringes copyright, trademark or privacy rights;</li>
          <li>is illegal.</li>
        </List>
        <p className="mt-2">
          We check public and shared content automatically and may hide or block content that looks like it breaks these rules. You can report
          content with the in-app Report option, or email <Mail to={LEGAL.supportEmail} />. We aim to
          review reports within 24 hours. We may remove content, restrict features, or suspend or close accounts that break these rules. If we
          act on your content or account and you think we got it wrong, reply to our notice or email us and a person will look at it again.
        </p>
      </Section>

      <Section title="12. Acceptable use">
        <p>Do not: break the law using Axiom; access other accounts or our systems without permission; interfere with or overload the Service; scrape or bulk-extract data; reverse engineer the apps except where the law allows; use the Service to build a competing product; or resell it without our written permission.</p>
      </Section>

      <Section title="13. Deleting your account">
        <p>
          You can delete your account at any time in the app (Settings → Delete Account), on the web (Settings → Delete account), or by following
          the instructions at <Link href="/delete-account" className={link}>{LEGAL.site}/delete-account</Link>. Deletion is immediate and permanent: we
          cannot restore the account afterwards. You can download your data first from Settings. See Section 7 about cancelling a subscription.
        </p>
      </Section>

      <Section title="14. Our intellectual property">
        <p>
          Axiom's software, design, brand, and the content we create belong to us or our licensors. We give you a personal, non-transferable,
          revocable licence to use the Service under these Terms. Do not copy, modify or distribute it without our written permission.
        </p>
        <p className="mt-2">
          Axiom is not affiliated with or endorsed by the Huberman Lab podcast or any certification body. This includes any certification body
          mentioned in the Service (such as NASM, ACE, ISSA, NSCA or NFPT). Names of podcasts, books, organisations and brands are used only to identify sources or products and belong to their owners.
        </p>
      </Section>

      <Section title="15. Third-party services">
        <p>
          The Service relies on third-party providers, listed with what they do in our <Link href="/privacy" className={link}>Privacy Policy</Link>.
          Some features link to or embed third-party content (for example YouTube videos, or food data from Open Food Facts under the Open Database License);
          their own terms apply to that content and we are not responsible for it.
        </p>
      </Section>

      <Section title="16. Copyright complaints">
        <p>
          If you believe content on Axiom infringes your copyright, email <Mail to={LEGAL.supportEmail} /> with: the work; where the infringing content is;
          your contact details; a statement that you believe in good faith the use is not authorised; and a statement, under penalty of perjury, that your notice
          is accurate and you are the owner or authorised to act for them, with your physical or electronic signature. Postal notices: {LEGAL.postalAddress}.
          We remove infringing content and close the accounts of repeat infringers.
        </p>
      </Section>

      <Section title="17. Ending these Terms">
        <p>
          You can stop using Axiom and delete your account at any time. We may suspend or end your access if you seriously or repeatedly break these
          Terms, if the law requires, or if we stop offering the Service; where reasonable we will tell you first and give you a chance to download your
          data. If we end a paid web subscription for reasons other than your breach, we will refund the unused part. Sections that by their nature should
          survive (for example 3, 4, 8, 9, 14, 18 and 19) survive.
        </p>
      </Section>

      <Section title="18. Disputes and arbitration (US users)">
        <p><strong>This section affects your legal rights. It does not apply to users under 18 or to users outside the United States.</strong></p>
        <p className="mt-2">
          Please email <Mail to={LEGAL.supportEmail} /> first; most problems can be solved that way. If we cannot resolve a dispute within 60 days, you and
          Axiom agree to resolve it by binding individual arbitration under the American Arbitration Association's Consumer Arbitration Rules, instead of
          in court, except that either of us may bring an individual claim in small-claims court, and either of us may ask a court to stop infringement of
          intellectual property. <strong>You and Axiom waive the right to a jury trial and to take part in a class or representative action.</strong> You can
          opt out of this section by emailing us within 30 days of first accepting these Terms with your name, account email and a statement that you opt out.
        </p>
      </Section>

      <Section title="19. Governing law">
        <p>
          These Terms are governed by the laws of the State of Delaware, USA, without regard to conflict-of-law rules, except that if you are a consumer
          outside the US, the mandatory consumer laws of your country of residence still apply and you may bring claims in your local courts.
        </p>
      </Section>

      <Section title="20. App store terms">
        <p>If you downloaded Axiom from the Apple App Store or Google Play:</p>
        <List>
          <li>These Terms are between you and Axiom, not Apple or Google, and Axiom, not Apple or Google, is responsible for the app and its content.</li>
          <li>Apple and Google have no obligation to provide support or maintenance. If the app fails to meet an applicable warranty, you may notify Apple, which may refund the app's purchase price (if any); Apple has no other warranty obligation to the extent the law allows.</li>
          <li>Apple is not responsible for claims about the app, including product liability, consumer protection, privacy, or intellectual property claims.</li>
          <li>Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you.</li>
          <li>You confirm you are not in a country under a US government embargo and are not on a US government restricted-party list.</li>
          <li>In-app purchases are also governed by the store's terms (Section 7).</li>
        </List>
      </Section>

      <Section title="21. General">
        <List>
          <li>These Terms, the policies they link to, and any extra terms for features you use are the whole agreement between you and us about the Service.</li>
          <li>If part of these Terms is unenforceable, the rest still applies. If we do not enforce a right, we have not waived it.</li>
          <li>You may not transfer these Terms without our permission. We may transfer them to a successor who takes over the Service, without reducing your rights.</li>
          <li>We are not responsible for delays caused by events outside our reasonable control.</li>
          <li>Using Axiom does not create a doctor-patient, therapist-client or other professional relationship with Axiom.</li>
        </List>
      </Section>

      <Section title="22. Changes">
        <p>
          We may update these Terms. We will post the new version here with a new date and, for material changes, tell you in the app or by email at least
          14 days before they take effect, unless the change is required by law or for safety. If you keep using Axiom after that, the new Terms apply; if you
          do not agree, you can delete your account.
        </p>
      </Section>

      <Section title="23. Contact">
        <p>
          {LEGAL.entity}, {LEGAL.postalAddress}. Email <Mail to={LEGAL.supportEmail} />; privacy questions <Mail />.
        </p>
      </Section>
    </LegalPage>
  );
}
