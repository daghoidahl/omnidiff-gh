#!/bin/sh
# zig as C compiler for wasm32-wasip1. Dropped: -g, and -O* for tree-sitter-vim (its 4.5 MB
# parser.c needs >14 GB RAM with either), and cc-rs's --target=wasm32-wasip1 (zig: wasm32-wasi).
# Any python3 with `pip install ziglang`; the vim case is kept for a build that re-enables the grammar.
vim=0; case "$PWD" in *tree-sitter-vim*) vim=1;; esac
args=""
for a in "$@"; do
  case "$a" in
    -g|--target=*) ;;
    -O*) [ $vim = 1 ] || args="$args \"$a\"";;
    *) args="$args \"$a\"";;
  esac
done
eval exec python3 -m ziglang cc -target wasm32-wasi $args
