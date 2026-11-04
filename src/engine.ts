// The omnidiff diff engine (https://github.com/ivankovic/omnidiff, AGPL-3.0-only) compiled to
// WebAssembly as `omnidiff.wasm`; the build is in `omnidiff-wasm/`. Usable from any extension
// context that may compile wasm: the content script in Safari and Firefox, the background worker
// in Chrome (which refuses wasm in content scripts with a bare CompileError).
import {ConsoleStdout, WASI} from '@bjorn3/browser_wasi_shim';

export type Operation = 'Identical' | 'Insert' | 'Delete' | 'Update' | 'Move';

/** Rows are 0-based; columns are byte offsets within the row. */
export type RangeMatch = {
	operation: Operation;
	startRow: number;
	startColumn: number;
	endRow: number;
	endColumn: number;
};

export type FileDiff = {
	language: string;
	/** False when the file has no grammar and omnidiff fell back to its line diff */
	structural: boolean;
	before: RangeMatch[];
	after: RangeMatch[];
};

export type DiffRequest = {before: string; after: string; path: string};

type RawDiff = {
	language: string;
	structural: boolean;
	before: Array<[Operation, number[]]>;
	after: Array<[Operation, number[]]>;
};

type Exports = {
	memory: WebAssembly.Memory;
	_initialize: () => void;
	omnidiff_alloc: (length: number) => number;
	omnidiff_free: (pointer: number, length: number) => void;
	omnidiff_diff: (pointer: number, length: number) => number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function load(): Promise<Exports> {
	const wasi = new WASI([], [], [
		new ConsoleStdout(() => undefined), // Stdin is never read
		new ConsoleStdout(bytes => {
			console.log(decoder.decode(bytes));
		}),
		new ConsoleStdout(bytes => {
			console.error('omnidiff:', decoder.decode(bytes));
		}),
	]);
	const imports = {wasi_snapshot_preview1: wasi.wasiImport};
	const response = await fetch(chrome.runtime.getURL('omnidiff.wasm'));
	const {instance} = await WebAssembly.instantiate(await response.arrayBuffer(), imports) as unknown as {
		instance: {exports: Exports};
	};
	wasi.initialize(instance);
	return instance.exports;
}

let engine: Promise<Exports> | undefined;

function parseRanges(ranges: Array<[Operation, number[]]>): RangeMatch[] {
	return ranges.map(([operation, [startRow, startColumn, endRow, endColumn]]) => ({
		operation,
		startRow,
		startColumn,
		endRow,
		endColumn,
	}));
}

/** Diffs two versions of a file. `path` only picks the grammar by its extension. */
export async function diffWithEngine({before, after, path}: DiffRequest): Promise<FileDiff> {
	engine ??= load();
	const exports = await engine;

	const input = encoder.encode(JSON.stringify({before, after, path}));
	const inputPointer = exports.omnidiff_alloc(input.length);
	new Uint8Array(exports.memory.buffer).set(input, inputPointer);

	const resultPointer = exports.omnidiff_diff(inputPointer, input.length);
	const length = new DataView(exports.memory.buffer).getUint32(resultPointer, true);
	const output = decoder.decode(new Uint8Array(exports.memory.buffer, resultPointer + 4, length));
	exports.omnidiff_free(resultPointer, 4 + length);

	const raw = JSON.parse(output) as RawDiff;
	return {
		language: raw.language,
		structural: raw.structural,
		before: parseRanges(raw.before),
		after: parseRanges(raw.after),
	};
}
