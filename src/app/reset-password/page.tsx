"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing or invalid reset token");
      return;
    }

    const data = new FormData(e.currentTarget);
    const newPassword = data.get("password") as string;

    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);

    if (error) {
      setError(error.message || "Could not reset password");
      return;
    }
    router.push("/login");
  }

  return (
    <div className="max-w-sm mx-auto py-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="New password (10+ chars)"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-zinc-900 text-white py-2 rounded text-sm disabled:opacity-50"
        >
          {pending ? "Resetting…" : "Reset password"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
