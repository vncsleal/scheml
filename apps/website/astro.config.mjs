import { defineConfig, passthroughImageService } from 'astro/config';
import node from '@astrojs/node';

const siteUrl = process.env.SITE_URL ?? 'https://scheml.vercel.app';

export default defineConfig({
	output: 'server',
	adapter: node({
		mode: 'standalone',
	}),
	image: {
		service: passthroughImageService(),
	},
	server: {
		host: true,
	},
	site: siteUrl,
	vite: {
		ssr: {
			external: ['@vncsleal/scheml'],
		},
	},
});
