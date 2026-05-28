#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec node "$SCRIPT_DIR/verify-install.mjs" "$@"
