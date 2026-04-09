/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module '@vercel/analytics/astro';

interface ImportMetaEnv {
  readonly GROQ_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}