#!/usr/bin/env bash
# Organiser: closes phase one by applying the public beacon, running prepare phase2 and verifying the result.
# Usage: ./organiser-finish-phase1.sh <last-contribution.ptau> <block-hash> <block-height>
set -euo pipefail
cd "$(dirname "$0")/.."

LAST="${1:?need the last contribution ptau}"
BEACON="${2:?need the beacon block hash (0x-less hex, 64 chars)}"
HEIGHT="${3:?need the block height the beacon came from}"
BEACON="${BEACON#0x}"

if [[ ! "$BEACON" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "beacon must be 64 hex characters; got '${BEACON}'" >&2; exit 1
fi
if [[ "$BEACON" =~ ^0+$ ]]; then
  echo "beacon is all zeros: that is a placeholder, not a beacon" >&2; exit 1
fi
LOWER=$(printf '%s' "$BEACON" | tr 'A-F' 'a-f')
case "$LOWER" in
  0102030405060708090a0b0c0d0e0f*)
    echo "that is the snarkjs tutorial beacon; use a real block hash" >&2; exit 1 ;;
esac
if [[ ! "$HEIGHT" =~ ^[0-9]+$ ]]; then
  echo "block height must be a number; got '${HEIGHT}'" >&2; exit 1
fi

[ -f "$LAST" ] || { echo "no such file: $LAST" >&2; exit 1; }
command -v snarkjs >/dev/null || { echo "snarkjs not found"; exit 1; }

mkdir -p ceremony

echo "Beacon: block ${HEIGHT}, hash ${BEACON}"
echo
echo "Applying the final beacon to phase one..."
snarkjs powersoftau beacon "$LAST" ceremony/pot16_beacon.ptau "$BEACON" 10 -n="final beacon"

echo
echo "Preparing for phase two (this takes a few minutes)..."
snarkjs powersoftau prepare phase2 ceremony/pot16_beacon.ptau ceremony/pot16_final.ptau

echo
echo "Verifying the finished transcript..."
snarkjs powersoftau verify ceremony/pot16_final.ptau

echo
echo "Beacon provenance (publish this alongside the transcript):"
echo "  block height : ${HEIGHT}"
echo "  block hash   : ${BEACON}"
echo "  iterations   : 10"
echo
echo "Contributions (publish this):"
snarkjs powersoftau verify ceremony/pot16_final.ptau 2>&1 | grep -iE "contribution|hash" || true
echo
echo "Outputs:"
echo "  ceremony/pot16_beacon.ptau  -> beaconed transcript, keep for the record"
echo "  ceremony/pot16_final.ptau   -> the phase-one output phase two consumes"
echo
echo "NEXT: phase two runs against this file. Copy pot16_final.ptau to the"
echo "coordinator, set PHASE=phase2, and run the circuit setup. See"
echo "ceremony/README.md and MAINNET-CHECKLIST.md."
