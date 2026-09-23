#!/usr/bin/env bash
# One contributor's step in the STELX Groth16 phase-2 ceremony. Run it on a trusted machine and do not keep the entropy you type.
# Usage: ./contribute.sh <in.zkey> <out.zkey> "<your name or handle>"
set -euo pipefail

IN="${1:?need input .zkey}"
OUT="${2:?need output .zkey}"
NAME="${3:?need a contributor name/handle}"

command -v snarkjs >/dev/null || { echo "snarkjs not found: npm i -g snarkjs"; exit 1; }
[ -f "$IN" ] || { echo "input $IN not found"; exit 1; }

echo "Contributing as: $NAME"
echo "When prompted, type a long line of random text (mash the keyboard)."
snarkjs zkey contribute "$IN" "$OUT" --name="$NAME" -v

echo
echo "Done. Verify your output before sending it on:"
echo "  snarkjs zkey verify build/transaction.r1cs ceremony/pot16_final.ptau $OUT"
echo
echo "Now send $OUT to the next contributor (or back to the organiser if you are last)."
echo "Delete any temporary copies. Do NOT keep the entropy you typed."
