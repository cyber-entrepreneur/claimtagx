import SEO from '@/components/SEO';
import { useI18n } from '@/lib/i18n';
import { legalPageSeo } from '@/lib/seo/legalLocalization';

// Shell chrome is localized; legal body copy requires qualified human review before translation or publication as localized law.
export default function Terms() {
  const { t, locale } = useI18n();
  return (
    <>
      <SEO
        {...legalPageSeo("/terms", locale === "ar" ? "ar" : "en", {
          title: t("legal.terms.seoTitle"),
          description: t("legal.terms.seoDescription"),
        })}
      />
      <div className="pt-32 pb-20 max-w-[800px] mx-auto px-4 sm:px-6">
        <h1 className="text-4xl font-bold text-white mb-2">{t('legal.terms.title')}</h1>
        <p className="text-ink text-sm mb-2">{t('legal.effectiveDate', { date: 'April 20, 2026' })}</p>
        <p className="text-ink text-sm mb-10 pb-10 border-b border-white/10">{t('legal.lastUpdated', { date: 'April 17, 2026' })}</p>

        <div className="prose prose-invert prose-slate max-w-none text-ink-300 space-y-4 leading-relaxed">
          <h2 className="text-2xl font-bold text-white mt-10 mb-4">1. Acceptance of Terms</h2>
          <p>These Terms of Service ("Terms") govern access to and use of ClaimTagX ("Platform"), a digital custody management platform operated by Ali Achkar ("ClaimTagX," "we," "our"). This notice will be updated upon formal incorporation.</p>
          <p>By creating an account, accessing, or using the Platform, you agree to be bound by these Terms. If you do not agree, do not use the Platform.</p>
          <p>These Terms apply to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Organizations subscribing to the Platform ("Tenants")</li>
            <li>Authorized personnel operating within a Tenant's account (operators, handlers, supervisors, administrators)</li>
            <li>End users interacting with digital claim tickets (patrons, ticket holders)</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">2. Platform Description and Scope</h2>
          <p>ClaimTagX provides digital infrastructure for recording, managing, and verifying custody transactions and service workflows. The Platform enables Tenants to issue cryptographically signed digital claim tickets, track custody events, manage handlers and operations, and maintain auditable records.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.1 What ClaimTagX Is Not</h3>
          <p>ClaimTagX is strictly a technology provider. The Platform does not:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Take physical possession of any assets (vehicles, luggage, garments, devices, or other items)</li>
            <li>Provide valet, storage, cleaning, repair, or any other physical service</li>
            <li>Guarantee the performance, quality, or outcome of any service provided by a Tenant</li>
            <li>Act as an insurer, guarantor, or bailee of any kind</li>
          </ul>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.2 Industry-Neutral Application</h3>
          <p>The Platform may be used across multiple industries including valet parking, hospitality, dry cleaning and laundry, luggage handling, coat check, repair services, and other custody or service environments. Regardless of industry, all physical custody obligations remain solely with the Tenant.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">3. Account Registration and Access</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.1 Tenant Accounts</h3>
          <p>To use the Platform, an authorized representative of the Tenant organization must create an account, provide accurate and complete registration information, and select a subscription plan. The person creating the account represents and warrants that they have authority to bind the organization to these Terms.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.2 User Access</h3>
          <p>Tenants are responsible for managing access within their organization, including creating and deactivating user accounts, assigning appropriate roles and permissions, ensuring staff compliance with these Terms, and securing all credentials associated with their account.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.3 Account Security</h3>
          <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. Notify us immediately at security@claimtagx.com if you suspect unauthorized access.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">4. Roles and Responsibilities</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.1 Tenant Responsibilities</h3>
          <p>The Tenant is fully responsible for:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Physical custody of all assets checked into their care</li>
            <li>Staff hiring, training, behavior, and supervision</li>
            <li>Configuring verification policies and operational procedures within the Platform</li>
            <li>Compliance with all applicable laws and regulations in their jurisdiction</li>
            <li>Accuracy of data entered into the Platform by their personnel</li>
            <li>Relationships with their patrons, including dispute resolution</li>
          </ul>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.2 Staff User Responsibilities</h3>
          <p>Staff users (operators, handlers, supervisors) act on behalf of their Tenant and must follow operational procedures established by their organization, use verification methods correctly and consistently, maintain the integrity of custody records, and not share credentials or access with unauthorized individuals.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.3 Patron Responsibilities</h3>
          <p>Patrons (end users who receive digital claim tickets) must safeguard their ticket credentials (QR codes, PINs, or other verification tokens), provide accurate information when required for ticket issuance, and follow retrieval and verification procedures established by the Tenant.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">5. Digital Tickets and Custody Records</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">5.1 Nature of a Digital Ticket</h3>
          <p>A ClaimTagX digital ticket is a cryptographically signed digital reference to a custody transaction. It records that an item was received into a Tenant's custody at a specific time and place.</p>
          <p>A digital ticket is not proof of ownership of the underlying asset, a guarantee that the asset will be returned in any particular condition, a substitute for legal title or insurance, or a contract between the patron and ClaimTagX.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">5.2 Custody Event Ledger</h3>
          <p>The Platform maintains an immutable, tamper-resistant log of custody events for each ticket, including state transitions (intake, stored, ready, released, disputed), the identity of the actor performing each action, cryptographic signatures (Ed25519) verifying the integrity of each event, and timestamps and metadata.</p>
          <p>This ledger is system-generated, designed for operational integrity and audit purposes, and may be used as evidence in dispute resolution or legal proceedings. The Tenant, as Data Controller, determines access policies for ledger data within their organization.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">5.3 Cryptographic Signing</h3>
          <p>Each ticket and custody event is signed using Ed25519 digital signatures. This means tickets cannot be forged, duplicated, or tampered with after issuance. Signature verification occurs at the time of release to confirm the authenticity of the claim. The signing infrastructure is provided "as is" — ClaimTagX does not guarantee that cryptographic signing will prevent all forms of fraud or unauthorized access.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">6. Custody and Liability</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">6.1 Separation of Responsibility</h3>
          <p>The Tenant is responsible for physical custody and service execution. ClaimTagX is responsible for the digital record infrastructure only. This separation is fundamental to the Platform's design and cannot be overridden by any Tenant configuration, marketing material, or verbal representation.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">6.2 No Liability for Physical Outcomes</h3>
          <p>ClaimTagX is not liable for lost, stolen, or damaged assets; service delays, failures, or quality issues; staff misconduct, negligence, or errors; unauthorized release of assets (whether due to social engineering, stolen credentials, or operational failures at the Tenant level); or any harm arising from the physical custody or handling of assets.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">6.3 Dispute Resolution</h3>
          <p>All disputes between a patron and a Tenant, or between a patron and Tenant staff, must be resolved directly with the Tenant. ClaimTagX may provide custody event logs and audit trails to assist in dispute resolution upon request from the Tenant, but ClaimTagX is not a party to such disputes and bears no responsibility for their outcome.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">7. Verification and Access Control</h2>
          <p>The Platform supports multiple verification methods as configured by the Tenant, including QR code scanning (static or dynamic), one-time passwords (OTP) via SMS or email, and other methods as may be added.</p>
          <p>Verification policies are configured and controlled by the Tenant. No verification method guarantees absolute fraud prevention. Users are responsible for securing their verification credentials. ClaimTagX is not liable for unauthorized access resulting from compromised credentials.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">8. Subscription Plans and Payment</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">8.1 Plans and Pricing</h3>
          <p>ClaimTagX offers subscription plans as published at <a href="/price" className="text-lime hover:underline">claimtagx.com/price</a>. Current plans include Starter, Pro, and Enterprise tiers. Pricing is in US Dollars (USD) and may be updated with 30 days' notice to existing subscribers.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">8.2 Payment Processing</h3>
          <p>Payments are processed by Paddle.com Market Limited ("Paddle"), our Merchant of Record. Paddle handles billing, invoicing, tax calculation, and payment collection on behalf of ClaimTagX. By subscribing, you agree to Paddle's terms of service and buyer terms in addition to these Terms. ClaimTagX does not directly process or store payment card information.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">8.3 Free Trial</h3>
          <p>New Tenants may be eligible for a 14-day free trial. No credit card is required to start a trial. At the end of the trial period, the Tenant must select a paid plan to continue using the Platform. Data created during the trial will be retained for 30 days after trial expiration, then permanently deleted.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">8.4 Cancellation and Refunds</h3>
          <p>Tenants may cancel their subscription at any time through the Paddle billing portal. Cancellation takes effect at the end of the current billing period. No partial refunds are issued for unused portions of a billing period. Upon cancellation, Tenant data is retained for 30 days (grace period), then permanently deleted unless a longer retention period is required by law.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">9. Acceptable Use</h2>
          <p>You may not use the Platform to violate any applicable law, regulation, or third-party rights; process or store data in violation of applicable data protection laws; attempt to gain unauthorized access to other Tenants' data or Platform infrastructure; reverse-engineer, decompile, or disassemble any part of the Platform; interfere with or disrupt the Platform's operation or other users' access; use communication features for harassment, abuse, spam, or unlawful activity; or resell, sublicense, or redistribute access to the Platform without authorization.</p>
          <p>Violations may result in immediate suspension or termination of access. See our <a href="/aup" className="text-lime hover:underline">Acceptable Use Policy</a> for full details.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">10. Intellectual Property</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">10.1 ClaimTagX Property</h3>
          <p>All rights in the Platform remain with ClaimTagX, including software, architecture, algorithms, user interface design, documentation, and trademarks. These Terms do not grant you any ownership interest in the Platform. Your subscription provides a limited, non-exclusive, non-transferable, revocable license to use the Platform in accordance with these Terms.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">10.2 Tenant Property</h3>
          <p>Tenants retain full ownership of their operational data, configurations, branding assets uploaded to the Platform, and any content they create within the Platform.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">11. Data and Privacy</h2>
          <p>Use of the Platform is governed by our <a href="/privacy" className="text-lime hover:underline">Privacy Policy</a>, which is incorporated into these Terms by reference. Key principles: Tenants act as Data Controllers for their operational and patron data; ClaimTagX acts as a Data Processor and processes data on behalf of Tenants; multi-tenant data isolation is enforced at the database layer via row-level security. Enterprise Tenants may request a Data Processing Addendum (DPA) by contacting legal@claimtagx.com.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">12. Service Availability</h2>
          <p>The Platform is provided on an "as available" basis. While we strive for high availability, ClaimTagX does not guarantee continuous, uninterrupted, or error-free operation. We may perform scheduled maintenance with reasonable advance notice where possible. The Platform includes offline-capable features in the Handler mobile app; however, full functionality requires internet connectivity for data synchronization.</p>
          <p>Enterprise Tenants may negotiate separate service level agreements (SLAs) with defined uptime commitments, support response times, and remedies.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">13. Limitation of Liability</h2>
          <p>To the maximum extent permitted by applicable law:</p>
          <p>ClaimTagX shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of business, revenue, profits, data, or goodwill, arising from or related to your use of the Platform.</p>
          <p>ClaimTagX's total aggregate liability for all claims arising from or related to these Terms or the Platform shall not exceed the total fees paid by the Tenant to ClaimTagX during the twelve (12) months immediately preceding the event giving rise to the claim.</p>
          <p>Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, or any other liability that cannot be excluded by applicable law.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">14. Indemnification</h2>
          <p>Tenants agree to indemnify, defend, and hold harmless ClaimTagX and its officers, directors, employees, and agents from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising from or related to: the Tenant's operations and use of the Platform; staff misconduct or negligence; violations of applicable law or third-party rights; disputes with patrons or other third parties; or breach of these Terms.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">15. Suspension and Termination</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">15.1 By ClaimTagX</h3>
          <p>We may suspend or terminate access to the Platform immediately if these Terms or the Acceptable Use Policy are violated, fraud or misuse is detected, required by law or regulatory order, or fees remain unpaid for more than 30 days past due.</p>
          <p>We will provide notice where reasonably practicable before suspension, except in cases of fraud, security threats, or legal requirements.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">15.2 By the Tenant</h3>
          <p>Tenants may terminate their subscription at any time by canceling through the Paddle billing portal. Termination takes effect at the end of the current billing period.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">15.3 Effect of Termination</h3>
          <p>Upon termination, the Tenant's access to the Platform will be deactivated. Tenant data will be retained for 30 days, during which the Tenant may request data export. After 30 days, data is permanently deleted, except where longer retention is required by law or for the integrity of the custody event ledger as described in the Privacy Policy.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">16. Modifications to These Terms</h2>
          <p>ClaimTagX may update these Terms from time to time. When we make material changes, we will notify Tenant administrators via email and/or in-platform notification at least 30 days before the changes take effect, and update the "Last Updated" date at the top of this page.</p>
          <p>Continued use of the Platform after the effective date of updated Terms constitutes acceptance. If you do not agree to the updated Terms, you must stop using the Platform and cancel your subscription.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">17. Governing Law and Dispute Resolution</h2>
          <p>These Terms shall be governed by and construed in accordance with the laws of England and Wales, without regard to conflict of law principles.</p>
          <p>Any dispute arising from or related to these Terms shall first be subject to good-faith negotiation between the parties. If negotiation fails, disputes shall be submitted to the exclusive jurisdiction of the courts of England and Wales.</p>
          <p>Enterprise Tenants may negotiate alternative governing law and dispute resolution provisions in a separate Master Service Agreement (MSA).</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">18. General Provisions</h2>
          <p><strong className="text-white">Entire Agreement:</strong> These Terms, together with the Privacy Policy, Acceptable Use Policy, and any applicable DPA or MSA, constitute the entire agreement between you and ClaimTagX regarding the Platform.</p>
          <p><strong className="text-white">Severability:</strong> If any provision of these Terms is found to be unenforceable, the remaining provisions shall continue in full force and effect.</p>
          <p><strong className="text-white">Waiver:</strong> Failure to enforce any provision of these Terms shall not constitute a waiver of that provision or any other provision.</p>
          <p><strong className="text-white">Assignment:</strong> You may not assign your rights or obligations under these Terms without our prior written consent. ClaimTagX may assign these Terms in connection with a merger, acquisition, or sale of all or substantially all of its assets.</p>
          <p><strong className="text-white">Force Majeure:</strong> ClaimTagX shall not be liable for any failure or delay in performance due to circumstances beyond its reasonable control, including natural disasters, acts of war or terrorism, epidemics, government actions, power failures, internet disruptions, or third-party service outages.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">19. Contact</h2>
          <p>For questions about these Terms:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-white">Email:</strong> legal@claimtagx.com</li>
            <li><strong className="text-white">Website:</strong> https://claimtagx.com</li>
            <li><strong className="text-white">Mailing address:</strong> [To be updated upon incorporation]</li>
          </ul>

          <p className="text-ink text-sm italic mt-10 pt-10 border-t border-white/10">ClaimTagX is operated by Ali Achkar (sole proprietor). This notice will be updated upon formal incorporation.</p>
          <p className="text-ink text-sm italic">© 2026 ClaimTagX. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
