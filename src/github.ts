// GitHub's REST API, with the token from the options page when there is one (private repositories).

export type Repo = {owner: string; name: string; pr: number};

/** The repository and pull request of a "Files changed" URL, or undefined elsewhere */
export function repoFromLocation({pathname}: Location = location): Repo | undefined {
	const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/|$)/.exec(pathname);
	return match ? {owner: match[1], name: match[2], pr: Number(match[3])} : undefined;
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
