# Everything from source to installable extension. Needs: node, rustup (target wasm32-wasip1),
# `pip install ziglang` (zig bundles wasi-libc), and zip. Safari additionally needs Xcode.

WASM = omnidiff-wasm/target/wasm32-wasip1/release/omnidiff_wasm.wasm

.PHONY: all fast fast-wasm fetch-wasm wasm build test zip safari clean

all: wasm build test zip

# Like `all`, but gets the engine with fast-wasm instead of always building it from source.
fast: fast-wasm build test zip

wasm: $(WASM)

$(WASM): omnidiff-wasm/Cargo.toml omnidiff-wasm/Cargo.lock omnidiff-wasm/src/*.rs omnidiff-wasm/.cargo/config.toml
	cd omnidiff-wasm && ./build.sh

# Downloads the engine CI built on main (needs `gh`, logged in) unless the engine sources differ
# from origin/main, so local changes are never replaced by an older CI build. Falls back to `wasm`
# if the download fails. Run `git fetch` first so origin/main is current.
WASM_SRC = omnidiff-wasm/Cargo.toml omnidiff-wasm/Cargo.lock omnidiff-wasm/src omnidiff-wasm/.cargo/config.toml
fast-wasm:
	if git diff --quiet origin/main -- $(WASM_SRC) && $(MAKE) fetch-wasm; then :; else $(MAKE) wasm; fi

fetch-wasm:
	rm -rf $(dir $(WASM))fetch && mkdir -p $(dir $(WASM))fetch
	gh run download -R daghoidahl/omnidiff-gh -n omnidiff-wasm -D $(dir $(WASM))fetch $$(gh run list -R daghoidahl/omnidiff-gh -b main -w build -s success -L 1 --json databaseId -q ".[0].databaseId")
	mv -f $(dir $(WASM))fetch/omnidiff_wasm.wasm $(WASM) && rmdir $(dir $(WASM))fetch

build: node_modules
	npm run build

node_modules: package.json package-lock.json
	npm ci
	touch node_modules

test: build
	npm test

zip: build
	npm run zip

# Converts dist/ into an Xcode project under safari/ (macOS only); open it and run it once to install.
safari: build
	xcrun safari-web-extension-converter dist --project-location safari --app-name "omnidiff for GitHub" --bundle-identifier no.medthings.omnidiff-gh --macos-only --no-open --force
	# The converter derives the app's identifier from the app name; the extension must be prefixed by it.
	sed -i '' 's/"no.medthings.omnidiff-for-GitHub"/"no.medthings.omnidiff-gh"/' "safari/omnidiff for GitHub/omnidiff for GitHub.xcodeproj/project.xcproj"

clean:
	rm -rf dist omnidiff-gh-chrome.zip omnidiff-wasm/target
