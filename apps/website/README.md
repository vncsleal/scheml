# getscheml.vercel.app

Marketing and documentation site for [ScheML](https://getscheml.vercel.app).

## Stack

- **[Astro 4](https://astro.build/)** — static site with SSR pages
- **[@astrojs/vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/)** — Vercel adapter for deployment

## Local Development

From the monorepo root:

```sh
pnpm install
pnpm -F scheml-website dev
```

Or from this directory:

```sh
pnpm install
pnpm dev
```

The site starts at `http://localhost:4321`.

## Build & Deploy

```sh
pnpm build    # outputs to dist/
pnpm preview  # preview the production build locally
```

Deployments happen automatically via the [Vercel](https://vercel.com) GitHub integration on push to `main`.

## Project Layout

```
apps/website/
├── src/
│   ├── layouts/         # Page layouts
│   ├── pages/           # Route pages (.astro)
├── public/              # Static assets
└── astro.config.mjs     # Astro config (Vercel adapter)
```
