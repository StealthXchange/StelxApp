#!/usr/bin/env bash
# Checks the chain facts the pool relies on; run before any deployment.
# Usage: script/verify-chain.sh [rpc-url]
set -euo pipefail
RPC="${1:-https://rpc.testnet.chain.robinhood.com}"

call() { curl -s --max-time 15 -X POST -H "Content-Type: application/json" --data "$1" "$RPC"; }

echo "RPC: $RPC"
echo -n "chainId:            "; call '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
echo -n "eth_blockNumber:    "; call '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
echo -n "arbBlockNumber():   "; call '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0000000000000000000000000000000000000064","data":"0xa3b1b31d"},"latest"],"id":1}'
echo
echo "NOTE: the two block numbers differ on Nitro. The contract reads no block"
echo "number at all; client scanning uses the L2 block numbers on logs."
