#!/usr/bin/env bash
# Organiser: creates the base .zkey (contribution 0) from build/transaction.r1cs and the phase-1 ptau. Run once, at the start.
# Usage: ./ceremony/organiser-start.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f ceremony/pot16_final.ptau ] || cp ptau/pot16_final.ptau ceremony/pot16_final.ptau
command -v snarkjs >/dev/null || { echo "snarkjs not found: npm i -g snarkjs"; exit 1; }

echo "Creating contribution 0 (the base key, no randomness yet)..."
snarkjs groth16 setup build/transaction.r1cs ceremony/pot16_final.ptau ceremony/contrib-00.zkey

echo
echo "Base key: ceremony/contrib-00.zkey"
echo "Send this to contributor 1, who runs ceremony/contribute.sh."
echo "Collect each contributor's output in order: contrib-01.zkey, contrib-02.zkey, ..."
