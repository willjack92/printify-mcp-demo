# Printify MCP for Claude

Connect [Printify](https://printify.com) to [Claude](https://claude.ai) so you can create, update, and publish print-on-demand products straight from a chat. Drop in a design, describe what you want, and Claude builds the product on your store.

This runs as a free Cloudflare Worker on **your own** Cloudflare account. Your Printify key stays in your account as an encrypted secret. No terminal required.

## Deploy it (one click, no terminal)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/willjack92/printify-mcp)

When you click the button you'll be asked to:

1. Connect your **GitHub** and **Cloudflare** accounts (both free).
2. Paste your **Printify Personal Access Token** when prompted for `PRINTIFY_API_KEY`. Generate it in Printify under **Settings → Connections → Personal Access Tokens** (give it shops / products / uploads / orders permissions). It's a long string starting with `eyJ`.
3. Click **Deploy**.

After ~a minute you'll get a Worker URL like `https://printify-mcp.<your-subdomain>.workers.dev`.

## Connect it to Claude

In the Claude desktop app: **Settings → Connectors → Add custom connector**.

- **Name:** Printify
- **URL:** your Worker URL with `/mcp` on the end, e.g. `https://printify-mcp.<your-subdomain>.workers.dev/mcp`

Save, then test in a chat:

> List my Printify shops.

If your store comes back, you're connected.

## What you can do

Ask Claude to list shops, list/create/update/publish products, browse blueprints and print providers, upload designs, and check orders. There's also a raw REST passthrough for anything advanced.

## Notes

- Your Printify token is stored as an encrypted Cloudflare secret, never in this code.
- The cheap "Economy" shipping option has to be enabled by hand in the Printify dashboard per product (the API can't toggle it).
- A light design disappears on a light garment and a dark design on a dark garment. Match light designs to dark shirts and dark designs to light shirts.
