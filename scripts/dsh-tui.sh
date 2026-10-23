#!/usr/bin/env bash
# Boot the terminal surface against this repository's own harness home.
#
# A second home, not a second DSH: the surfaces differ in which bundles they
# mount and keep separate sessions, but they run the same source and the same
# model providers.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The system node is 18; DSH requires ^22.19.
export PATH="$HOME/.local/share/node-v22/bin:$PATH"
export DSH_HOME="$ROOT/homes/tui"
export DSH_AGENTS_HOME="$ROOT/homes/tui/agents"

cd "$ROOT/dsh"
exec node_modules/.bin/tsx apps/cli/src/bin.ts --profile tui "$@"
