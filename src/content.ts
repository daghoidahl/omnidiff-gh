import {type DiffRequest, diffWithEngine, type FileDiff, type Operation, type RangeMatch} from './engine.js';
import {api, apiList, type Repo, repoFromLocation} from './github.js';

// The engine runs on the main thread (or the background worker); bigger files keep GitHub's diff
const maxFileBytes = 300_000;

type Side = 'before' | 'after';

const highlights = {
	deletion: new Highlight(),
	addition: new Highlight(),
	move: new Highlight(),
};

for (const [name, highlight] of Object.entries(highlights)) {
	CSS.highlights.set(`omnidiff-${name}`, highlight);
}

/** Undefined for text omnidiff found unchanged: it keeps its syntax colors, like in omnidiff's own viewer */
function highlightFor(operation: Operation, side: Side): Highlight | undefined {
	switch (operation) {
		case 'Identical': {
			return undefined;
		}

		case 'Move': {
			return highlights.move;
		}

		case 'Insert':
		case 'Delete':
		case 'Update': {
			return side === 'before' ? highlights.deletion : highlights.addition;
		}
	}
}

// Chrome refuses wasm in content scripts; Safari and Firefox allow it. Try here, else ask the worker.
let engineHere: boolean | undefined;

async function diffFile(request: DiffRequest): Promise<FileDiff> {
	if (engineHere !== false) {
		try {
			const result = await diffWithEngine(request);
			engineHere = true;
			return result;
		} catch (error) {
			if (engineHere || !(error instanceof WebAssembly.CompileError)) {
				throw error;
			}

			engineHere = false;
		}
	}

	const response = await chrome.runtime.sendMessage({omnidiff: request}) as FileDiff | {error: string};
	if ('error' in response) {
		throw new Error(response.error);
	}

	return response;
}

type Shas = {base: string; head: string};
type Versions = FileDiff & {beforeText: string; afterText: string};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const shas = new Map<string, Promise<Shas>>();
const pathsByAnchor = new Map<string, Promise<Map<string, string>>>();
const fileDiffs = new Map<string, Promise<Versions | undefined>>();

const prKey = ({owner, name, pr, range}: Repo): string =>
	`${owner}/${name}#${pr}${range ? `@${range.from}..${range.to}` : ''}`;

/** The whole PR is merge base → head; one commit is its parent → it; a range is from → to */
async function getShas(repo: Repo): Promise<Shas> {
	const key = prKey(repo);
	if (!shas.has(key)) {
		shas.set(key, (async () => {
			const api_ = `repos/${repo.owner}/${repo.name}`;
			if (repo.range?.from) {
				return {base: repo.range.from, head: repo.range.to};
			}

			if (repo.range) {
				const commit = (await api<{sha: string; parents: Array<{sha: string}>}>(`${api_}/commits/${repo.range.to}`)).data;
				return {base: commit.parents[0].sha, head: commit.sha};
			}

			const pr = (await api<{base: {sha: string}; head: {sha: string}}>(`${api_}/pulls/${repo.pr}`)).data;
			const compare = (await api<{merge_base_commit: {sha: string}}>(`${api_}/compare/${pr.base.sha}...${pr.head.sha}`)).data;
			return {base: compare.merge_base_commit.sha, head: pr.head.sha};
		})());
	}

	return shas.get(key)!;
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** GitHub anchors each file as `diff-` + SHA-256 of its path, so the PR's file list maps anchors back to paths */
async function getPathsByAnchor(repo: Repo): Promise<Map<string, string>> {
	const key = prKey(repo);
	if (!pathsByAnchor.has(key)) {
		pathsByAnchor.set(key, (async () => {
			const files = await apiList<{filename: string}>(`repos/${repo.owner}/${repo.name}/pulls/${repo.pr}/files?per_page=100`);
			const paths = new Map<string, string>();
			for (const {filename} of files) {
				paths.set(await sha256(filename), filename);
			}

			return paths;
		})());
	}

	return pathsByAnchor.get(key)!;
}

async function fetchFile(repo: Repo, sha: string, path: string): Promise<string | undefined> {
	const response = await fetch(`https://github.com/${repo.owner}/${repo.name}/raw/${sha}/${path}`);
	if (response.status === 404) {
		return undefined; // Added or deleted file: GitHub's whole-file paint is already right
	}

	if (!response.ok) {
		throw new Error(`omnidiff: ${response.status} fetching ${path} at ${sha}`);
	}

	const text = await response.text();
	return text.length <= maxFileBytes ? text : undefined;
}

/** Undefined for added, deleted and too large files */
async function getVersions(repo: Repo, path: string): Promise<Versions | undefined> {
	const {base, head} = await getShas(repo);
	const key = `${base}..${head}:${path}`;
	if (!fileDiffs.has(key)) {
		fileDiffs.set(key, (async () => {
			const [beforeText, afterText] = await Promise.all([fetchFile(repo, base, path), fetchFile(repo, head, path)]);
			if (beforeText === undefined || afterText === undefined) {
				return undefined;
			}

			return {...await diffFile({before: beforeText, after: afterText, path}), beforeText, afterText};
		})());
	}

	return fileDiffs.get(key)!;
}

/** The character offset in `line` of byte offset `column` */
function charOffset(line: string, column: number): number {
	return decoder.decode(encoder.encode(line).subarray(0, column)).length;
}

/** The ranges of a 0-based `row`, clipped to that row, as [operation, startChar, endChar] */
function rangesOnRow(ranges: RangeMatch[], row: number, line: string): Array<[Operation, number, number]> {
	const result: Array<[Operation, number, number]> = [];
	for (const range of ranges) {
		if (range.startRow > row || range.endRow < row) {
			continue;
		}

		const start = range.startRow === row ? charOffset(line, range.startColumn) : 0;
		const end = range.endRow === row ? charOffset(line, range.endColumn) : line.length;
		if (end > start) {
			result.push([range.operation, start, end]);
		}
	}

	return result;
}

/** A DOM range over characters `start`..`end` of `element`'s text, or undefined when the text is shorter */
function domRange(element: HTMLElement, start: number, end: number): Range | undefined {
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	const range = new Range();
	let offset = 0;
	let startFound = false;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const {length} = node.textContent!;
		if (!startFound && start <= offset + length) {
			range.setStart(node, start - offset);
			startFound = true;
		}

		if (startFound && end <= offset + length) {
			range.setEnd(node, end - offset);
			return range;
		}

		offset += length;
	}

	return undefined;
}

