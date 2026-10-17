/*
 * ============================================================================
 *  <!-- Draft for counsel review --> 16 October 2026
 *  Trainer Terms + data processing terms for the personal-training tools
 *  (audit legal-report C3). Allocates roles: the trainer is the controller of
 *  client data they upload/import; Axiom is their processor (GDPR Art. 28,
 *  CCPA service provider, MHMDA processor). Facts from code: prospects never
 *  invited are purged after 90 days (PROSPECT_RETENTION_DAYS), raw import
 *  sheets are purged after confirm/undo, trainer billing is Stripe Connect
 *  standard with a 0% platform fee, AI drafts run on OpenAI / Anthropic.
 *  [SQUARE BRACKETS] = founder fills.
 * ============================================================================
 */
import { Link } from "wouter";
import { LegalPage, LEGAL, Mail, Section, Sub, List } from "@/components/legal/LegalPage";

const link = "text-primary hover:underline";

export default function TrainerTerms() {
  return (
    <LegalPage
      title="Trainer Terms"
      intro={
        <p>
          These Trainer Terms apply when you use Axiom's personal-training tools to coach clients: the client roster, spreadsheet import,
          programs, check-ins, messages, AI drafts and client billing. They add to our{" "}
          <Link href="/terms" className={link}>Terms of Service</Link>. If they conflict, these Trainer Terms win for the personal-training tools.
        </p>
      }
    >
      <Section title="1. Who can use the trainer tools">
        <List>
          <li>The trainer tools are currently available by invitation only. We may change who can use them, or end access, at any time.</li>
          <li>You must be at least 18 and, where your work requires it, hold the qualifications and insurance your local rules require. You are responsible for the coaching you give.</li>
          <li>If you use the tools for a business, you confirm you can bind that business to these terms.</li>
        </List>
      </Section>

      <Section title="2. Your role and ours for client data">
        <p>
          <strong>You are the controller</strong> (in US terms, the "business") for personal information about your clients and prospects that you upload,
          import, type in, or collect through Axiom, including names, contact details, goals, injury and health notes, and session notes. You decide what
          is collected and why. <strong>Axiom is your processor</strong> (service provider) for that information: we handle it only to provide the
          trainer tools to you, on your instructions as set out in these terms, and not for our own purposes.
        </p>
        <p className="mt-2">
          Once a client links their own Axiom account to you, the data in their account is theirs and is covered by our{" "}
          <Link href="/privacy" className={link}>Privacy Policy</Link>; you see it because they chose to share it with you, and they can stop sharing at any time.
        </p>
      </Section>

      <Section title="3. What you promise about client data">
        <List>
          <li><strong>Authority:</strong> you have the right to upload each person's information to Axiom, including any health information, and you have given them any notice and obtained any consent the law requires (for example under GDPR, Canadian privacy law, HIPAA if it applies to you, or state consumer health data laws such as Washington's My Health My Data Act). You confirm this each time you import.</li>
          <li><strong>Minimum necessary:</strong> upload only what you need to coach. Remove columns you do not need (for example payment card numbers, government IDs or medical records) before importing. Never upload passwords or full card numbers.</li>
          <li><strong>No minors without a guardian:</strong> do not add anyone under 18 without a parent or guardian's permission, and never anyone under 13.</li>
          <li><strong>Requests:</strong> you handle access, correction and deletion requests from your clients. We will help: see Section 6.</li>
          <li><strong>Messages you send:</strong> messages, check-ins and automated reminders sent from Axiom on your behalf are your communications. You are responsible for having permission to contact the people you message, and for following anti-spam rules.</li>
        </List>
      </Section>

      <Section title="4. What we do with client data">
        <List>
          <li>We store it on our US servers (Amazon Web Services and Cloudflare), keep it confidential, and limit staff access to what is needed to run and support the Service.</li>
          <li>We use the sub-processors named in our <Link href="/privacy" className={link}>Privacy Policy</Link>. For the trainer tools this includes Anthropic (the AI coach and import column mapping), OpenAI (AI drafts of messages, check-ins and programs), SendGrid (email), Expo (push notifications) and Stripe (billing). Prompts that contain client health information go only to Anthropic or OpenAI, not to OpenRouter. When we import a spreadsheet, the AI that maps columns sees column headers and a few sample values with email addresses and phone numbers masked. We will update that list before adding a new sub-processor, and you may object by ending your use of the trainer tools.</li>
          <li>AI drafts are proposals. You review them before they are sent, unless you switch on an automated message, in which case you are responsible for its content.</li>
          <li>We do not sell client data, use it for advertising, or use it to train AI models.</li>
          <li>If we learn of a security breach affecting your client data, we will tell you without undue delay (and in any case within 72 hours of confirming it), with what we know, so you can meet your own notification duties. See our incident procedure summary on request.</li>
        </List>
      </Section>

      <Section title="5. Retention and deletion">
        <List>
          <li>The raw spreadsheet you upload is kept only until you confirm or undo the import; after that we keep only the mapped client records.</li>
          <li>Prospects imported as "Not joined" who are never invited are deleted automatically after <strong>90 days</strong>, with their imported history.</li>
          <li>You can delete any client or prospect at any time from the roster; deletion removes their imported records and notes.</li>
          <li>If you delete your Axiom account, we delete the clients, prospects, imports, notes and drafts you created. Clients who have their own Axiom accounts keep their accounts; the link to you ends.</li>
          <li>Database backups containing deleted records are kept for up to 7 days (30 days for an encrypted off-site copy, where kept).</li>
        </List>
      </Section>

      <Section title="6. Helping with requests and audits">
        <p>
          If a client or prospect contacts us directly about data you uploaded, we will pass the request to you, and where they are not an Axiom user and ask
          for deletion, we may delete their records after telling you. On reasonable written request (no more than once a year, unless a regulator requires
          it), we will give you the information you need to show that we meet these processing terms. Where GDPR or UK GDPR applies, these terms are
          intended to meet Article 28, and transfers to the US rely on the Standard Contractual Clauses (Module 2 or 3, as applicable), which we will sign on request.
        </p>
      </Section>

      <Section title="7. Billing your clients">
        <List>
          <li>If you bill clients through Axiom, payments go through your own Stripe account (Stripe Connect). You are the seller: you set prices, handle refunds, disputes and taxes, and Stripe's terms apply to you.</li>
          <li>Axiom currently charges no platform fee on these payments; Stripe charges its own processing fees. We will give you at least 30 days' notice before introducing any fee.</li>
          <li>Your own Axiom subscription, if any, is separate and covered by the Terms of Service.</li>
        </List>
      </Section>

      <Section title="8. Your conduct">
        <Sub>You must not</Sub>
        <List>
          <li>give medical diagnosis or treatment through Axiom unless you are licensed to do so, or present AI drafts as medical advice;</li>
          <li>recommend unsafe practices, including extreme calorie restriction or performance-enhancing drugs;</li>
          <li>use client data for anything other than coaching those clients, or share it outside Axiom without their permission;</li>
          <li>import contact lists to market to people who are not your clients or prospects.</li>
        </List>
        <p className="mt-2">We may suspend the trainer tools if you break these terms or if we receive credible complaints from your clients.</p>
      </Section>

      <Section title="9. Liability">
        <p>
          You are responsible to your clients for your coaching and for the lawfulness of the data you upload, and you agree to cover our reasonable costs if a
          claim against us arises from your breach of Section 3 or 8. The limits on our liability in the Terms of Service apply to the trainer tools, except
          that nothing limits either party's liability for breach of confidentiality or data protection obligations to the extent the law does not allow it to be limited.
        </p>
      </Section>

      <Section title="10. Ending">
        <p>
          You can stop using the trainer tools at any time. When access ends, you can ask us for a copy of your client list within 30 days, after which we delete the data you
          uploaded as described in Section 5, unless the law requires us to keep it.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          {LEGAL.entity}, {LEGAL.postalAddress}. Privacy and data-processing questions: <Mail />. Support: <Mail to={LEGAL.supportEmail} />.
        </p>
      </Section>
    </LegalPage>
  );
}
