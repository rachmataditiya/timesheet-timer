const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
	entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
	bundle: true,
	outfile: path.join(__dirname, 'out', 'extension.js'),
	external: ['vscode'],
	platform: 'node',
	target: 'node18',
	format: 'cjs',
	sourcemap: true,
	minify: false,
}).catch(() => process.exit(1));
