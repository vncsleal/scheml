import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

const vercelUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: 'https://scheml.vercel.app';

export default defineConfig({
	adapter: vercel({
		includeFiles: [
			'demo-bundle/demo.manifest.json',
			'demo-bundle/schema.source',
			'demo-bundle/userChurn.metadata.json',
			'demo-bundle/userChurn.onnx',
			'demo-bundle/serverAnomaly.metadata.json',
			'demo-bundle/productSimilarity.metadata.json',
			'demo-bundle/productSimilarity.embeddings.npy',
			'demo-bundle/engagementSequence.metadata.json',
			'demo-bundle/engagementSequence.onnx',
			'demo-bundle/retentionMessage.metadata.json',
		],
	}),
	site: vercelUrl,
	output: 'hybrid',
	vite: {
		ssr: {
			external: ['@vncsleal/scheml'],
		},
	},
});
