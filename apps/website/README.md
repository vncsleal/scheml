# ScheML Website

Marketing and documentation site for [ScheML](https://scheml.vercel.app).

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

Production deploys are handled by the GitHub Actions workflow at `.github/workflows/website-deploy.yml`.

The workflow requires these repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The demo uses the committed `demo-bundle/` directory, which is explicitly included in the Vercel serverless function bundle.

## Project Layout

```
apps/website/
├── src/
│   ├── layouts/         # Page layouts
│   ├── pages/           # Route pages (.astro)
├── public/              # Static assets
├── demo-bundle/         # Runtime ScheML artifacts used by the demo
├── vercel.json          # Vercel project config
└── astro.config.mjs     # Astro config (Vercel adapter)
```
