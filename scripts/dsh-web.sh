#!/usr/bin/env bash
# Boot the web surface against this repository's own harness home.
#
# Each surface gets its own home: they mount different bundle sets and keep
# separate session histories. Both read this machine's model providers through
# homes/shared, which the home-level patch layer applies over every profile.
#
# DSH_HOME is bootstrap-only — app-boot refuses a DSH_* name from any discovered
# .env — so this script is the one place that sets it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The system node is 18; DSH requires ^22.19.
export PATH="$HOME/.local/share/node-v22/bin:$PATH"
export DSH_HOME="$ROOT/homes/web"
export DSH_AGENTS_HOME="$ROOT/homes/web/agents"

cd "$ROOT/dsh"
exec node_modules/.bin/tsx apps/cli/src/bin.ts --profile web "$@"
