import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  PRINTIFY_API_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const PRINTIFY_BASE = "https://api.printify.com/v1";

async function printifyFetch(
  env: Env,
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const url = new URL(`${PRINTIFY_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
      "User-Agent": "printify-mcp/0.1 (+https://github.com/)",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Printify ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 500)}`,
    );
  }
  return res.json();
}

async function printifyPost(
  env: Env,
  path: string,
  body: unknown,
  method: "POST" | "PUT" | "DELETE" = "POST",
) {
  const url = new URL(`${PRINTIFY_BASE}${path}`);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "printify-mcp/0.2 (+https://github.com/)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `Printify ${res.status} ${res.statusText} on ${method} ${path}: ${errBody.slice(0, 800)}`,
    );
  }
  // Some endpoints return 200 with empty body
  const text = await res.text();
  if (!text) return { ok: true };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

function asText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export class PrintifyMCP extends McpAgent<Env> {
  server = new McpServer(
    { name: "printify", version: "0.4.0" },
    {
      instructions: `You are helping the user launch print-on-demand t-shirt products via Printify + Shopify. This connector exposes Printify API tools. The user will also have Shopify tools available separately. The SOPs below are the canonical "Will Pattern" playbook (developed across thousands of launches on Sunday Tees and other POD stores) — they are the recommended defaults. The user can override any specific value in chat, but follow the pattern unless told otherwise.

# At the start of EVERY new launch

Ask the user for the product specifics IN ONE BATCH (not back-and-forth):
1. **Product title**
2. **Design file** (path to PNG)
3. **Garment / blueprint** (default: Gildan 64000 / blueprint 145, pp 99 — customer-facing called "Deluxe Tee". Verify via get_blueprint before building.)
4. **Single product or couples pair?**
5. **Colors** (recommend after running the design colour analysis in §1)
6. **Description** (or draft from a 1-line brief using the brand voice in §6)
7. **Funnel publication ID** (if user has a Lovable/funnel page on a separate Shopify sales channel, ask for the publicationId so the SOP can publish to it. Skip if N/A.)

Once answered, RUN the full SOP without check-ins, applying the Will Pattern defaults below. Report URLs at the end.

# SOP §1 — Design text colour analysis (DO BEFORE color selection)

Programmatically analyze the design PNG to determine text colour:
- Use PIL: compute the % of non-transparent pixels that are near-black (max RGB < 80) vs near-white (R/G/B > 200).
- **Dominant BLACK text** → only enable LIGHT shirts (White, Sport Grey, Natural, Ash, light heathers).
- **Dominant WHITE text** → only enable DARK shirts (Royal, Red, Navy, Black, Forest, etc.).
- **Mixed (e.g. black text + colorful elements)** → light shirts only.
NEVER apply a white-text design to a white shirt (invisible) or a black-text design to a black shirt (invisible).

# SOP §2 — Pricing (Will Pattern canonical: $29.99 / $39.99 "Save $10")

Default pricing for a single Deluxe Tee:
- **price = 2999 ($29.99)** — set on every enabled variant in create_product (cents)
- **compareAtPrice = "39.99"** — set on Shopify side AFTER publish via productVariantsBulkUpdate
- Framing in copy: "**Save $10**"

For couples pairs / bundles: the bundle page price is the sum of singles less $20 ("Save $20 on the matching set"). Apply the bundle discount via the user's funnel, not Shopify variant prices.

⚠️ Always pass price=2999 explicitly on every enabled variant in create_product. If left unset, Printify returns cost-only (way below retail) and you'll go live underpriced.

User can override pricing in chat — but $29.99/$39.99 is the default.

# SOP §3 — Variant grid

## Single-colour-text design (one print_area)
Enable S, M, L, XL, 2XL, 3XL, 4XL, 5XL per colour (8 sizes). Skip XS unless the user wants it — XS often exists only on one colour and creates a broken size dropdown.

For Gildan 64000 the canonical variant IDs are:
- **White** S-5XL: [38163, 38177, 38191, 38205, 38219, 42120, 66211, 95175]
- **Royal** S-5XL: [38161, 38175, 38189, 38203, 38217, 42118, 66208, 95171]
- **Red** S-5XL: [38160, 38174, 38188, 38202, 38216, 42117, 66207, 95170]

For other colours and other blueprints, call get_blueprint_variants to look up IDs.

## Dual-colour-text design (light-text version + dark-text version, multi-colour Gildan 64000)
For tees that ship in mixed colours (e.g. White + Royal + Red) where the design needs TWO text-colour versions:
- **Three print_areas required**, partitioning ALL blueprint variant IDs (not just enabled):
  - Area 0 (catch-all, includes White): BLACK-text design, variant_ids = ALL blueprint variants EXCEPT the dark-colour IDs
  - Area 1: WHITE-text design, variant_ids = all dark colour 1 IDs (e.g. all 9 Red)
  - Area 2: WHITE-text design, variant_ids = all dark colour 2 IDs (e.g. all 9 Royal)
If you only send enabled variant_ids and skip the disabled, Printify silently extends the last area to fill the gap and burns one half.

# SOP §4 — Print placement (HIGH chest, canonical)

For Gildan 64000 / Bella+Canvas 3001 chest print:
- x = 0.5 (centered)
- y ≈ 0.40 (start here; 0.32 too high, 0.50 too low — fine-tune per design aspect)
- scale ≈ 0.93 (range 0.89-0.97; design-dependent)
- angle = 0

# SOP §5 — Smart-invert for dual-colour-text products

For dark shirt variants when the source design has black ink: smart-invert (black-pixel → white, preserve red/colored elements). Save as "<name> (Black Tee).png" or "(White Text).png". Upload BOTH versions and assign to print_areas per §3.

# SOP §6 — Brand voice (CUSTOMER-FACING COPY — Will Pattern defaults)

These are the canonical defaults. Apply them unless the user explicitly overrides:

- **Provenance**: always "Designed and shipped from the USA". NEVER mention UK, London, or any non-US origin.
- **AI tooling**: NEVER mention AI / Higgsfield / GPT / Midjourney. Describe designs as "original designs from our studio" or "hand-crafted" — implies human craftsmanship without being defensive about it.
- **Garment naming**: customer copy says **"Deluxe Tee"** (or the user's specified brand line). NEVER "Gildan 64000" or any spec-sheet language. Spec details (cotton weight, fabric blend) can go in a "Made from" sub-section but stay short.
- **Returns**: POD products are made-to-order. NEVER claim "30-day returns" / "hassle-free returns" / "easy returns" — those are lies that create support headaches. Use **"made to order in the USA"** instead — honest about no-stock POD reality AND positions the product as crafted, not mass-shipped.
- **Sizing reassurance**: address the real objection with phrases like "runs true to size", "order your usual size", "not boxy, not tight".
- **Currency**: USD only ("$29.99"). Never £, never EUR. Even if the user's Shopify is GBP-denominated, customer copy is USD.
- **Formatting**: use **<strong>** for emphasis on 5-7 phrases per description. NEVER underline (online, underline implies hyperlink).
- **Multi-platform pricing**: if the brand uses a funnel page (Lovable, a quiz funnel) with bundle discounts, NEVER quote specific per-unit dollar amounts in the description. Frame as "Save $X" generically so the Shopify single PDP AND the funnel both stay accurate.
- **Polarity is the feature**: for couples/humour brands, designs should provoke strong reactions both ways (half love, half cringe). Don't sand off the edges in the copy — bland = no reaction = no clicks. The strong "wait, oh!" reaction is what drives the impulse buy.

# SOP §7 — After product creation: publish to Shopify

1. Call publish_product (Printify auto-creates the Shopify product).
2. Wait 60s. Verify the Shopify product appeared via productByHandle.
3. If missing → re-publish up to 3 times with 60s waits (mockup-generation lag is real, especially on first launches of a new blueprint).

# SOP §8 — Mockup cleanup on Shopify side (the Front-only SOP — RUN ON EVERY PUBLISH)

Printify pushes 8-45 mockups including Folded, Lifestyle, Back variants. Most brands want only plain Front mockups on the PDP. After publish:

1. Query the Shopify product via productByHandle to get all media + variant→media mappings.
2. **Visually inspect each media** — download via curl, Read each PNG. NEVER trust filename or Shopify auto-link (Printify auto-links variants to the wrong mockup more often than not).
   - **Plain Front mockup**: WHITE/solid top-left pixel (~255,255,255), 50-150KB file size. Flat unfolded tee, full design visible.
   - **Folded/lifestyle**: SAND/beige background (~237,214,196), 700KB-1MB file size. Props (hat/sunglasses/succulents), design cropped.
3. **Delete non-Front media** via productDeleteMedia. Keep one Front per colour.
4. **Set the first colour's Front as featured** via productReorderMedia (newPosition "0") — this becomes the PDP hero + collection thumbnail.
5. **Link variants** to their colour's Front mockup via productVariantAppendMedia (NOT productVariantsBulkUpdate — that mutation does NOT accept imageId, confirmed via Shopify GraphQL schema).
6. **Set compareAtPrice** via productVariantsBulkUpdate on every variant.
7. **Publish to funnel sales channel** (if the user provided a publicationId at start): publishablePublish(productId, input: [{publicationId: "<id>"}]). Printify only auto-publishes to Online Store + Copilot. If the user has a funnel page (Lovable, a custom storefront, a quiz funnel) on a separate Shopify publication, this step is REQUIRED or the funnel silently 404s the product. If no publicationId was provided, skip this step.
8. **Clean handle**: rename via productUpdate to drop ® and other characters that URL-encode badly.

# SOP §9 — Final manual reminder

After all API steps complete, ALWAYS tell the user: **"⚠️ Hop into the Printify product admin (URL: <link>) and tick Economy shipping ON — the API can't toggle it."**

# SOP §10 — DO NOT

- Do NOT hammer the Printify order-creation API for fulfillment (it rate-limits after bursts and returns 500s for hours, not 429s). One create call per order. Verify + back off.
- Do NOT publish products without running the mockup cleanup SOP (§8) — the PDP looks like junk otherwise.
- Do NOT use copyrighted phrases (song lyrics, movie quotes, brand-name puns) — legal risk.
- Do NOT skip the additional-publication step (§8.7) when the user has a funnel — the funnel will silently 404 the product.
- Do NOT take blueprint IDs on faith — call get_blueprint or get_blueprint_variants to confirm before building.

# Output format

When done, return to the user:
- Printify product ID + admin URL
- Shopify product ID + admin URL + live PDP URL
- Confirmation of each publication the product was pushed to
- Mockups kept vs deleted
- compareAtPrice confirmed
- Economy shipping reminder`,
    },
  );

  async init() {
    const env = this.env;

    this.server.tool(
      "list_shops",
      "List all shops connected to your Printify account. Run this first to get the shop_id used by other tools.",
      {},
      async () => asText(await printifyFetch(env, "/shops.json")),
    );

    this.server.tool(
      "list_products",
      "List products in a shop.",
      {
        shop_id: z
          .union([z.string(), z.number()])
          .describe("Shop ID from list_shops"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Items per page (max 100)"),
      },
      async ({ shop_id, page, limit }) =>
        asText(
          await printifyFetch(env, `/shops/${shop_id}/products.json`, { page, limit }),
        ),
    );

    this.server.tool(
      "get_product",
      "Get full details for a single product, including variants and print areas.",
      {
        shop_id: z.union([z.string(), z.number()]),
        product_id: z.string(),
      },
      async ({ shop_id, product_id }) =>
        asText(
          await printifyFetch(env, `/shops/${shop_id}/products/${product_id}.json`),
        ),
    );

    this.server.tool(
      "list_orders",
      "List orders for a shop.",
      {
        shop_id: z.union([z.string(), z.number()]),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        status: z
          .string()
          .optional()
          .describe("Filter by status, e.g. 'pending', 'on-hold', 'fulfilled', 'cancelled'"),
      },
      async ({ shop_id, page, limit, status }) =>
        asText(
          await printifyFetch(env, `/shops/${shop_id}/orders.json`, {
            page,
            limit,
            status,
          }),
        ),
    );

    this.server.tool(
      "get_order",
      "Get full details for a single order including line items, shipping, and status history.",
      {
        shop_id: z.union([z.string(), z.number()]),
        order_id: z.string(),
      },
      async ({ shop_id, order_id }) =>
        asText(await printifyFetch(env, `/shops/${shop_id}/orders/${order_id}.json`)),
    );

    this.server.tool(
      "list_blueprints",
      "List all product blueprints in the Printify catalog (t-shirts, mugs, hoodies, etc.).",
      {},
      async () => asText(await printifyFetch(env, "/catalog/blueprints.json")),
    );

    this.server.tool(
      "get_blueprint",
      "Get details for a specific blueprint.",
      { blueprint_id: z.union([z.string(), z.number()]) },
      async ({ blueprint_id }) =>
        asText(await printifyFetch(env, `/catalog/blueprints/${blueprint_id}.json`)),
    );

    this.server.tool(
      "list_print_providers_for_blueprint",
      "List print providers that can produce a given blueprint.",
      { blueprint_id: z.union([z.string(), z.number()]) },
      async ({ blueprint_id }) =>
        asText(
          await printifyFetch(
            env,
            `/catalog/blueprints/${blueprint_id}/print_providers.json`,
          ),
        ),
    );

    this.server.tool(
      "get_blueprint_variants",
      "Get available variants (sizes, colors) for a blueprint at a given print provider.",
      {
        blueprint_id: z.union([z.string(), z.number()]),
        print_provider_id: z.union([z.string(), z.number()]),
      },
      async ({ blueprint_id, print_provider_id }) =>
        asText(
          await printifyFetch(
            env,
            `/catalog/blueprints/${blueprint_id}/print_providers/${print_provider_id}/variants.json`,
          ),
        ),
    );

    this.server.tool(
      "list_print_providers",
      "List all print providers in the Printify catalog.",
      {},
      async () => asText(await printifyFetch(env, "/catalog/print_providers.json")),
    );

    this.server.tool(
      "list_uploads",
      "List images uploaded to your Printify media library.",
      {
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async ({ page, limit }) =>
        asText(await printifyFetch(env, "/uploads.json", { page, limit })),
    );

    this.server.tool(
      "get_upload",
      "Get metadata for a single uploaded image.",
      { upload_id: z.string() },
      async ({ upload_id }) =>
        asText(await printifyFetch(env, `/uploads/${upload_id}.json`)),
    );

    // ───────────────────────── WRITE TOOLS ─────────────────────────

    this.server.tool(
      "upload_image",
      "Upload an image to the Printify media library. Provide EITHER url (public URL Printify can fetch) OR contents (base64-encoded image data). Returns upload_id used in create_product.",
      {
        file_name: z
          .string()
          .describe("Filename including extension, e.g. 'bobbers.png'"),
        url: z
          .string()
          .url()
          .optional()
          .describe("Public HTTPS URL Printify can pull the image from"),
        contents: z
          .string()
          .optional()
          .describe("Base64-encoded image bytes (use this when no public URL)"),
      },
      async ({ file_name, url, contents }) => {
        if (!url && !contents) {
          throw new Error("Provide either url or contents (base64)");
        }
        const body: Record<string, string> = { file_name };
        if (url) body.url = url;
        if (contents) body.contents = contents;
        return asText(await printifyPost(env, "/uploads/images.json", body));
      },
    );

    this.server.tool(
      "create_product",
      "Create a new product in a Printify shop. The product is saved as a draft (visible=false in shop) until publish_product is called. Body must include: title, description, blueprint_id, print_provider_id, variants array (each with id, price in cents, is_enabled), print_areas array. See Printify docs: POST /v1/shops/{shop_id}/products.json",
      {
        shop_id: z.union([z.string(), z.number()]),
        title: z.string(),
        description: z.string(),
        blueprint_id: z.union([z.string(), z.number()]),
        print_provider_id: z.union([z.string(), z.number()]),
        variants: z
          .array(
            z.object({
              id: z.number().int(),
              price: z.number().int().describe("Price in cents, e.g. 3999 for $39.99"),
              is_enabled: z.boolean().optional(),
            }),
          )
          .describe("Variants to enable on this product. Get IDs from get_blueprint_variants."),
        print_areas: z
          .array(
            z.object({
              variant_ids: z.array(z.number().int()),
              placeholders: z.array(
                z.object({
                  position: z
                    .enum(["front", "back", "sleeve_left", "sleeve_right", "neck_label"])
                    .describe("Print area position"),
                  images: z.array(
                    z.object({
                      id: z.string().describe("Upload ID from upload_image"),
                      x: z.number().optional().default(0.5),
                      y: z.number().optional().default(0.5),
                      scale: z.number().optional().default(1),
                      angle: z.number().optional().default(0),
                    }),
                  ),
                }),
              ),
            }),
          )
          .describe("Print placement config. Map design upload to print position per variant set."),
        tags: z.array(z.string()).optional(),
      },
      async ({ shop_id, ...productBody }) =>
        asText(
          await printifyPost(env, `/shops/${shop_id}/products.json`, productBody),
        ),
    );

    this.server.tool(
      "publish_product",
      "Publish a Printify product to the connected sales channel (e.g. Shopify). Sets the product visible on the storefront.",
      {
        shop_id: z.union([z.string(), z.number()]),
        product_id: z.string(),
        title: z.boolean().optional().default(true),
        description: z.boolean().optional().default(true),
        images: z.boolean().optional().default(true),
        variants: z.boolean().optional().default(true),
        tags: z.boolean().optional().default(true),
      },
      async ({ shop_id, product_id, ...flags }) =>
        asText(
          await printifyPost(
            env,
            `/shops/${shop_id}/products/${product_id}/publish.json`,
            flags,
          ),
        ),
    );

    this.server.tool(
      "delete_product",
      "Delete a product from a Printify shop. This also unpublishes from the connected sales channel.",
      {
        shop_id: z.union([z.string(), z.number()]),
        product_id: z.string(),
      },
      async ({ shop_id, product_id }) =>
        asText(
          await printifyPost(
            env,
            `/shops/${shop_id}/products/${product_id}.json`,
            undefined,
            "DELETE",
          ),
        ),
    );

    this.server.tool(
      "update_product",
      "Update an existing product. Pass only the fields you want to change (title, description, variants, tags, etc.).",
      {
        shop_id: z.union([z.string(), z.number()]),
        product_id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        variants: z
          .array(
            z.object({
              id: z.number().int(),
              price: z.number().int().optional(),
              is_enabled: z.boolean().optional(),
            }),
          )
          .optional(),
      },
      async ({ shop_id, product_id, ...patch }) =>
        asText(
          await printifyPost(
            env,
            `/shops/${shop_id}/products/${product_id}.json`,
            patch,
            "PUT",
          ),
        ),
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return PrintifyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return PrintifyMCP.serve("/mcp").fetch(request, env, ctx);
    }
    // Direct REST endpoints so a Bash/Python script can hit Printify
    // through the worker's API key without re-implementing MCP transport.
    // Same Printify API key on the worker side; just simpler I/O.
    if (request.method === "POST" && url.pathname === "/rest/upload-image") {
      try {
        const body = await request.json();
        const res = await fetch(`${PRINTIFY_BASE}/uploads/images.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    if (request.method === "POST" && url.pathname.startsWith("/rest/shops/") && url.pathname.endsWith("/products.json")) {
      try {
        const body = await request.json();
        const printifyPath = url.pathname.replace("/rest", "");
        const res = await fetch(`${PRINTIFY_BASE}${printifyPath}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    // PUT /rest/shops/{id}/products/{product_id}.json — full update (accepts arbitrary fields)
    if (request.method === "PUT" && url.pathname.startsWith("/rest/shops/") && url.pathname.endsWith(".json")) {
      try {
        const body = await request.json();
        const printifyPath = url.pathname.replace("/rest", "");
        const res = await fetch(`${PRINTIFY_BASE}${printifyPath}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    // Generic Printify passthrough: /raw/* → v1, /rawv2/* → v2
    if (url.pathname.startsWith("/raw/") || url.pathname.startsWith("/rawv2/")) {
      try {
        const isV2 = url.pathname.startsWith("/rawv2/");
        const base = isV2 ? "https://api.printify.com/v2" : PRINTIFY_BASE;
        const prefix = isV2 ? "/rawv2" : "/raw";
        const printifyPath = url.pathname.replace(prefix, "");
        const body = ["POST", "PUT", "PATCH"].includes(request.method)
          ? await request.text()
          : undefined;
        const res = await fetch(`${base}${printifyPath}${url.search}`, {
          method: request.method,
          headers: {
            Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: body || undefined,
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(
      "Printify MCP server. Connect Claude via /mcp (Streamable HTTP) or /sse. REST: POST /rest/upload-image, POST /rest/shops/{id}/products.json, PUT /rest/shops/{id}/products/{pid}.json, /raw/* passthrough.",
      { status: 200, headers: { "content-type": "text/plain" } },
    );
  },
};
