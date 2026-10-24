#!/usr/bin/env bash
# Restart the dsh web surface: stop, start, print the tokenized URL.
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPTS/dsh-web-stop.sh"
sleep 3
exec bash "$SCRIPTS/dsh-web-start.sh"
