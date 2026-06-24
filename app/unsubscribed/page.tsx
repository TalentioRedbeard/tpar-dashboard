// Public, no-login unsubscribe confirmation. A Supabase edge function processes
// the marketing-email unsubscribe token, then 302-redirects the browser here:
//   ?ok=1  -> success state ("You've been unsubscribed")
//   ?ok=0  -> failure state ("This link isn't valid")  (also missing/anything else)
//
// Server component — only reads searchParams, no client JS. Brand styling matches
// the edge-function confirmation page + the hosted estimate view (globals.css
// tokens: cream #f7f2e4 background, blue #1e40af brand). Inline styles keep it
// fully self-contained so it pulls in no authed components.
//
// In Next 16 searchParams is a Promise and must be awaited.

export const metadata = {
  title: "Unsubscribe · Tulsa Plumbing & Remodeling",
  robots: { index: false, follow: false },
};

const CREAM = "#f7f2e4";
const BRAND = "#1e40af";
const CARD_BORDER = "#e5e5e5";
const PHONE_TEL = "tel:+19188004426";
const PHONE_DISPLAY = "(918) 800-4426";

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const okRaw = params.ok;
  const ok = (Array.isArray(okRaw) ? okRaw[0] : okRaw) === "1";

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: CREAM,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor: "#ffffff",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: "16px",
          padding: "40px 32px",
          textAlign: "center",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: BRAND,
          }}
        >
          Tulsa Plumbing &amp; Remodeling
        </div>

        {ok ? <SuccessBody /> : <FailureBody />}

        <div
          style={{
            marginTop: "32px",
            paddingTop: "20px",
            borderTop: `1px solid ${CARD_BORDER}`,
            fontSize: "12px",
            color: "#9ca3af",
          }}
        >
          Tulsa Plumbing &amp; Remodeling · tulsapar.com
        </div>
      </div>
    </main>
  );
}

function SuccessBody() {
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          margin: "20px auto 0",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          backgroundColor: "#ecfdf5",
          color: "#059669",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "30px",
          lineHeight: 1,
        }}
      >
        ✓
      </div>

      <h1
        style={{
          margin: "20px 0 0",
          fontSize: "24px",
          fontWeight: 700,
          color: "#171717",
        }}
      >
        You&rsquo;ve been unsubscribed
      </h1>

      <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.6, color: "#4b5563" }}>
        You&rsquo;ve been unsubscribed from Tulsa Plumbing &amp; Remodeling marketing emails.
      </p>
      <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.6, color: "#4b5563" }}>
        You&rsquo;ll still receive service/appointment messages related to your jobs.
      </p>
      <p style={{ margin: "16px 0 0", fontSize: "15px", lineHeight: 1.6, color: "#4b5563" }}>
        Changed your mind, or need a hand? Call or text us at{" "}
        <a href={PHONE_TEL} style={{ color: BRAND, fontWeight: 600, textDecoration: "none" }}>
          {PHONE_DISPLAY}
        </a>
      </p>
    </>
  );
}

function FailureBody() {
  return (
    <>
      <h1
        style={{
          margin: "24px 0 0",
          fontSize: "24px",
          fontWeight: 700,
          color: "#171717",
        }}
      >
        This link isn&rsquo;t valid
      </h1>

      <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.6, color: "#4b5563" }}>
        We couldn&rsquo;t process this unsubscribe link. It may be incomplete or expired.
      </p>
      <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.6, color: "#4b5563" }}>
        To opt out, reply STOP to any of our messages, or call/text us at{" "}
        <a href={PHONE_TEL} style={{ color: BRAND, fontWeight: 600, textDecoration: "none" }}>
          {PHONE_DISPLAY}
        </a>{" "}
        and we&rsquo;ll take care of it.
      </p>
    </>
  );
}
