# stelx.app

The STELX website and wallet. It uses the wallet library and proving files from
the rest of this repo.

## Build

Node 24+. Build the repo first, then the site:

    npm ci && forge build
    cd web
    npm ci
    POOL_REPO=.. npm run build

Mainnet settings:

    NEXT_PUBLIC_POOL_CHAIN_ID=4663
    NEXT_PUBLIC_POOL_ADDRESS=0x7005aA5deaF8433d72fdc6B56a7ccC225F51FB5C
    NEXT_PUBLIC_POOL_DEPLOY_BLOCK=70603816
    NEXT_PUBLIC_POOL_RPC=https://rpc.mainnet.chain.robinhood.com
    NEXT_PUBLIC_POOL_TOKEN=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
    NEXT_PUBLIC_POOL_BROADCASTERS=https://relay.stelx.app

`public/pool/manifest.json` on stelx.app lists the wallet files and proving key
the live site was built from; `node scripts/verify-live.mjs` at the repo root checks it.
