#!/usr/bin/env bash
# Organiser: applies the public beacon to the last contribution, then exports the final key, verification key and verifier.
# Usage: ./organiser-finish.sh <last-contribution.zkey> <block-hash> <block-height>
set -euo pipefail
cd "$(dirname "$0")/.."

LAST="${1:?need the last contribution zkey}"
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

command -v snarkjs >/dev/null || { echo "snarkjs not found"; exit 1; }

echo "Beacon: block ${HEIGHT}, hash ${BEACON}"
echo "Applying final beacon..."
snarkjs zkey beacon "$LAST" ceremony/transaction_final.zkey "$BEACON" 10 -n="final beacon"

echo "Exporting verification key..."
snarkjs zkey export verificationkey ceremony/transaction_final.zkey ceremony/verification_key.json

echo "Generating Solidity verifier..."
snarkjs zkey export solidityverifier ceremony/transaction_final.zkey ceremony/TransactionVerifier.sol

echo "Verifying the final key against the circuit..."
snarkjs zkey verify build/transaction.r1cs ceremony/pot16_final.ptau ceremony/transaction_final.zkey

echo
echo "Beacon provenance (publish this alongside the transcript):"
echo "  block height : ${HEIGHT}"
echo "  block hash   : ${BEACON}"
echo "  iterations   : 10"
echo
echo "Transcript (publish this):"
snarkjs zkey export bellman ceremony/transaction_final.zkey /dev/null 2>/dev/null || true
snarkjs zkey contributions ceremony/transaction_final.zkey || true
echo
echo "Outputs:"
echo "  ceremony/transaction_final.zkey       -> proving key (replaces build/)"
echo "  ceremony/verification_key.json        -> for the client"
echo "  ceremony/TransactionVerifier.sol      -> replaces contracts/TransactionVerifier.sol"
echo
echo "IMPORTANT: regenerating the verifier means re-running the full test suite"
echo "before any deploy. See ceremony/README.md."
