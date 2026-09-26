import { createWalletClient, encodeFunctionData, formatEther, parseAbi, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { darkLandingKey } from "./darkKeys.ts";
import { maxFeeFor, NATIVE, tipFor, type DarkRoute } from "./darkRoutes.ts";
import { railgunWallet } from "./railgunKeys.ts";
import { buildShieldRequest, recognisesShield, shieldBaseTokenTx, shieldEvents, shieldPrivateKey, shieldTokenTx, type ShieldRequest } from "./railgunShield.ts";

const ERC20 = parseAbi([
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface DestChain {
  route: DarkRoute;
  client: PublicClient;
  transport: Transport;
  chain: Chain;
}

export const landingAddressOf = (phrase: string, index: number): Address => privateKeyToAccount(darkLandingKey(phrase, index)).address;

export interface LandingState {
  address: Address;

  eth: bigint;

  token: bigint;

  allowance: bigint;
  nonce: number;
}

export async function readLandingState(d: DestChain, address: Address): Promise<LandingState> {
  const c = d.client;
  const isToken = d.route.relayCurrency !== NATIVE;
  const [eth, nonce, token, allowance] = await Promise.all([
    c.getBalance({ address }),
    c.getTransactionCount({ address }),
    isToken ? c.readContract({ address: d.route.relayCurrency, abi: ERC20, functionName: "balanceOf", args: [address] }) : 0n,
    isToken ? c.readContract({ address: d.route.relayCurrency, abi: ERC20, functionName: "allowance", args: [address, d.route.railgunProxy] }) : 0n,
  ]);
  return { address, eth, token, allowance, nonce };
}

export const minShield = (route: DarkRoute) => (route.relayCurrency === NATIVE ? 2n * 10n ** 15n : 10n ** BigInt(route.decimals));

export const hasDelivery = (route: DarkRoute, l: LandingState) =>
  route.relayCurrency === NATIVE ? l.eth >= minShield(route) : l.token >= minShield(route);

export const usedLanding = (l: LandingState) => l.nonce > 0 || l.eth > 0n || l.token > 0n;

export async function feesNow(d: DestChain): Promise<{ baseFee: bigint; tip: bigint; maxFee: bigint }> {
  const block = await d.client.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? (await d.client.getGasPrice());
  let tip = 0n;
  if (d.route.chainId !== 42161) {
    tip = tipFor(await d.client.estimateMaxPriorityFeePerGas().catch(() => 0n));
  }
  return { baseFee, tip, maxFee: maxFeeFor(baseFee, tip) };
}

export type ShieldStep = "approve" | "shield" | "check";

export class ShieldWait extends Error {
  need: bigint;
  have: bigint;
  constructor(message: string, need: bigint, have: bigint) { super(message); this.name = "ShieldWait"; this.need = need; this.have = have; }
}

export interface ShieldResult {
  hash: Hex;

  value: bigint;

  noteValue: bigint;
  fee: bigint;

  gasPaid: bigint;

  recognised: boolean;

  tree: bigint;
  position: bigint;
}

export async function shieldLanding(
  phrase: string, index: number, d: DestChain,
  opts: { onStep?: (s: ShieldStep) => void; maxGasShare?: number } = {},
): Promise<ShieldResult | null> {
  const { route, client } = d;
  const account = privateKeyToAccount(darkLandingKey(phrase, index));
  const wallet = createWalletClient({ account, chain: d.chain, transport: d.transport });
  const to = await railgunWallet(phrase);
  const shieldKey = await shieldPrivateKey(account);
  const isEth = route.relayCurrency === NATIVE;

  let l = await readLandingState(d, account.address);
  if (!hasDelivery(route, l)) return null;
  const { baseFee, tip, maxFee } = await feesNow(d);
  const fee = { maxFeePerGas: maxFee, maxPriorityFeePerGas: tip };
  let gasPaid = 0n;

  const wait = async (hash: Hex) => {
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`A transaction from the landing address reverted (${hash}). Nothing more was sent.`);
    gasPaid += r.gasUsed * r.effectiveGasPrice;
    return r;
  };

  let req: ShieldRequest;
  let tx: { to: Address; data: Hex; value: bigint };
  let value: bigint;
  let gas: bigint;
  if (isEth) {

    const reserve = route.gasUnits * maxFee;
    if (l.eth - reserve < minShield(route)) throw new ShieldWait(`Gas on ${route.chainName} is high right now: the shield needs ${formatEther(reserve)} ETH and the landing address holds ${formatEther(l.eth)}. The ETH waits there.`, reserve, l.eth);
    const probe = shieldBaseTokenTx(route.relayAdapt, await buildShieldRequest(to, route.noteToken, l.eth - reserve, shieldKey));

    gas = ((await client.estimateGas({ account: account.address, ...probe })) * 105n) / 100n;
    value = l.eth - gas * maxFee;
    if (value < minShield(route)) throw new ShieldWait(`Gas on ${route.chainName} is high right now; the ETH waits on the landing address.`, gas * maxFee, l.eth);
    const share = opts.maxGasShare ?? 1;
    if (Number(gas * (baseFee + tip)) > share * Number(value)) {
      throw new ShieldWait(`The shield would cost ${formatEther(gas * (baseFee + tip))} ETH in gas at ${Number(baseFee) / 1e9} gwei, more than ${Math.round(share * 100)}% of what goes in.`, gas * maxFee, l.eth);
    }
    req = await buildShieldRequest(to, route.noteToken, value, shieldKey);
    tx = shieldBaseTokenTx(route.relayAdapt, req);
  } else {
    value = l.token;
    if (l.allowance < value) {
      const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [route.railgunProxy, value] });
      const approveGas = ((await client.estimateGas({ account: account.address, to: route.relayCurrency, data })) * 12n) / 10n;
      if (l.eth < approveGas * maxFee) throw new ShieldWait(`The landing address needs ${formatEther(approveGas * maxFee)} ETH of gas on ${route.chainName} to approve, and holds ${formatEther(l.eth)}. Relay's top-up may still be on its way.`, approveGas * maxFee, l.eth);
      opts.onStep?.("approve");
      await wait(await wallet.sendTransaction({ to: route.relayCurrency, data, gas: approveGas, ...fee }));
      l = await readLandingState(d, account.address);
    }
    req = await buildShieldRequest(to, route.noteToken, value, shieldKey);
    tx = shieldTokenTx(route.railgunProxy, req);
    gas = ((await client.estimateGas({ account: account.address, ...tx })) * 11n) / 10n;
    if (l.eth < gas * maxFee) throw new ShieldWait(`The shield needs ${formatEther(gas * maxFee)} ETH of gas on ${route.chainName}; the landing address holds ${formatEther(l.eth)}. Your ${route.symbol} waits there until gas is lower.`, gas * maxFee, l.eth);
  }

  opts.onStep?.("shield");
  const hash = await wallet.sendTransaction({ ...tx, gas, ...fee });
  const receipt = await wait(hash);

  opts.onStep?.("check");
  const npk = BigInt(req.preimage.npk);
  for (const ev of shieldEvents(receipt.logs, route.railgunProxy)) {
    for (let i = 0; i < ev.commitments.length; i++) {
      const c = ev.commitments[i];
      if (BigInt(c.npk) !== npk) continue;
      return {
        hash, value, noteValue: c.value, fee: ev.fees[i] ?? 0n, gasPaid,
        recognised: await recognisesShield(to, c, ev.ciphertexts[i]),
        tree: ev.treeNumber, position: ev.startPosition + BigInt(i),
      };
    }
  }
  throw new Error(`The shield ${hash} went through but its note isn't in the receipt. Check it on ${route.chainName} before trying again.`);
}
