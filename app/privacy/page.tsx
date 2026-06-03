// Public privacy policy for the SMS (A2P 10DLC) program + general business
// privacy. Reachable without auth (see middleware PUBLIC_PREFIXES) so carrier
// reviewers + customers can open it. Carriers specifically check for: a
// non-sharing statement for mobile numbers, message frequency, and a
// "message and data rates may apply" disclosure — all present below.

export const metadata = {
  title: "Privacy Policy · Tulsa Plumbing and Remodeling, LLC",
  description: "Privacy policy for Tulsa Plumbing and Remodeling, LLC, including our SMS/text messaging program.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-neutral-800">
      <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Tulsa Plumbing and Remodeling, LLC · Last updated June 3, 2026
      </p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
        <p>
          Tulsa Plumbing and Remodeling, LLC (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) respects your privacy. This policy explains how we collect, use, and
          protect the information you provide, including information related to our text messaging
          (SMS) program.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Information we collect</h2>
          <p className="mt-2">
            When you request or schedule service, contact us, or communicate with us, we may collect
            your name, mobile phone number, service address, email address, and details about the
            work you&rsquo;ve requested.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">How we use your information</h2>
          <p className="mt-2">
            We use your information to schedule and perform plumbing and remodeling services; to send
            service-related communications (including appointment confirmations and reminders,
            technician &ldquo;on-the-way&rdquo; and arrival notifications, estimates, and
            follow-ups); to respond to your questions; and to maintain our business records.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">SMS / text messaging</h2>
          <p className="mt-2">
            By providing your mobile number, you consent to receive service-related text messages
            from Tulsa Plumbing and Remodeling, LLC.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong>Message frequency varies.</strong></li>
            <li><strong>Message and data rates may apply.</strong></li>
            <li>
              Reply <strong>STOP</strong> at any time to opt out of text messages. Reply{" "}
              <strong>HELP</strong> for help, or contact us at (918) 800-4426.
            </li>
            <li>Carriers are not liable for delayed or undelivered messages.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">We do not sell or share your mobile number</h2>
          <p className="mt-2">
            <strong>
              We do not sell, rent, or share your mobile phone number, SMS opt-in, or consent with
              any third parties or affiliates for marketing or promotional purposes.
            </strong>{" "}
            Information may be shared only with service providers that help us operate our business
            (for example, our messaging platform) and only as needed to deliver our services, or as
            required by law. Mobile opt-in data and consent are never shared with third parties for
            their own marketing.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Data security</h2>
          <p className="mt-2">
            We take reasonable measures to protect your information from unauthorized access, use, or
            disclosure.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Your choices</h2>
          <p className="mt-2">
            You may opt out of text messages at any time by replying STOP. You may request access to
            or deletion of your information by contacting us using the details below.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Contact us</h2>
          <p className="mt-2">
            Tulsa Plumbing and Remodeling, LLC<br />
            Phone: (918) 800-4426<br />
            Email: ddunlop@tulsapar.com<br />
            Web: tulsapar.com
          </p>
        </section>

        <p className="text-sm text-neutral-500">
          This policy may be updated from time to time. See also our{" "}
          <a href="/sms-terms" className="font-medium text-blue-700 underline">SMS Terms &amp; Conditions</a>.
        </p>
      </div>
    </main>
  );
}
