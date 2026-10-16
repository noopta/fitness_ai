/*
 * ============================================================================
 *  <!-- Draft for counsel review --> 16 October 2026
 *  Affiliate Terms (audit legal-report M2). Facts from code
 *  (backend/src/services/affiliateService.ts, routes/payments.ts):
 *  commissionRate default 0.40 of the pre-discount web price, referred users
 *  get 20% off (forever coupon) + a 30-day web trial, commissions recorded
 *  from Stripe invoices (web only; store/IAP purchases are not attributed),
 *  monthly payouts on the 1st in CAD to a Stripe Connect Express account,
 *  inactive affiliates accrue nothing. [SQUARE BRACKETS] = founder fills.
 *  Counsel: confirm Stripe Express is collecting W-9/W-8BEN and issuing
 *  1099s for US affiliates (dashboard setting, not visible in code).
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LEGAL, Mail, Section, Sub, List } from "@/components/legal/LegalPage";

const link = "text-primary hover:underline";

export default function AffiliateTerms() {
  return (
    <LegalPage
      title="Affiliate Terms"
      intro={
        <p>
          These Affiliate Terms apply if you join the Axiom affiliate program and share a referral link or code. They add to our{" "}
          <Link href="/terms" className={link}>Terms of Service</Link>. By finishing affiliate setup you agree to them.
        </p>
      }
    >
      <Section title="1. Joining">
        <List>
          <li>The program is by invitation or approval. You must be at least 18 and able to receive payouts through Stripe in your country.</li>
          <li>You are an independent contractor, not an employee, agent or partner of Axiom. You cannot make promises or sign anything on our behalf.</li>
        </List>
      </Section>

      <Section title="2. How referrals and commissions work">
        <List>
          <li>People who sign up through your link or code and subscribe to Axiom Pro on the web get the referral offer shown at checkout (currently 20% off and a 30-day free trial).</li>
          <li>You earn a commission on each paid web subscription payment from people you referred, at the rate shown in your affiliate dashboard (the standard rate is 40% of the price before the referral discount). Payments made through Apple or Google in-app purchase are not attributed to affiliates.</li>
          <li>A referral is credited only if our systems recorded your code at sign-up. We decide attribution from our records; if two affiliates claim a sign-up, the code recorded with the account wins.</li>
          <li>No commission is earned on: payments that are refunded, charged back or found to be fraudulent (and we may deduct those from future payouts); your own account or accounts you control; or sign-ups obtained in breach of these terms.</li>
          <li>Commissions stop accruing while your affiliate account is inactive or suspended.</li>
        </List>
      </Section>

      <Section title="3. Payouts">
        <List>
          <li>Payouts are made in <strong>Canadian dollars (CAD)</strong> to your Stripe Connect Express account, normally on the 1st of each month, for commissions earned and not yet paid. If your bank account is in another currency, Stripe converts it at its rate and may charge a fee.</li>
          <li>You must finish Stripe's onboarding (identity and bank details) before we can pay you. Commissions earned before you finish are held until you do, for up to 12 months; after that we may cancel them.</li>
          <li>Stripe's Connected Account Agreement applies to your Stripe account. Stripe, not Axiom, holds your bank details.</li>
        </List>
      </Section>

      <Section title="4. Taxes">
        <p>
          You are responsible for your own taxes on commissions. Stripe collects the tax information we are required to have (for example a US Form W-9, or a
          W-8BEN if you are outside the US) during onboarding, and where required, Stripe issues a Form 1099 on our behalf. In Canada, you are responsible
          for registering for and charging GST/HST if your affiliate income requires it. We may withhold payouts until we have the tax information the law requires.
        </p>
      </Section>

      <Section title="5. You must disclose that you are paid">
        <p>
          US law (the FTC's Guides Concerning the Use of Endorsements and Testimonials in Advertising, 16 CFR Part 255), Canada's Competition Act and similar
          rules elsewhere require you to tell people that you earn money when they sign up through your link. This applies every time you promote Axiom.
        </p>
        <Sub>Every post, video, story, email or page that mentions Axiom with your link or code must:</Sub>
        <List>
          <li>say clearly that you earn a commission or get something from Axiom, for example <em>"I earn a commission if you subscribe through my link"</em> or <em>"#ad: paid partnership with Axiom"</em>;</li>
          <li>put the disclosure where people will see it before they click: in the post itself, not only in a bio, behind a "see more" link, or at the end of a long video; in videos, say it out loud and show it on screen;</li>
          <li>use the platform's paid-partnership tool too, where there is one, but not instead of your own clear words.</li>
        </List>
        <Sub>You must also</Sub>
        <List>
          <li>only describe your honest, personal experience with Axiom; never post fake reviews, or reviews of features you have not used;</li>
          <li>not claim results that are not typical (for example a specific strength or weight change) unless you say clearly that results vary;</li>
          <li>not say or imply that Axiom gives medical advice, diagnoses or treats any condition, or that Axiom is endorsed by any doctor, certification body or podcast;</li>
          <li>not bid on "Axiom" or our brand names in search ads, impersonate Axiom, or create sites or accounts that look like ours;</li>
          <li>not send spam or unsolicited messages, and follow anti-spam laws (CAN-SPAM, CASL) in any email you send;</li>
          <li>not target your promotion at people under 18.</li>
        </List>
        <p className="mt-2">
          We may review your content and ask you to change or remove it. Failing to disclose, or making misleading claims, is a breach of these terms and can
          lead to suspension and loss of unpaid commissions for the affected referrals.
        </p>
      </Section>

      <Section title="6. Data">
        <p>
          Your dashboard shows commission amounts and subscription status for your referrals, not their names, email addresses or any training or health data.
          Do not try to identify the people you referred from that information. How we handle your own information as an affiliate is described in our{" "}
          <Link href="/privacy" className={link}>Privacy Policy</Link>. Keep your affiliate dashboard link private; tell us at <Mail to={LEGAL.supportEmail} /> if
          you think someone else has it, and we will issue a new one.
        </p>
      </Section>

      <Section title="7. Brand use">
        <p>
          We give you a limited, revocable licence to use the Axiom name and the materials we provide only to promote Axiom under these terms. Do not change our
          logo or imply a closer relationship than you have. The licence ends when your participation ends.
        </p>
      </Section>

      <Section title="8. Changes and ending">
        <List>
          <li>We may change the commission rate, referral offer or these terms with at least 30 days' notice by email or in your dashboard. Commissions already earned are paid at the rate in force when they were earned.</li>
          <li>Either of us can end your participation at any time. If we end it for reasons other than your breach, we pay commissions earned up to the end date at the next payout. If we end it because you broke these terms, we may cancel unpaid commissions connected to the breach.</li>
        </List>
      </Section>

      <Section title="9. Liability">
        <p>
          The liability limits, governing law and dispute terms in the <Link href="/terms" className={link}>Terms of Service</Link> apply. You agree to cover our
          reasonable costs if a claim against us arises from your promotion, including undisclosed or misleading claims.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>{LEGAL.entity}, {LEGAL.postalAddress}. Affiliate questions: <Mail to={LEGAL.supportEmail} />.</p>
      </Section>
    </LegalPage>
  );
}
