import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { BrandLogo } from "@/components/BrandLogo";

export default function Terms() {
  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-12 sm:py-16">
        <div className="max-w-3xl mx-auto space-y-6 text-sm text-muted-foreground">
          <h1 className="text-2xl font-bold text-foreground mb-1">Terms of Service</h1>
          <p className="text-sm text-muted-foreground mt-1">Last updated: {new Date().toLocaleDateString("en-US")}</p>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Agreement to Terms</h2>
            <p>
              By accessing or using Axiom ("Service"), operated by Axiom ("we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Description of Service</h2>
            <p>
              Axiom provides AI-powered lift diagnostics, fitness coaching, nutrition guidance, and training program generation. The Service uses artificial intelligence trained on fitness and exercise science to generate personalized recommendations. All outputs are for informational and educational purposes only.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Not Medical or Professional Advice</h2>
            <p>
              <strong>THE SERVICE DOES NOT PROVIDE MEDICAL, NUTRITIONAL, OR PROFESSIONAL FITNESS ADVICE.</strong> All content, including AI-generated diagnostics, programs, and recommendations, is for general informational and coaching purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of a physician, registered dietitian, or qualified fitness professional before starting any exercise program, diet, or making health-related decisions. Never disregard professional medical advice or delay seeking it because of something you read or received through the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Assumption of Risk; Release of Liability</h2>
            <p>
              <strong>PHYSICAL EXERCISE INVOLVES INHERENT RISKS OF INJURY, INCLUDING SERIOUS INJURY OR DEATH.</strong> By using the Service, you acknowledge and assume all risks associated with physical activity. You represent that you are in good physical condition and have consulted a physician regarding your ability to participate in exercise, or you voluntarily assume all risks of doing so without such consultation.
            </p>
            <p className="mt-2">
              To the maximum extent permitted by law, you release, indemnify, and hold harmless Axiom, its officers, directors, employees, agents, and affiliates from any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to your use of the Service, your reliance on any content or recommendations, any injury or harm you sustain, or any actions taken by third parties based on content you share.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p className="mt-2">
              IN NO EVENT SHALL AXIOM, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
            </p>
            <p className="mt-2">
              OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM OR RELATED TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS ($100).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. AI-Generated Content</h2>
            <p>
              The Service uses artificial intelligence to generate diagnostics, programs, and recommendations. AI outputs may contain errors, inaccuracies, or be unsuitable for your specific situation. You are solely responsible for evaluating and applying any AI-generated content. We do not guarantee the accuracy, completeness, or suitability of AI-generated content for any purpose.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Account and Eligibility</h2>
            <p>
              You must be at least 18 years old and capable of forming a binding contract to use the Service. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You must provide accurate information and notify us immediately of any unauthorized use.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Subscriptions and Payments</h2>
            <p>
              Pro and other paid tiers are billed monthly via Stripe. By subscribing, you authorize recurring charges until you cancel. Subscription fees are non-refundable except as required by law or as stated in our refund policy. You may cancel at any time through the Stripe customer portal; access continues until the end of the billing period. We may change pricing with reasonable notice; continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Use the Service for any illegal purpose or in violation of any laws.</li>
              <li>Attempt to gain unauthorized access to the Service, other accounts, or our systems.</li>
              <li>Interfere with or disrupt the Service or servers.</li>
              <li>Transmit malware, spam, or harmful code.</li>
              <li>Scrape, harvest, or automate access to the Service without permission.</li>
              <li>Impersonate others or misrepresent your affiliation.</li>
              <li>Use the Service to harm minors or others.</li>
            </ul>
            <p className="mt-2">We may suspend or terminate your account for violation of these terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Intellectual Property</h2>
            <p>
              The Service, including its design, content, and software, is owned by Axiom and protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works without our written permission. You retain ownership of content you submit; you grant us a license to use, store, and process it to provide the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Third-Party Services</h2>
            <p>
              The Service integrates with third-party services (e.g., Stripe, Google, OpenAI). Your use of those services is subject to their respective terms and privacy policies. We are not responsible for third-party services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Dispute Resolution; Arbitration</h2>
            <p>
              Any dispute arising from these Terms or the Service shall be resolved by binding arbitration administered by the American Arbitration Association under its Consumer Arbitration Rules, rather than in court. You waive any right to a jury trial and to participate in a class action or representative proceeding. The arbitration shall be conducted in the English language. The arbitrator's decision shall be final and binding. This clause does not prevent either party from seeking injunctive relief in court for intellectual property or unauthorized access claims.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">13. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict of law principles. The United Nations Convention on Contracts for the International Sale of Goods does not apply.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">14. Severability</h2>
            <p>
              If any provision of these Terms is held invalid or unenforceable, the remaining provisions shall remain in full force and effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">15. Changes</h2>
            <p>
              We may modify these Terms at any time. We will notify you of material changes by posting the updated Terms and updating the "Last updated" date. Your continued use of the Service after changes constitutes acceptance. If you do not agree, you must stop using the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">16. Contact</h2>
            <p>
              For questions about these Terms, contact us at:{" "}
              <a href="mailto:legal@axiomfitness.ai" className="text-primary hover:underline">legal@axiomfitness.ai</a>
            </p>
          </section>
        </div>

        <footer className="border-t py-10 mt-12">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BrandLogo height={24} className="h-6 w-auto" />
              <span>Axiom - AI-Powered Lift Diagnostics</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
              <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
