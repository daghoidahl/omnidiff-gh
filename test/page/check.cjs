// Does the content script paint GitHub's current diff markup? Serves a PR commit view built from one
// row in GitHub's markup of November 2026 (row.html; refresh its structure from the page when GitHub
// changes it) for docs/guide.md (before.md -> after.md), answering the API locally.
// Needs Playwright with Chromium: `npm run build && node test/page/check.cjs`.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const dist = path.resolve(__dirname, '../../dist');
const file = 'docs/guide.md';
const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const json = body => ({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(body)});

(async () => {
	const context = await chromium.launchPersistentContext('', {
		headless: true,
		channel: 'chromium', // The headless shell cannot load extensions
		args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
	});
	await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker'));
	await context.route('https://api.github.com/**', route => {
		const url = route.request().url();
		if (url.includes(`/commits/${head}`)) {
			return route.fulfill(json({sha: head, parents: [{sha: base}]}));
		}

		return url.includes('/files') ? route.fulfill(json([{filename: file}])) : route.fulfill({status: 404, body: '{}'});
	});
	await context.route('https://github.com/**', route => {
		const url = route.request().url();
		if (url.includes('/raw/')) {
			return route.fulfill({status: 200, contentType: 'text/plain', body: read(url.includes(base) ? 'before.md' : 'after.md')});
		}

		return route.fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><table><tbody>${read('row.html')}</tbody></table>`});
	});
	const page = await context.newPage();
	await page.goto(`https://github.com/owner/repo/pull/1/changes/${head}`);
	await page.waitForTimeout(5000);
	const sides = await page.evaluate(() => [...document.querySelectorAll('.omnidiff-painted')].map(element => element.closest('td').dataset.diffSide));
	await context.close();
	if (sides.join() !== 'left,right') {
		throw new Error(`expected both sides of the row painted, got [${sides}]`);
	}

	console.log('page ok');
})().catch(error => {
	console.error(error);
	process.exit(1);
});
