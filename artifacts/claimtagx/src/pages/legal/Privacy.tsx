import SEO from '@/components/SEO';
import { useI18n } from '@/lib/i18n';
import { legalPageSeo } from '@/lib/seo/legalLocalization';

// Shell chrome is localized; legal body copy requires qualified human review before translation or publication as localized law.
export default function Privacy() {
  const { t, locale } = useI18n();
  return (
    <>
      <SEO
        {...legalPageSeo("/privacy", locale === "ar" ? "ar" : "en", {
          title: t("legal.privacy.seoTitle"),
          description: t("legal.privacy.seoDescription"),
        })}
      />
      <div className="pt-32 pb-20 max-w-[800px] mx-auto px-4 sm:px-6">
        <h1 className="text-4xl font-bold text-white mb-2">{t('legal.privacy.title')}</h1>
        <p className="text-ink text-sm mb-2">{t('legal.effectiveDate', { date: 'April 20, 2026' })}</p>
        <p className="text-ink text-sm mb-10 pb-10 border-b border-white/10">{t('legal.lastUpdated', { date: 'April 17, 2026' })}</p>

        <div className="prose prose-invert prose-slate max-w-none text-ink-300 space-y-4 leading-relaxed">
          <h2 className="text-2xl font-bold text-white mt-10 mb-4">1. Introduction</h2>
          <p>ClaimTagX ("we," "our," "the Platform") is a digital custody management platform that enables organizations to issue, manage, track, and verify cryptographically signed digital claim tickets across multiple industries, including valet parking, hospitality, dry cleaning, laundry, luggage handling, repair services, and asset custody environments.</p>
          <p>This Privacy Policy explains how we collect, process, store, and protect personal data when individuals ("Users") interact with ClaimTagX through:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Patron interfaces (ticket holders)</li>
            <li>Operator and handler applications</li>
            <li>Tenant administrative portals</li>
            <li>Integrated partner systems</li>
          </ul>
          <p>ClaimTagX operates as a multi-tenant platform where each organization ("Tenant") controls its own data environment with row-level security isolation at the database layer.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">2. Roles and Data Responsibility</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.1 Data Controller vs. Data Processor</h3>
          <p><strong className="text-white">Tenant (Client Organization)</strong> acts as the <strong className="text-white">Data Controller</strong> and determines:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>What data is collected from patrons and staff</li>
            <li>The purpose for which data is collected</li>
            <li>Data retention policies for their organization</li>
            <li>Verification methods enabled for their operations</li>
          </ul>
          <p><strong className="text-white">ClaimTagX (Platform Provider)</strong> acts as the <strong className="text-white">Data Processor</strong> and processes data strictly on behalf of the Tenant in accordance with their instructions and applicable data processing agreements.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.2 Platform-Level Processing</h3>
          <p>ClaimTagX acts as a Data Controller only for:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Platform account management (Tenant administrator accounts)</li>
            <li>Billing and subscription data</li>
            <li>Security monitoring, fraud detection, and system integrity</li>
            <li>Platform usage analytics (aggregated, non-personal)</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">3. Data We Collect</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.1 Patron (End-User) Data</h3>
          <p>Collected during ticket issuance and lifecycle management, as configured by the Tenant:</p>
          <p><strong className="text-white">Identification data</strong> (if enabled by Tenant): name, phone number, email address.</p>
          <p><strong className="text-white">Ticket data:</strong> ticket ID, asset type (vehicle, luggage, garment, device, or other item), and asset-specific data depending on Tenant configuration — for example, vehicle license plate, model, and color; luggage description and tags; garment type and special instructions.</p>
          <p><strong className="text-white">Custody data:</strong> custody storage reference (CSR), handler interactions, state transitions, and timestamps.</p>
          <p><strong className="text-white">Verification data:</strong> OTP/PIN verification logs, QR code scan records.</p>
          <p><strong className="text-white">Service data:</strong> requested services, transaction values, communication logs, and notification delivery/read status.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.2 Operator and Staff Data</h3>
          <p>Name and assigned role, employee identifier, authentication credentials (password or device binding), shift assignments, activity logs (actions taken on tickets), and performance metrics.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.3 Technical and Device Data</h3>
          <p>Device identifiers, IP addresses, location data (if enabled by Tenant), application usage logs, and crash/performance diagnostics.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">4. Custody Event Ledger</h2>
          <p>ClaimTagX maintains an immutable custody event history for every digital claim ticket. This ledger records:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>State transitions (e.g., INTAKE → STORED → READY → RELEASED)</li>
            <li>Actor identity (which handler, operator, or system process performed each action)</li>
            <li>Timestamp and location for each event</li>
            <li>Cryptographic signatures (Ed25519) verifying the integrity of each transition</li>
            <li>Action metadata relevant to dispute resolution</li>
          </ul>
          <p>This ledger is tamper-resistant by design. It is retained for operational integrity, dispute resolution, insurance documentation, and fraud prevention. Due to its role as a system of record for custody chain-of-evidence, certain ledger data may be retained beyond standard deletion requests (see Section 11).</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">5. How Data Is Used</h2>
          <p>Data is processed for the following purposes:</p>
          <p><strong className="text-white">Core operations:</strong> Ticket creation and lifecycle management, asset tracking and custody chain management, queue and assignment logic, handler dispatch and workload balancing.</p>
          <p><strong className="text-white">Verification and security:</strong> Release validation (OTP, QR code, or other Tenant-configured methods), fraud detection and anomaly identification, identity binding between patrons and their claim tickets, and cryptographic signature verification.</p>
          <p><strong className="text-white">Service delivery:</strong> Processing service requests attached to tickets, billing and invoicing through our payment processor.</p>
          <p><strong className="text-white">Analytics and reporting:</strong> Operational dashboards for Tenant administrators, handler performance metrics, capacity and utilization analysis. All analytics are scoped to the individual Tenant's data environment.</p>
          <p><strong className="text-white">Communication:</strong> Real-time notifications to patrons (e.g., "Your vehicle is ready," "Your order is ready for pickup") via SMS, email, or in-app messaging as configured by the Tenant.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">6. Legal Basis for Processing</h2>
          <p>Depending on the User's jurisdiction, we process personal data under one or more of the following legal bases:</p>
          <p><strong className="text-white">Contractual necessity:</strong> Processing required to deliver the custody management service as contracted between the Tenant and ClaimTagX, and between the Tenant and its patrons.</p>
          <p><strong className="text-white">Legitimate interest:</strong> Fraud prevention, operational security, system integrity monitoring, and service improvement — where these interests are not overridden by the individual's rights.</p>
          <p><strong className="text-white">Legal obligations:</strong> Where processing is required to comply with applicable laws, regulations, or court orders.</p>
          <p><strong className="text-white">Consent:</strong> For optional features such as location tracking, marketing communications, or enhanced analytics. Consent may be withdrawn at any time without affecting the lawfulness of prior processing.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">7. Data Sharing</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">7.1 Within the Tenant Organization</h3>
          <p>Data is accessible to authorized personnel within the Tenant's organization based on role-based access control (RBAC): operators, supervisors, and administrators see only the data their role permits.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">7.2 Third-Party Service Providers</h3>
          <p>We share data with third parties only when necessary to operate the Platform:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-white">Payment processing:</strong> Paddle (our Merchant of Record) processes subscription payments on behalf of ClaimTagX. Paddle's privacy policy governs payment data handling.</li>
            <li><strong className="text-white">Notification delivery:</strong> SMS and email service providers transmit patron notifications on behalf of Tenants.</li>
            <li><strong className="text-white">Infrastructure:</strong> Cloud hosting providers (Railway for backend services, Cloudflare for frontend delivery and CDN) process data as sub-processors under our data processing agreements.</li>
            <li><strong className="text-white">Error monitoring:</strong> Application monitoring services receive anonymized error and performance data.</li>
          </ul>
          <p>All third-party providers are contractually bound to process data only as instructed and to maintain appropriate security measures.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">7.3 No Data Selling</h3>
          <p>ClaimTagX does not sell, rent, or trade personal data to any third party for advertising, marketing, or any other purpose.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">7.4 Legal Disclosure</h3>
          <p>We may disclose data where required by law, regulation, legal process, or enforceable governmental request. Where permitted, we will notify the affected Tenant before disclosure.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">8. Cross-Border Data Transfers</h2>
          <p>Data may be processed in jurisdictions outside the User's country of residence depending on:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>The Tenant's deployment configuration</li>
            <li>The location of our infrastructure providers (currently US and EU regions)</li>
          </ul>
          <p>Where personal data is transferred across borders, we implement appropriate safeguards including:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Encryption in transit (TLS 1.2+) and at rest (AES-256)</li>
            <li>Standard Contractual Clauses (SCCs) where required under GDPR</li>
            <li>Data processing agreements with all sub-processors</li>
            <li>Regional hosting options available for Enterprise Tenants with specific data residency requirements</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">9. Data Retention</h2>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">9.1 Core Principle: We Do Not Retain User Data</h3>
          <p>ClaimTagX does not retain patron (end-user) personal data at the platform level. All patron data — including names, phone numbers, email addresses, and any other personally identifiable information — is controlled entirely by the Tenant. ClaimTagX processes this data on behalf of the Tenant during active operations and does not independently store, archive, or use patron data for any purpose beyond delivering the service as instructed by the Tenant.</p>
          <p>When patron data is no longer needed for the active ticket lifecycle, it is the Tenant's responsibility to manage its retention or deletion in accordance with their own privacy obligations.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">9.2 Tenant-Controlled Data</h3>
          <p>Tenants configure their own data handling within the Platform:</p>
          <p><strong className="text-white">Active tickets:</strong> Retained for the duration of the ticket lifecycle only.</p>
          <p><strong className="text-white">Closed tickets:</strong> Tenant-configurable. Tenants may choose to delete ticket data immediately upon closure or retain it for their own audit and operational purposes.</p>
          <p><strong className="text-white">Custody event ledger:</strong> The immutable event log records custody state transitions, actor identities, timestamps, and cryptographic signatures. This ledger is retained for operational integrity, dispute resolution, and fraud prevention. Ledger entries are pseudonymized where possible — they record <em>what happened</em> and <em>when</em>, but Tenants control whether personally identifiable data is linked to those events.</p>
          <p><strong className="text-white">Verification data:</strong> Ephemeral. OTP codes, session tokens, and QR scan logs are purged after use or within a short security window.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">9.3 Platform-Level Data</h3>
          <p>ClaimTagX retains only the minimum data required to operate the Platform itself:</p>
          <p><strong className="text-white">Tenant account data:</strong> Organization name, administrator email, and subscription status — retained for the duration of the subscription.</p>
          <p><strong className="text-white">Billing data:</strong> Transaction records retained as required by applicable tax and accounting regulations. This data is held by Paddle (our Merchant of Record), not by ClaimTagX directly.</p>
          <p><strong className="text-white">Aggregated analytics:</strong> Non-personally-identifiable, aggregated usage metrics for Platform improvement. These cannot be traced back to individual patrons.</p>
          <h3 className="text-lg font-semibold text-white mt-6 mb-3">9.4 Post-Termination</h3>
          <p>When a Tenant terminates their subscription, all Tenant data (including any patron data still present) is retained for 30 days to allow for data export, after which it is permanently and irreversibly deleted. ClaimTagX does not retain copies of Tenant data after this period unless specifically required by law.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">10. Security Measures</h2>
          <p>ClaimTagX implements the following technical and organizational measures to protect personal data:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>End-to-end encryption in transit (TLS 1.2+)</li>
            <li>Encryption at rest for patron personally identifiable information (AES-256)</li>
            <li>Ed25519 cryptographic signing of all custody events and digital tickets</li>
            <li>JSON Web Token (JWT) authentication with domain-separated token types</li>
            <li>Row-level security (RLS) enforcing multi-tenant data isolation at the database layer</li>
            <li>Role-based access control (RBAC) across all user types</li>
            <li>Comprehensive audit logging for all data access and modification events</li>
            <li>Rate limiting on public-facing endpoints</li>
            <li>Automated security monitoring and anomaly detection</li>
          </ul>
          <p>We regularly review and update our security practices in response to evolving threats and industry standards.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">11. User Rights</h2>
          <p>Depending on your jurisdiction (including under GDPR, UK GDPR, CCPA/CPRA, and other applicable privacy laws), you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-white">Access</strong> the personal data we hold about you</li>
            <li><strong className="text-white">Correct</strong> inaccurate or incomplete personal data</li>
            <li><strong className="text-white">Delete</strong> your personal data (right to erasure)</li>
            <li><strong className="text-white">Restrict</strong> the processing of your personal data</li>
            <li><strong className="text-white">Object</strong> to processing based on legitimate interests</li>
            <li><strong className="text-white">Data portability</strong> — receive your data in a structured, machine-readable format</li>
            <li><strong className="text-white">Withdraw consent</strong> where processing is based on consent</li>
          </ul>
          <p><strong className="text-white">Important:</strong> Because ClaimTagX does not independently retain patron personal data (see Section 9.1), most data rights requests should be directed to the Tenant that collected your data. For custody event ledger entries, certain pseudonymized records may not be eligible for deletion where retention is necessary for: establishing, exercising, or defending legal claims; compliance with legal obligations; fraud prevention and detection; or maintaining the integrity of the custody chain-of-evidence. In such cases, we will inform you of the specific legal basis for continued retention.</p>
          <p><strong className="text-white">For patron data requests:</strong> Contact the Tenant (Data Controller) that issued your claim ticket. The Tenant controls your data and will coordinate with ClaimTagX as needed.</p>
          <p><strong className="text-white">For platform account requests:</strong> Contact ClaimTagX directly at the address below.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">12. Cookies and Tracking</h2>
          <p>ClaimTagX uses the following technologies:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-white">Strictly necessary cookies:</strong> Session management, authentication tokens, and security cookies required for the Platform to function.</li>
            <li><strong className="text-white">Analytics:</strong> Privacy-compliant analytics to understand Platform usage patterns. We use aggregated, non-personally-identifiable metrics where possible.</li>
          </ul>
          <p>We do not use invasive tracking technologies, behavioral advertising cookies, or cross-site tracking without explicit consent. For details, see our <a href="/cookies" className="text-lime hover:underline">Cookie Policy</a>.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">13. Children's Data</h2>
          <p>ClaimTagX is a business-to-business platform not intended for direct use by individuals under the age of 16 (or the applicable age of digital consent in your jurisdiction). We do not knowingly collect personal data from children. If we become aware that we have inadvertently collected data from a child, we will take steps to delete it promptly.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">14. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make material changes:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Tenant administrators will be notified via email and/or in-platform notification</li>
            <li>The "Last Updated" date at the top of this policy will be revised</li>
            <li>Where required by law, we will obtain consent before applying material changes</li>
          </ul>
          <p>We encourage Users to review this policy periodically.</p>

          <h2 className="text-2xl font-bold text-white mt-10 mb-4">15. Contact</h2>
          <p>For privacy-related inquiries or to exercise your data rights:</p>
          <p><strong className="text-white">Tenant-level data requests</strong> (patron data, operator data): Contact the organization that issued your claim ticket. They are the Data Controller for your data.</p>
          <p><strong className="text-white">Platform-level requests</strong> (account data, billing data, security inquiries):</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-white">Email:</strong> legal@claimtagx.com</li>
            <li><strong className="text-white">Website:</strong> https://claimtagx.com</li>
            <li><strong className="text-white">Mailing address:</strong> [To be updated upon incorporation]</li>
          </ul>
          <p>For urgent security concerns or to report a data breach, contact: security@claimtagx.com</p>

          <p className="text-ink text-sm italic mt-10 pt-10 border-t border-white/10">ClaimTagX is operated by Ali Achkar (sole proprietor). This notice will be updated upon formal incorporation.</p>
          <p className="text-ink text-sm italic">© 2026 ClaimTagX. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
