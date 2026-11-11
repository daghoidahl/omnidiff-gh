// The URL forms the content script must tell apart.
import assert from 'node:assert/strict';
import {repoFromLocation} from '../dist/github-test.js';

const at = pathname => repoFromLocation({pathname});
assert.deepEqual(at('/o/r/pull/136/files'), {owner: 'o', name: 'r', pr: 136});
assert.deepEqual(at('/o/r/pull/136/changes'), {owner: 'o', name: 'r', pr: 136});
assert.deepEqual(at('/o/r/pull/136/changes/6459d13edf552571953adf390c52595f5d1fc289'), {owner: 'o', name: 'r', pr: 136, range: {from: '', to: '6459d13edf552571953adf390c52595f5d1fc289'}});
assert.deepEqual(at('/o/r/pull/136/files/abc1234..def5678'), {owner: 'o', name: 'r', pr: 136, range: {from: 'abc1234', to: 'def5678'}});
assert.equal(at('/o/r/pull/136'), undefined);
assert.equal(at('/o/r/pull/136/commits/abc1234'), undefined);
console.log('urls ok');
