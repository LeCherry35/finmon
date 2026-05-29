"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setUnverifiedEmail(null);
    setPending(true);

    const data = new FormData(e.currentTarget);
    const email = (data.get("email") as string).trim();
    const password = data.get("password") as string;

    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);

    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(email);
      } else {
        setError(error.message || "Sign-in failed");
      }
      return;
    }
    router.push("/transactions");
    router.refresh();
  }

  // Email functionality disabled — verification resend is off for now.
  // async function resend() {
  //   if (!unverifiedEmail) return;
  //   const { error } = await authClient.sendVerificationEmail({
  //     email: unverifiedEmail,
  //     callbackURL: "/transactions",
  //   });
  //   if (error) {
  //     setError(error.message || "Could not resend");
  //   } else {
  //     setInfo("Verification email sent — check your inbox.");
  //     setUnverifiedEmail(null);
  //   }
  // }

  return (
    <div className="max-w-sm mx-auto py-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="current-password"
          placeholder="Password"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-zinc-900 text-white py-2 rounded text-sm disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-emerald-600">{info}</p>}
      {/* Email functionality disabled — verification/resend and password reset are off for now.
      {unverifiedEmail && (
        <p className="text-sm text-zinc-600">
          Email not verified.{" "}
          <button onClick={resend} className="underline">
            Resend verification email
          </button>
        </p>
      )}
      */}
      <div className="text-sm text-zinc-500 space-y-1">
        <p>
          No account?{" "}
          <Link href="/register" className="underline">
            Sign up
          </Link>
        </p>
        {/* <p>
          <Link href="/forgot-password" className="underline">
            Forgot password?
          </Link>
        </p> */}
      </div>
    </div>
  );
}
