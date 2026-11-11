// GitHub's REST API, with the token from the options page when there is one (private repositories).

/**
 * A pull request's "Files changed" page. `range` is set when the URL shows part of the PR:
 * `/changes/<sha>` (one commit) or `/changes/<from>..<to>` (a commit range); otherwise the page
 * shows the whole PR, merge base to head.
 */
export type Repo = {owner: string; name: string; pr: number; range?: {from: string; to: string}};

export function repoFromLocation({pathname}: Location = location): Repo | undefined {
	const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/(?:([\da-f]{7,40})\.\.)?([\da-f]{7,40}))?(?:\/|$)/.exec(pathname);
	if (!match) {
		return undefined;
	}

	const [, owner, name, pr, from, to] = match;
	return {owner, name, pr: Number(pr), ...to && {range: {from: from ?? '', to}}};
}

async function token(): Promise<string | undefined> {
	const stored = await chrome.storage.local.get('token') as {token?: string};
	return stored.token || undefined;
}

export async function api<T>(path: string): Promise<{data: T; next: string | undefined}> {
	const url = path.startsWith('https://') ? path : `https://api.github.com/${path}`;
	const personalToken = await token();
	const response = await fetch(url, {
		headers: {
			accept: 'application/vnd.github+json',
			...personalToken && {authorization: `Bearer ${personalToken}`},
		},
	});
	if (!response.ok) {
		throw new Error(`omnidiff: GitHub API ${response.status} for ${url}`);
	}

	const next = /<([^<>]+)>; rel="next"/.exec(response.headers.get('link') ?? '')?.[1];
	return {data: await response.json() as T, next};
}

/** Every item of a paginated list endpoint */
export async function apiList<T>(path: string): Promise<T[]> {
	const items: T[] = [];
	for (let page: string | undefined = path; page; ) {
		const result: {data: T[]; next: string | undefined} = await api<T[]>(page);
		items.push(...result.data);
		page = result.next;
	}

	return items;
}
