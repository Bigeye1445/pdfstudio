#!/usr/bin/env bash
# Compiles qpdf to WebAssembly (ES module + .wasm) into src/wasm/.
# Requires: emscripten (emcc/emcmake/embuilder), cmake, and qpdf sources
# extracted at vendor/qpdf-<version>.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QPDF_VERSION="12.3.2"
BUILD_DIR="$ROOT/build-wasm"
OUT_DIR="$ROOT/src/wasm"

command -v emcc >/dev/null || { echo "emcc not found — install emscripten"; exit 1; }

QPDF_SRC="$ROOT/vendor/qpdf-$QPDF_VERSION"
if [ ! -d "$QPDF_SRC" ]; then
  echo "==> Downloading qpdf $QPDF_VERSION sources"
  mkdir -p "$ROOT/vendor"
  curl -sL "https://github.com/qpdf/qpdf/releases/download/v$QPDF_VERSION/qpdf-$QPDF_VERSION.tar.gz" \
    | tar xz -C "$ROOT/vendor"
fi

echo "==> Using qpdf sources: $QPDF_SRC"
echo "==> emcc: $(emcc --version | head -1)"

# Pre-build the zlib and libjpeg ports so their headers/libs exist in the
# emscripten sysroot cache before CMake goes looking for them.
embuilder build zlib libjpeg

SYSROOT="$(em-config CACHE)/sysroot"
LIBDIR="$SYSROOT/lib/wasm32-emscripten"
[ -f "$LIBDIR/libz.a" ] || { echo "libz.a missing from $LIBDIR"; ls "$LIBDIR"; exit 1; }
[ -f "$LIBDIR/libjpeg.a" ] || { echo "libjpeg.a missing from $LIBDIR"; ls "$LIBDIR"; exit 1; }

# wasm-native exception handling: qpdf relies on C++ exceptions for all error
# reporting, so this must be on for compile AND link of every object.
COMMON_FLAGS="-fwasm-exceptions -O3"

LINK_FLAGS="-fwasm-exceptions -O3"
LINK_FLAGS+=" -sMODULARIZE=1"
LINK_FLAGS+=" -sEXPORT_ES6=1"
LINK_FLAGS+=" -sEXPORT_NAME=createQpdfModule"
LINK_FLAGS+=" -sENVIRONMENT=web,worker,node"
LINK_FLAGS+=" -sALLOW_MEMORY_GROWTH=1"
LINK_FLAGS+=" -sSTACK_SIZE=2097152"
LINK_FLAGS+=" -sINVOKE_RUN=0"
LINK_FLAGS+=" -sEXIT_RUNTIME=0"
LINK_FLAGS+=" -sEXPORTED_RUNTIME_METHODS=FS,callMain"

emcmake cmake -S "$QPDF_SRC" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_STATIC_LIBS=ON \
  -DBUILD_DOC=OFF \
  -DINSTALL_EXAMPLES=OFF \
  -DUSE_IMPLICIT_CRYPTO=OFF \
  -DREQUIRE_CRYPTO_NATIVE=ON \
  -DPKG_CONFIG_EXECUTABLE=/usr/bin/false \
  -DZLIB_H_PATH="$SYSROOT/include" \
  -DZLIB_LIB_PATH="$LIBDIR/libz.a" \
  -DLIBJPEG_H_PATH="$SYSROOT/include" \
  -DLIBJPEG_LIB_PATH="$LIBDIR/libjpeg.a" \
  -DCMAKE_C_FLAGS="$COMMON_FLAGS" \
  -DCMAKE_CXX_FLAGS="$COMMON_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$LINK_FLAGS"

cmake --build "$BUILD_DIR" --target qpdf -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

mkdir -p "$OUT_DIR"
cp "$BUILD_DIR/qpdf/qpdf.js" "$BUILD_DIR/qpdf/qpdf.wasm" "$OUT_DIR/"
ls -lh "$OUT_DIR"
echo "==> Done: src/wasm/qpdf.js + qpdf.wasm"
