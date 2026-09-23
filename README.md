# STELX

Private balances and payments on Robinhood Chain.

Mainnet pool: `0x7005aA5deaF8433d72fdc6B56a7ccC225F51FB5C`

## Build

    git clone --recursive <this repo>
    npm ci
    forge build
    npm test

## Verify

    ./ceremony/verify.sh
    node scripts/verify-live.mjs

`verify.sh` needs `pot16_final.ptau` from the release page in `ptau/ceremony-round1/`.

## Limits

- Deposits and withdrawals are public.
- Robinhood can freeze, pause or burn its stock tokens.
- The relay sees your IP unless you use Tor or a VPN.

## License

MIT
