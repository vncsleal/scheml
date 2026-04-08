import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function listFilesRecursive(dir) {
	const results = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			results.push(...listFilesRecursive(fullPath));
			continue;
		}

		results.push(`./${fullPath.replace(/\\/g, '/')}`);
	}

	return results;
}

const site = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: 'https://scheml.vercel.app';

const demoBundleFiles = listFilesRecursive('demo-bundle');

export default defineConfig({
	adapter: vercel({
		includeFiles: demoBundleFiles,
	}),
	output: 'hybrid',
	site,
	vite: {
		ssr: {
			external: ['@vncsleal/scheml'],
		},
	},
});
