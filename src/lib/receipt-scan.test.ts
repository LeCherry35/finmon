import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanReceipt } from "@/lib/receipt-scan";

const fetchMock = vi.fn();

/** Build a fake OpenAI chat-completions response whose message content is the
 *  JSON the model would return under structured outputs. */
function openaiResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    text: async () => "",
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_MODEL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("scanReceipt", () => {
  it("maps the model's line items to product fields", async () => {
    fetchMock.mockResolvedValueOnce(
      openaiResponse({
        store: "Tesco",
        total: 5.5,
        products: [
          {
            name: "Milk",
            brand: "Avonmore",
            cost: 2.5,
            product_type: "dairy",
            tags: ["dairy", " "],
            description: null,
            price: 1.25,
            amount: 2,
            unit: "L",
          },
        ],
      }),
    );

    const result = await scanReceipt("data:image/jpeg;base64,AAAA");

    expect(result.store).toBe("Tesco");
    expect(result.total).toBe(5.5);
    expect(result.products).toEqual([
      {
        name: "Milk",
        brand: "Avonmore",
        cost: 2.5,
        product_type: "dairy",
        tags: ["dairy"], // blank tag dropped
        description: null,
        price: 1.25,
        amount: 2,
        unit: "L",
      },
    ]);
  });

  it("sends the image and a strict json_schema to the OpenAI API", async () => {
    fetchMock.mockResolvedValueOnce(openaiResponse({ store: null, total: null, products: [] }));

    await scanReceipt("data:image/png;base64,ZZZZ");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/openai\.com/);
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o-mini"); // default when OPENAI_MODEL unset
    expect(body.response_format.json_schema.strict).toBe(true);
    // the image data URL is included as an image_url content part
    const parts = body.messages[1].content;
    expect(parts).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,ZZZZ" },
    });
  });

  it("drops non-positive numbers and unnamed items", async () => {
    fetchMock.mockResolvedValueOnce(
      openaiResponse({
        store: "  ",
        total: 0,
        products: [
          { name: "Bread", cost: 0, price: -1, amount: 0, tags: [] },
          { name: "   ", cost: 3, tags: [] }, // no name → dropped
        ],
      }),
    );

    const result = await scanReceipt("data:image/jpeg;base64,AAAA");

    expect(result.store).toBeNull(); // blank → null
    expect(result.total).toBeNull(); // 0 → null
    expect(result.products).toEqual([
      {
        name: "Bread",
        brand: null,
        cost: null, // 0 dropped
        product_type: null,
        tags: [],
        description: null,
        price: null, // -1 dropped
        amount: null, // 0 dropped
        unit: null,
      },
    ]);
  });

  it("uses OPENAI_MODEL when set", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-4o");
    fetchMock.mockResolvedValueOnce(openaiResponse({ store: null, total: null, products: [] }));
    await scanReceipt("data:image/jpeg;base64,AAAA");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("gpt-4o");
  });

  it("throws when OPENAI_API_KEY is unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(scanReceipt("data:image/jpeg;base64,AAAA")).rejects.toThrow(
      /OPENAI_API_KEY/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-OK OpenAI response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limited",
      json: async () => ({}),
    });
    await expect(scanReceipt("data:image/jpeg;base64,AAAA")).rejects.toThrow(/429/);
  });

  it("throws on malformed JSON content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
      text: async () => "",
    });
    await expect(scanReceipt("data:image/jpeg;base64,AAAA")).rejects.toThrow(/malformed/i);
  });

  it("rejects a response whose shape violates the schema", async () => {
    fetchMock.mockResolvedValueOnce(
      openaiResponse({ store: null, total: null, products: "nope" }),
    );
    await expect(scanReceipt("data:image/jpeg;base64,AAAA")).rejects.toThrow();
  });
});
