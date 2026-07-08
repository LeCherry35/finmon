import { getCurrentUser } from "@/lib/dal";
import { getReceiptImage } from "@/db/queries";

/**
 * Serve a stored receipt image. The one read that can't be a server component:
 * binary bytes for an <a>/<img>. Session-checked (401 — no redirect: this URL
 * is fetched as a resource, not navigated to as a page) and tenant-scoped via
 * getReceiptImage, which returns null for another user's receipt (404, so a
 * foreign id is indistinguishable from a missing one).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return new Response("Not found", { status: 404 });

  const receipt = await getReceiptImage(user.id, id);
  if (!receipt) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(receipt.image), {
    headers: {
      "Content-Type": receipt.content_type,
      // Private data behind auth; a re-scan replaces the image under the same
      // id, so never let a shared cache or a stale browser copy serve it.
      "Cache-Control": "private, no-store",
    },
  });
}
