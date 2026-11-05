# Everything from source to installable extension. Needs: node, rustup (target wasm32-wasip1),
# `pip install ziglang` (zig bundles wasi-libc), and zip. Safari additionally needs Xcode.

WASM = omnidiff-wasm/target/wasm32-wasip1/release/omnidiff_wasm.wasm

.PHONY: all fetch-wasm wasm build test zip safari clean

all: wasm build test zip

wasm: $(WASM)

# Skips the Rust build: downloads the engine CI built on main (needs `gh`, logged in).
fetch-wasm:
	mkdir -p $(dir $(WASM))
	gh run download -R daghoidahl/omnidiff-gh -n omnidiff-wasm -D $(dir $(WASM)) $$(gh run list -R daghoidahl/omnidiff-gh -b main -w build -s success -L 1 --json databaseId -q ".[0].databaseId")

$(WASM): omnidiff-wasm/Cargo.toml omnidiff-wasm/Cargo.lock omnidiff-wasm/src/*.rs omnidiff-wasm/.cargo/config.toml
	cd omnidiff-wasm && ./build.sh

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

clean:
	rm -rf dist omnidiff-gh-chrome.zip omnidiff-wasm/target
