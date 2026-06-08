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

  it("never carries the model's description through (it's a manual-only field)", async () => {
    fetchMock.mockResolvedValueOnce(
      openaiResponse({
        store: "Tesco",
        total: null,
        products: [{ name: "Milk", description: "model invented this", tags: [] }],
      }),
    );
    const result = await scanReceipt("data:image/jpeg;base64,AAAA");
    expect(result.products[0].description).toBeNull();
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

  it("maps an aborted (timed-out) request to a friendly error", async () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValueOnce(aborted);
    await expect(scanReceipt("data:image/jpeg;base64,AAAA")).rejects.toThrow(
      /timed out/i,
    );
  });

  it("rejects a response whose shape violates the schema", async () => {
    fetchMock.mockResolvedValueOnce(
      openaiResponse({ store: null, total: null, products: "nope" }),
    );
    await expect(scanReceipt("data:image/jpeg;base64,AAAA")).rejects.toThrow();
  });
});

describe("scanReceipt system prompt", () => {
  /** Run a no-op scan and return the composed system message the call sent. */
  async function systemPromptFromScan() {
    fetchMock.mockResolvedValueOnce(openaiResponse({ store: null, total: null, products: [] }));
    await scanReceipt("data:image/jpeg;base64,AAAA");
    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    return body.messages[0].content as string;
  }

  it("composes the prompt from the template, the unit list, and the examples", async () => {
    const prompt = await systemPromptFromScan();

    // Placeholders are substituted, not left in the rendered prompt.
    expect(prompt).not.toContain("{{UNITS}}");
    expect(prompt).not.toContain("{{EXAMPLES}}");
    // Units from receipt-units.json are injected as a quoted list.
    expect(prompt).toContain('"kg"');
    expect(prompt).toContain('"dozen"');
    // Few-shot block from receipt-examples.json is rendered as numbered JSON outputs.
    expect(prompt).toContain("Examples (each shows the exact JSON to produce for a receipt):");
    expect(prompt).toContain("Example 1:");
    expect(prompt).toContain("Example 4:"); // four examples in the fixture
    expect(prompt).toContain('"АТБ"'); // store from the first example's output
    // Trimmed, non-empty.
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toBe(prompt.trim());
  });

  it("does not leak an example's maintainer-only `note` into the prompt", async () => {
    // renderExamples only serializes `output`, never `note`. Guard against a
    // regression that pretty-prints the whole example object.
    const prompt = await systemPromptFromScan();
    expect(prompt).not.toContain('"note"');
  });

  it("reads the template once and caches the composed prompt", async () => {
    vi.resetModules();
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const readSpy = vi.fn(realFs.readFileSync);
    vi.doMock("node:fs", () => ({ ...realFs, default: realFs, readFileSync: readSpy }));
    try {
      const { scanReceipt: freshScan } = await import("@/lib/receipt-scan");
      fetchMock.mockResolvedValue(openaiResponse({ store: null, total: null, products: [] }));
      await freshScan("data:image/jpeg;base64,AAAA");
      await freshScan("data:image/jpeg;base64,BBBB");
      const templateReads = readSpy.mock.calls.filter((c) =>
        String(c[0]).includes("receipt-prompt.md"),
      );
      expect(templateReads).toHaveLength(1); // composed once, reused on the 2nd scan
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });

  it("surfaces a missing prompt template at scan time, not on import", async () => {
    vi.resetModules();
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.doMock("node:fs", () => ({
      ...realFs,
      default: realFs,
      readFileSync: (p: Parameters<typeof realFs.readFileSync>[0], ...rest: unknown[]) => {
        if (String(p).includes("receipt-prompt.md")) {
          throw Object.assign(new Error("ENOENT: prompt template missing"), { code: "ENOENT" });
        }
        // @ts-expect-error pass-through to the real implementation
        return realFs.readFileSync(p, ...rest);
      },
    }));
    try {
      // Import succeeds — the template is read lazily on first scan, not at load.
      const { scanReceipt: freshScan } = await import("@/lib/receipt-scan");
      fetchMock.mockResolvedValue(openaiResponse({ store: null, total: null, products: [] }));
      await expect(freshScan("data:image/jpeg;base64,AAAA")).rejects.toThrow(/ENOENT/);
      expect(fetchMock).not.toHaveBeenCalled(); // failed before the network call
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
