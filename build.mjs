// Bundles src/ into dist/, the folder to load unpacked in Chrome or to convert for Safari.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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

// The version comes from package.json; chrome://extensions shows version_name, which adds the commit
const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).trim();
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
writeFileSync('dist/manifest.json', JSON.stringify({...manifest, version, version_name: `${version} (${commit})`}, undefined, '\t'));

for (const [from, to] of [
	['src/options.html', 'options.html'],
	['src/content.css', 'content.css'],
	[wasm, 'omnidiff.wasm'],
]) {
	copyFileSync(from, `dist/${to}`);
}
