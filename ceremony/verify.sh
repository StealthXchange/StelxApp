#!/usr/bin/env bash
# Verifies the proving key against the round-one powers of tau, and that the
# repo's verifier and verification key come from it. Exits non-zero on any mismatch.
# Usage: ./ceremony/verify.sh   (needs ptau/ceremony-round1/pot16_final.ptau from the release page)
set -euo pipefail
cd "$(dirname "$0")/.."

R1CS=build/transaction.r1cs
PTAU=ptau/ceremony-round1/pot16_final.ptau
ZKEY=${ZKEY:-ceremony/round2/transaction_final.zkey}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL  $*"; exit 1; }
check() {
  local got; got=$(sha256sum "$1" | cut -d' ' -f1)
  [ "$got" = "$2" ] || fail "$1 is $got, expected $2"
  echo "ok    $1  $got"
}

[ -f "$PTAU" ] || fail "$PTAU is missing: download pot16_final.ptau from the release page"
check "$R1CS" 3e433c8ade7905cd726cf2998a31474d301936cde3c0b5f33a136b7670af9db3
check "$PTAU" 280aadc6b034e9e0e24b2350a2355ac240141be88eda8d19d5a421e8b189488d
check "$ZKEY" 53212a1c772160234dacca372d9e0bf158fc2ffb529aa61297deead1ccc96cc5

rc=0
out=$(npx snarkjs zkey verify "$R1CS" "$PTAU" "$ZKEY" 2>&1) || rc=$?
out=$(printf '%s\n' "$out" | sed -E 's/\x1b\[[0-9;]*m//g')
printf '%s\n' "$out" | grep -aE 'contribution #|ZKey' | sed -E 's/^\[INFO\][[:space:]]+snarkJS: //' || true
[ "$rc" -eq 0 ] || fail "snarkjs exited with status $rc"
printf '%s\n' "$out" | grep -aq 'ZKey Ok!' || fail "snarkjs did not accept the key"
echo "ok    snarkjs zkey verify"

npx snarkjs zkey export verificationkey "$ZKEY" "$TMP/vk.json" > /dev/null
npx snarkjs zkey export solidityverifier "$ZKEY" "$TMP/Verifier.sol" > /dev/null
cmp -s "$TMP/vk.json" build/verification_key.json || fail "build/verification_key.json does not match the key"
echo "ok    build/verification_key.json matches the key"
cmp -s "$TMP/Verifier.sol" contracts/TransactionVerifier.sol || fail "contracts/TransactionVerifier.sol does not match the key"
echo "ok    contracts/TransactionVerifier.sol matches the key"

echo "PASS"
