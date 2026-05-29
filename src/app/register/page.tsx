"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(e.currentTarget);
    const name = (data.get("name") as string).trim();
    const email = (data.get("email") as string).trim();
    const password = data.get("password") as string;

    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/transactions",
    });
    setPending(false);

    if (error) {
      setError(error.message || "Sign-up failed");
      return;
    }
    // Email verification disabled — Better Auth auto-signs-in on signup, so go straight in.
    router.push("/transactions");
    router.refresh();
  }

  return (
    <div className="max-w-sm mx-auto py-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          name="name"
          type="text"
          required
          autoComplete="name"
          placeholder="Name"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
        />
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
          autoComplete="new-password"
          placeholder="Password (8+ chars)"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-zinc-900 text-white py-2 rounded text-sm disabled:opacity-50"
        >
          {pending ? "Creating…" : "Sign up"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
