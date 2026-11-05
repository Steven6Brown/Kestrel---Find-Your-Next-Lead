// Resend connector (email sending). Credentials stay in environment variables. A real send is
// the only way to fully prove a Resend key, and nothing is ever sent without your click, so
// this only reports whether the settings are present.
import { mailConfigured } from "../mailer.js";

const connector = {
  id: "resend",
  name: "Resend email",
  description: "Sends your reviewed outreach emails and account emails (password reset, invitations).",
  mode: "env",
  envVars: ["RESEND_API_KEY", "SENDER_EMAIL", "SENDER_NAME", "MAILING_ADDRESS"],
  requiredVars: ["RESEND_API_KEY", "SENDER_EMAIL"],
  configured: (env) => mailConfigured(env),
  async check({ env }) {
    if (!mailConfigured(env)) return { ok: false, message: "Add RESEND_API_KEY and SENDER_EMAIL to .env.local, then restart Kestrel." };
    return { ok: true, message: "Settings found. A test send happens only when you send a real email." };
  },
};

export default connector;
