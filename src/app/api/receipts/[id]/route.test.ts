import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getReceiptImage } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getReceiptImage: vi.fn(),
}));
vi.mock("@/lib/dal", () => ({ getCurrentUser }));
vi.mock("@/db/queries", () => ({ getReceiptImage }));

import { GET } from "./route";

const REQ = new Request("http://localhost/api/receipts/7");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  getCurrentUser.mockReset().mockResolvedValue({ id: "user-1" });
  getReceiptImage.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/receipts/[id]", () => {
  it("returns 401 without a session, before touching the db", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    const res = await GET(REQ, params("7"));
    expect(res.status).toBe(401);
    expect(getReceiptImage).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "x", "1.5"])(
    "returns 404 for a non-positive-integer id (%s) without querying",
    async (id) => {
      const res = await GET(REQ, params(id));
      expect(res.status).toBe(404);
      expect(getReceiptImage).not.toHaveBeenCalled();
    },
  );

  it("returns 404 when the receipt is missing or another user's (user-scoped lookup)", async () => {
    const res = await GET(REQ, params("7"));
    expect(res.status).toBe(404);
    expect(getReceiptImage).toHaveBeenCalledWith("user-1", 7);
  });

  it("streams the stored bytes with the stored content type, uncached", async () => {
    getReceiptImage.mockResolvedValueOnce({
      image: Buffer.from("jpeg-bytes"),
      content_type: "image/jpeg",
    });

    const res = await GET(REQ, params("7"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("jpeg-bytes");
  });
});
