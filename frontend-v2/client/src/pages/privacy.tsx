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
          <p className="text-sm text-muted-foreground mt-1">Last updated: {new Date().toLocaleDateString("en-US")}</p>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Introduction</h2>
            <p>
              Axiom ("we," "our," or "us") operates the Axiom platform, including our website, mobile applications, and related services (collectively, the "Service"). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service. By accessing or using the Service, you agree to this Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Information We Collect</h2>
            <p>We collect information you provide directly and information collected automatically:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account information:</strong> Name, email address, password (hashed), date of birth, and profile photo (if you sign in with Google).</li>
              <li><strong>Fitness and health data:</strong> Height, weight, body composition, training history, working weights, exercise logs, goals, medical screening responses (e.g., PAR-Q), medications, injuries, and other health-related information you voluntarily provide.</li>
              <li><strong>AI Coach data:</strong> Onboarding interview responses, nutrition logs, wellness check-ins, chat messages, and program preferences.</li>
              <li><strong>Lift diagnostic data:</strong> Selected lifts, sets, reps, weights, diagnostic chat transcripts, and generated analysis plans.</li>
              <li><strong>Payment information:</strong> Processed by Stripe; we do not store full payment card details. We store Stripe customer ID and subscription status.</li>
              <li><strong>Usage data:</strong> Log data, IP address, device type, browser, and how you interact with the Service.</li>
              <li><strong>Cookies and similar technologies:</strong> We use cookies and local storage for authentication, preferences, and session management.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide, operate, and improve the Service, including AI-powered lift diagnostics and coaching.</li>
              <li>Process subscriptions and manage your account.</li>
              <li>Personalize recommendations, programs, and nutrition guidance.</li>
              <li>Communicate with you about the Service, updates, and support.</li>
              <li>Analyze usage patterns and improve our algorithms.</li>
              <li>Comply with legal obligations and enforce our Terms of Service.</li>
              <li>Prevent fraud, abuse, and security incidents.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Sharing and Disclosure</h2>
            <p>We do not sell your personal information. We may share information with:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Service providers:</strong> Stripe (payments), OpenAI (AI models), Google (authentication), and hosting providers. These parties are contractually bound to protect your data.</li>
              <li><strong>Public analyses:</strong> If you choose to share an analysis, the shared link may display limited, non-identifying information you have made public.</li>
              <li><strong>Legal requirements:</strong> When required by law, court order, or to protect our rights, safety, or property.</li>
              <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets, with notice and continued protection of your data.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active or as needed to provide the Service. You may request deletion of your account and associated data at any time. We may retain certain information as required by law or for legitimate business purposes (e.g., fraud prevention, legal compliance).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including encryption in transit and at rest, secure authentication, and access controls. No method of transmission over the internet is 100% secure; we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Access, correct, or delete your personal information.</li>
              <li>Export your data in a portable format.</li>
              <li>Opt out of marketing communications.</li>
              <li>Object to or restrict certain processing.</li>
              <li>Lodge a complaint with a supervisory authority.</li>
            </ul>
            <p className="mt-2">To exercise these rights, contact us at the email below.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Children</h2>
            <p>
              The Service is not intended for users under 18. We do not knowingly collect personal information from children. If you believe we have collected such information, please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. International Transfers</h2>
            <p>
              Your information may be transferred to and processed in countries other than your own. We take steps to ensure appropriate safeguards are in place for such transfers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Changes</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy and updating the "Last updated" date. Your continued use of the Service after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Contact</h2>
            <p>
              For questions about this Privacy Policy or our data practices, contact us at:{" "}
              <a href="mailto:privacy@axiomfitness.ai" className="text-primary hover:underline">privacy@axiomfitness.ai</a>
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
              <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
              <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
