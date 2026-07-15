#!/usr/bin/env bash
# Builds the Go conversion core to dist/converter.wasm and refreshes the
# wasm_exec.js runtime shim from the local Go toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p dist
(cd go && GOOS=js GOARCH=wasm go build -trimpath -ldflags='-s -w' -o ../dist/converter.wasm .)

SHIM="$(go env GOROOT)/lib/wasm/wasm_exec.js"
[ -f "$SHIM" ] || SHIM="$(go env GOROOT)/misc/wasm/wasm_exec.js"   # Go < 1.24
cp "$SHIM" wasm_exec.js

echo "built dist/converter.wasm ($(du -h dist/converter.wasm | cut -f1)) with $(go version | cut -d' ' -f3)"
