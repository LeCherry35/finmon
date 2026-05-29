"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(e.currentTarget);
    const email = (data.get("email") as string).trim();

    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setPending(false);

    if (error) {
      setError(error.message || "Could not send reset email");
      return;
    }
    setSent(true);
  }

  return (
    <div className="max-w-sm mx-auto py-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {sent ? (
        <p className="text-sm text-zinc-600">
          If an account exists for that email, we&apos;ve sent a reset link. Check your inbox.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full bg-zinc-900 text-white py-2 rounded text-sm disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
