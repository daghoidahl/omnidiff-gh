# omnidiff for GitHub

A browser extension (Chrome, Safari) that paints a pull request's "Files changed" page the way
[omnidiff](https://github.com/ivankovic/omnidiff) would: only the parts of a line that actually
changed get color, and moved code is marked as moved. The engine is omnidiff itself, compiled to
WebAssembly. Works alongside Refined GitHub.

For each changed file the extension fetches both versions from github.com (merge base and head),
runs omnidiff on them, and paints the ranges with the CSS Custom Highlight API, so GitHub's own
DOM is left untouched. Files omnidiff has no grammar for (Markdown, SQL, unknown extensions) get
its line diff, which still splits changed lines into sub-line updates.

## Install

**Chrome:** download `omnidiff-gh-chrome.zip` from a release (or `make zip`), unpack it,
open `chrome://extensions`, turn on Developer mode, Load unpacked, pick the folder.

**Safari (macOS, needs Xcode):** `make fast-wasm safari` (or `make wasm safari`), open `safari/omnidiff for GitHub/omnidiff for GitHub.xcodeproj`, run
it once, then enable the extension in Safari's settings and allow it on github.com. Safari does
not keep unsigned extensions enabled across restarts unless "Allow unsigned extensions" is on in
the Develop menu.

Private repositories: put a personal access token (contents: read) in the extension's options.
It is only used for api.github.com; file contents come from github.com with the normal session.

## Build

```
make            # wasm engine + extension + engine check + Chrome zip
make fast       # the same, but downloads the engine CI built (needs gh) unless
                # the engine sources differ from origin/main
```

Needs node, a Rust toolchain with `rustup target add wasm32-wasip1`, `pip install ziglang` (zig
bundles wasi-libc, so no wasi-sdk download), and zip. The wasm build takes a few minutes the first
time; the result is 38 MB (3.6 MB gzipped), 23 grammars.

## Keeping up with upstream omnidiff

omnidiff does not accept contributions, and its wasm build needs a patch of two files (see
`omnidiff-wasm/omnidiff-wasm-support.patch`: `tree-sitter-vim` optional because its grammar needs
more than 14 GB of RAM to compile for wasm32, and no threads on wasm). So:

- The patch lives on the fork `daghoidahl/omnidiff` as one commit on top of an upstream tag, on a
  branch named after the tag (`wasm-v0.4.0`). A new release gets a new branch; nothing is rebased
  or force-pushed.
- `omnidiff-wasm/Cargo.toml` pins the revision of that commit.
- The `update-omnidiff` workflow runs every Monday (and on demand from the Actions tab): it finds
  upstream's newest tag, cherry-picks the patch onto it as `wasm-<tag>`, bumps the pin, builds and
  checks the engine, and opens a pull request here. It needs the repository secret `FORK_TOKEN`, a
  fine-grained token with Contents: read and write on the fork. If the patch no longer applies or
  the public API used in `omnidiff-wasm/src/lib.rs` moved, the run fails and says where.
- By hand, the same steps: on the fork `git checkout -b wasm-<tag> <tag> && git cherry-pick <pinned
  rev> && git push -u origin wasm-<tag>`, then bump `rev` in `Cargo.toml`, `cargo update -p omnidiff`,
  `make`, commit.
- The `build` workflow builds the engine from the pin on every push and every Monday, so an
  upstream change that breaks the build or the engine check is noticed without anyone asking.

## Limits

- Files over 300 KB, and files that are new or deleted, keep GitHub's own diff.
- Vimscript is not in the wasm build (see above).
- The engine runs in the background worker (Chrome refuses wasm in content scripts, and a large
  file would freeze the page for seconds); if that fails it runs in the page. The first diff after the worker wakes recompiles the 38 MB module.
- Verified on the React "Files changed" view; the legacy table view is supported by selectors
  copied from Refined GitHub but not verified.

## License

AGPL-3.0-only, because omnidiff is. See `LICENSE`.
