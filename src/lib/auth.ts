import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "@/db";
// Email functionality disabled for now — re-enable along with the auth.ts hooks below.
// import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email";

// Fail loud rather than fall back to Better Auth's dev signing key in prod, which
// would make session tokens forgeable. BETTER_AUTH_URL is not throw-guarded, but in
// prod it's expected to be the stable HTTPS origin (Cloudflare + nginx, e.g.
// https://finmon.uk) and is passed straight to `baseURL` below. See DEPLOY.md.
if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // Email disabled: no verification gate and auto sign-in on signup (Better Auth default).
    // requireEmailVerification: true,
    minPasswordLength: 8,
    // sendResetPassword: async ({ user, url }) => {
    //   await sendPasswordResetEmail({ user, url });
    // },
  },
  // emailVerification: {
  //   sendOnSignUp: true,
  //   autoSignInAfterVerification: true,
  //   sendVerificationEmail: async ({ user, url }) => {
  //     await sendVerificationEmail({ user, url });
  //   },
  // },
  // Throttle Better Auth's HTTP endpoints to blunt brute-force and account
  // enumeration. `enabled: true` turns this on in all envs (Better Auth's
  // default only enables it in production). In-memory store is the default —
  // fine for the single prod task; switch to `storage: "database"` (needs the
  // rateLimit table) if the deploy ever scales to multiple instances. Limits
  // are per-IP per window (seconds). Custom rules use Better Auth's API paths
  // (note: `/forget-password`, not the app's `/forgot-password` route).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 3 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 3 },
    },
  },
  advanced: {
    // The app is fronted by HTTPS (Cloudflare + nginx reverse proxy), so secure
    // cookies are required: the browser only sends `Secure` cookies over HTTPS.
    useSecureCookies: true,
  },
  plugins: [nextCookies()],
});
