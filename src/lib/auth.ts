import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "@/db";
// Email functionality disabled for now — re-enable along with the auth.ts hooks below.
// import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email";

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
  plugins: [nextCookies()],
});
