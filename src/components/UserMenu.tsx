import { getCurrentUser } from "@/lib/dal";
import { signOutAction } from "@/actions/auth";

export default async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <form action={signOutAction} className="ml-auto flex items-center gap-3 text-sm">
      <span className="hidden sm:inline text-zinc-500">{user.email}</span>
      <button type="submit" className="underline">
        Sign out
      </button>
    </form>
  );
}
