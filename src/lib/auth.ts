import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "@/db";
// Email functionality disabled for now — re-enable along with the auth.ts hooks below.
// import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email";

// Fail loud rather than fall back to Better Auth's dev signing key in prod, which
// would make session tokens forgeable. Note: BETTER_AUTH_URL is intentionally NOT
// guarded — the prod task has no stable origin (the public IP changes every deploy),
// so baseURL is left unset and Better Auth infers it from the request. See DEPLOY.md.
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
  advanced: {
    // The app is served over plain HTTP (accessed by raw task IP, no TLS), and the
    // container runs with NODE_ENV=production. Better Auth's cookie config is computed
    // at init with no request in hand, so it falls back to isProduction → marks the
    // session cookie `Secure`, which browsers drop over HTTP → login silently bounces
    // back to /login. Force non-secure cookies so the session persists over HTTP.
    // Revisit (set to true / remove) once the app is fronted by HTTPS (ALB + ACM).
    useSecureCookies: false,
  },
  plugins: [nextCookies()],
});
