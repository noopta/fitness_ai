/*
 * ============================================================================
 *  <!-- Draft for counsel review --> 16 October 2026
 *  Accessibility statement (audit legal-report L1; EU Accessibility Act for
 *  consumer apps since June 2025 — micro-enterprise exemption may apply,
 *  counsel to confirm). Stated as a commitment plus known gaps: do NOT claim
 *  WCAG conformance until an audit has been done. Per the audit, roughly 40%
 *  of mobile screens/components carry accessibility labels/roles today.
 * ============================================================================
 */
import { LegalPage, LEGAL, Mail, Section, List } from "@/components/legal/LegalPage";

export default function Accessibility() {
  return (
    <LegalPage
      title="Accessibility Statement"
      intro={
        <p>
          We want everyone to be able to train with Axiom, including people who use screen readers, larger text, voice control, keyboard navigation or other
          assistive technology. This statement covers the website at {LEGAL.site} and the Axiom iOS and Android apps.
        </p>
      }
    >
      <Section title="1. Our goal">
        <p>
          We are working towards the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA for the website, and the equivalent platform guidelines for
          iOS (VoiceOver, Dynamic Type) and Android (TalkBack, font scaling) in the apps. We have not yet had an independent audit, so we do not claim full conformance.
        </p>
      </Section>

      <Section title="2. What we already do">
        <List>
          <li>Support system dark and light modes and the device's text-size settings in most screens.</li>
          <li>Label buttons and controls for screen readers on many screens, and keep text and controls at readable contrast.</li>
          <li>Offer more than one way to log: typing, voice notes, photos and barcode scanning, and a text chat for everything the coach can do.</li>
          <li>Describe form feedback in text, not only with images or video.</li>
        </List>
      </Section>

      <Section title="3. Known gaps">
        <List>
          <li>Some screens in the mobile apps, especially newer ones and charts, are missing screen-reader labels or roles.</li>
          <li>Charts and progress graphics do not always have a text alternative.</li>
          <li>Some animations do not yet respect the "reduce motion" setting.</li>
          <li>Form-check recording relies on the camera and on-screen guidance, which may be hard to follow without sight.</li>
        </List>
        <p className="mt-2">We are fixing these as part of our regular releases and will update this page as we go.</p>
      </Section>

      <Section title="4. Tell us about a problem">
        <p>
          If something in Axiom is hard or impossible for you to use, email <Mail to={LEGAL.supportEmail} /> with "Accessibility" in the subject. Tell us the
          screen, your device and any assistive technology you use. We aim to reply within 5 business days and, where we can, to give you another way to get
          what you need in the meantime. You can also ask for any of our policies in another format.
        </p>
      </Section>

      <Section title="5. Contact">
        <p>{LEGAL.entity}, {LEGAL.postalAddress}. Email <Mail to={LEGAL.supportEmail} />.</p>
      </Section>
    </LegalPage>
  );
}
