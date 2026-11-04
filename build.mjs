// Bundles src/ into dist/, the folder to load unpacked in Chrome or to convert for Safari.
import {copyFileSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import {build} from 'esbuild';

const wasm = 'omnidiff-wasm/target/wasm32-wasip1/release/omnidiff_wasm.wasm';
if (!existsSync(wasm)) {
	throw new Error(`${wasm} is missing: run \`make wasm\` first`);
}

rmSync('dist', {recursive: true, force: true});
mkdirSync('dist');

await build({
	entryPoints: ['src/content.ts', 'src/background.ts', 'src/options.ts'],
	bundle: true,
	format: 'esm',
	target: 'es2022',
	outdir: 'dist',
	logLevel: 'info',
});

for (const [from, to] of [
	['manifest.json', 'manifest.json'],
	['src/options.html', 'options.html'],
	['src/content.css', 'content.css'],
	[wasm, 'omnidiff.wasm'],
]) {
	copyFileSync(from, `dist/${to}`);
}
