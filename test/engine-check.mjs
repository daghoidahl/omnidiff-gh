// The one check that fails if the wasm engine breaks: the reactor build, called through the same
// WASI shim the extension uses, on a structural pair and a plain-text pair.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ConsoleStdout, WASI} from '@bjorn3/browser_wasi_shim';

const wasi = new WASI([], [], [
	new ConsoleStdout(() => undefined),
	new ConsoleStdout(bytes => process.stdout.write(bytes)),
	new ConsoleStdout(bytes => process.stderr.write(bytes)),
]);
const bytes = readFileSync('omnidiff-wasm/target/wasm32-wasip1/release/omnidiff_wasm.wasm');
const {instance} = await WebAssembly.instantiate(bytes, {wasi_snapshot_preview1: wasi.wasiImport});
wasi.initialize(instance);
const {memory, omnidiff_alloc, omnidiff_diff, omnidiff_free} = instance.exports;

function diff(file) {
	const input = new TextEncoder().encode(readFileSync(file, 'utf8'));
	const pointer = omnidiff_alloc(input.length);
	new Uint8Array(memory.buffer).set(input, pointer);
	const result = omnidiff_diff(pointer, input.length);
	const length = new DataView(memory.buffer).getUint32(result, true);
	const output = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, result + 4, length)));
	omnidiff_free(result, 4 + length);
	return output;
}

const operations = ranges => ranges.map(([operation]) => operation).filter(operation => operation !== 'Identical');

const python = diff('omnidiff-wasm/test.json');
assert.equal(python.language, 'Python');
assert.equal(python.structural, true);
assert.deepEqual(operations(python.after), ['Update', 'Move']);

const markdown = diff('omnidiff-wasm/test-markdown.json');
assert.equal(markdown.language, 'MarkDown');
assert.equal(markdown.structural, false);
assert.deepEqual(operations(markdown.after), ['Update', 'Insert']);

console.log('engine ok');
