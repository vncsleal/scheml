# ScheML Website

Marketing and documentation site for [ScheML](https://scheml.vercel.app).

## Stack

- **[Astro 4](https://astro.build/)** — static site with SSR pages
- **[@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/)** — standalone Node.js adapter for deployment

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

To run the production server locally:

```sh
pnpm -F @vncsleal/scheml build
pnpm -F scheml-website build
pnpm -F scheml-website start
```

The demo uses the committed `demo-bundle/` directory at runtime, which matches how ScheML users load immutable artifacts from disk inside a normal Node application.

## Build & Run

```sh
pnpm build    # outputs to dist/
pnpm start    # runs the standalone Node server
```

Set `SITE_URL` in production so canonical URLs and metadata point at the deployed origin.

## Container Deployment

Build the website as a normal containerized Node process:

```sh
docker build -f apps/website/Dockerfile -t scheml-website .
docker run --rm -p 4321:4321 -e SITE_URL=https://scheml.vercel.app scheml-website
```

The container carries:

- the standalone Astro server
- the built `@vncsleal/scheml` package from this repo
- the committed `demo-bundle/` runtime artifacts

## Project Layout

```
apps/website/
├── src/
│   ├── layouts/         # Page layouts
│   ├── pages/           # Route pages (.astro)
├── public/              # Static assets
├── demo-bundle/         # Runtime ScheML artifacts used by the demo
├── Dockerfile           # Container image for standalone deployment
└── astro.config.mjs     # Astro config (Node standalone adapter)
```