function lineNumberOf(code: HTMLElement): {side: Side; number: number} | undefined {
	// React view: the cell carries the line number; the type is on the `code` element
	const reactCell = code.closest('td.diff-text-cell[data-line-number]');
	if (reactCell) {
		const type = code.closest('code.diff-text')!;
		const number = Number(reactCell.getAttribute('data-line-number'));
		return number > 0 ? {side: type.classList.contains('deletion') ? 'before' : 'after', number} : undefined;
	}

	// Legacy view
	const cell = code.closest('.blob-code-deletion, .blob-code-addition')!;
	const side: Side = cell.classList.contains('blob-code-deletion') ? 'before' : 'after';
	const row = cell.closest('tr')!;
	const numbers = [...row.querySelectorAll('[data-line-number]')];
	const splitSide = cell.getAttribute('data-split-side');
	const numberCell = splitSide
		? numbers.find(element => element.getAttribute('data-split-side') === splitSide)
		: (side === 'before' ? numbers[0] : numbers.at(-1));
	const number = Number(numberCell?.getAttribute('data-line-number'));
	return number > 0 ? {side, number} : undefined;
}

async function filePathOf(repo: Repo, code: HTMLElement): Promise<string | undefined> {
	// Legacy view
	const legacy = code.closest('[data-tagsearch-path]');
	if (legacy) {
		return legacy.getAttribute('data-tagsearch-path')!;
	}

	// React view
	const anchor = code.closest('[data-line-anchor^="diff-"]')?.getAttribute('data-line-anchor');
	if (!anchor) {
		return undefined;
	}

	const paths = await getPathsByAnchor(repo);
	return paths.get(anchor.slice('diff-'.length, 'diff-'.length + 64));
}

async function paint(code: HTMLElement): Promise<void> {
	const repo = repoFromLocation();
	const line = lineNumberOf(code);
	if (!repo || !line) {
		return;
	}

	const path = await filePathOf(repo, code);
	if (!path) {
		return;
	}

	const versions = await getVersions(repo, path);
	if (!versions || !code.isConnected) {
		return;
	}

	const row = line.number - 1;
	const text = (line.side === 'before' ? versions.beforeText : versions.afterText).split('\n')[row];
	if (text === undefined || code.textContent!.replace(/\n$/, '') !== text) {
		return; // The cell shows something else than the fetched line; better unpainted than wrong
	}

	for (const [operation, start, end] of rangesOnRow(versions[line.side], row, text)) {
		const highlight = highlightFor(operation, line.side);
		const range = highlight && domRange(code, start, end);
		if (range) {
			highlight.add(range);
		}
	}

	code.classList.add('omnidiff-painted');
}

const codeSelector = [
	'code.diff-text.deletion .diff-text-inner', // React view, left side
	'code.diff-text.addition .diff-text-inner', // React view, right side
	':is(.blob-code-addition, .blob-code-deletion) .blob-code-inner', // Legacy view
].join(', ');

const seen = new WeakSet<Element>();

function scan(root: ParentNode): void {
	if (!repoFromLocation()) {
		return;
	}

	for (const code of root.querySelectorAll<HTMLElement>(codeSelector)) {
		if (!seen.has(code)) {
			seen.add(code);
			paint(code).catch((error: unknown) => {
				console.error(error);
			});
		}
	}
}

scan(document);
new MutationObserver(records => {
	for (const record of records) {
		for (const node of record.addedNodes) {
			if (node instanceof Element) {
				scan(node);
			}
		}
	}
}).observe(document.documentElement, {childList: true, subtree: true});
