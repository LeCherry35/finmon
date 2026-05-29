"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function VerifyEmailPage() {
  const sp = useSearchParams();
  const email = sp.get("email") ?? "";
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function resend() {
    if (!email) return;
    setStatus(null);
    setPending(true);
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/transactions",
    });
    setPending(false);
    setStatus(error ? error.message || "Could not resend" : "Sent — check your inbox.");
  }

  return (
    <div className="max-w-sm mx-auto py-10 px-4 space-y-4">
      <h1 className="text-xl font-semibold">Check your inbox</h1>
      <p className="text-sm text-zinc-600">
        {email
          ? `We sent a verification link to ${email}. Click it to activate your account.`
          : "We sent a verification link to your email. Click it to activate your account."}
      </p>
      {email && (
        <button
          onClick={resend}
          disabled={pending}
          className="text-sm underline disabled:opacity-50"
        >
          {pending ? "Sending…" : "Resend email"}
        </button>
      )}
      {status && <p className="text-sm text-zinc-500">{status}</p>}
      <p className="text-sm">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
