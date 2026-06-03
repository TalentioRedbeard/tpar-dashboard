// Public SMS Terms & Conditions for the A2P 10DLC messaging program. Reachable
// without auth (see middleware PUBLIC_PREFIXES). Includes the carrier-required
// elements: program description, opt-in, frequency, "msg & data rates may
// apply", STOP/HELP, and a no-sharing statement.

export const metadata = {
  title: "SMS Terms & Conditions · Tulsa Plumbing and Remodeling, LLC",
  description: "Text messaging terms and conditions for Tulsa Plumbing and Remodeling, LLC.",
};

export default function SmsTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-neutral-800">
      <h1 className="text-3xl font-bold tracking-tight text-neutral-900">SMS Terms &amp; Conditions</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Tulsa Plumbing and Remodeling, LLC · Last updated June 3, 2026
      </p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Program description</h2>
          <p className="mt-2">
            Tulsa Plumbing and Remodeling, LLC operates a text messaging program to communicate with
            our customers about their plumbing and remodeling service &mdash; including appointment
            confirmations and reminders, technician &ldquo;on-the-way&rdquo; and arrival
            notifications, estimates, and service follow-ups &mdash; and to answer your questions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Consent / opt-in</h2>
          <p className="mt-2">
            You opt in to receive text messages by providing your mobile number when you request or
            schedule service &mdash; verbally by phone or in person with a technician &mdash; or by
            texting our business line directly. Consent to receive texts is not a condition of any
            purchase.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Message frequency</h2>
          <p className="mt-2">Message frequency varies based on your interactions with us.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Cost</h2>
          <p className="mt-2">
            <strong>Message and data rates may apply.</strong> Tulsa Plumbing and Remodeling, LLC
            does not charge for these messages; your mobile carrier&rsquo;s standard message and data
            rates apply.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Opt-out</h2>
          <p className="mt-2">
            Reply <strong>STOP</strong> at any time to cancel. You will receive one final message
            confirming you have been unsubscribed, and no further messages will be sent unless you
            opt in again.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Help</h2>
          <p className="mt-2">
            Reply <strong>HELP</strong> for assistance, or contact us at (918) 800-4426 or
            ddunlop@tulsapar.com.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Privacy</h2>
          <p className="mt-2">
            We do not sell, rent, or share your mobile number or opt-in consent with third parties or
            affiliates for marketing. See our{" "}
            <a href="/privacy" className="font-medium text-blue-700 underline">Privacy Policy</a>.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Carriers</h2>
          <p className="mt-2">
            Carriers are not liable for delayed or undelivered messages. Supported carriers may
            change without notice.
          </p>
        </section>
      </div>
    </main>
  );
}
