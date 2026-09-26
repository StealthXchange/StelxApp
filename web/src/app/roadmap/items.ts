export type Status = "live" | "building" | "next" | "later";
export type Dev = "Rome" | "Kaka" | "Eddy";

export interface Item {
  id: string;
  cat: CategoryId;
  title: string;
  line: string;
  status: Status;
  dev: Dev;

  milestones: [string, boolean][];

  notes?: Note[];
}

export interface Note {
  date: string;
  by: Dev;
  text: string;
}

export type CategoryId = "privacy" | "payments" | "offramp" | "protocol" | "token";

export const CATEGORIES: { id: CategoryId; name: string; line: string }[] = [
  { id: "privacy", name: "Privacy", line: "Safer, more private, easier to check." },
  { id: "payments", name: "Payments", line: "Moving money, and bringing people in." },
  { id: "offramp", name: "Off-ramp", line: "From your private balance to money you can spend." },
  { id: "protocol", name: "Protocol", line: "The engine, and the big bets." },
  { id: "token", name: "STELX token", line: "What STELX is for. Privacy itself is never charged in STELX." },
];

export const DEVS: Dev[] = ["Rome", "Kaka", "Eddy"];

export const STATUS_LABEL: Record<Status, string> = {
  live: "Live",
  building: "Building",
  next: "Next",
  later: "Later",
};

export const ITEMS: Item[] = [

  {
    id: "relay-domain", cat: "privacy", status: "live", dev: "Rome",
    title: "Relay on our own domain", line: "Sends go through relay.stelx.app.",
    milestones: [["Certificate and server", true], ["No logs, same limits", true], ["Site switched over", true]],
    notes: [{date: "24 Sep",by: "Rome",text: "old relay domain got suspended by the registrar, never clicked their verify email. sends were down for a bit. moved it to relay.stelx.app, same box, no logs, same limits. kept the old one as a backup if it ever comes back"}],
  },
  {
    id: "tor", cat: "privacy", status: "building", dev: "Eddy",
    title: "Tor .onion relay", line: "Send through Tor, so the relay never sees your IP.",
    milestones: [["Onion service on the relay server", false], ["Site detects Tor Browser", false], ["Sends use the .onion relay", false], ["Privacy Center explains it", false], ["Live", false]],
  },
  {
    id: "passkey", cat: "privacy", status: "building", dev: "Rome",
    title: "Passkey lock", line: "Unlock your wallet with Face ID or a fingerprint.",
    milestones: [["Design", false], ["Phrase encrypted by passkey", false], ["Unlock flow", false], ["Fallback to your phrase", false], ["Live", false]],
  },
  {
    id: "scanner", cat: "privacy", status: "building", dev: "Rome",
    title: "Wallet warning cleared", line: "Get the pool off security scanners' flag lists.",
    milestones: [["Pool verified on Blockscout", true], ["Verifier verified on Blockscout", true], ["Review requested", false], ["Public name tag", false], ["Flag cleared", false]],
    notes: [{date: "23 Sep",by: "Rome",text: "kraken wallet showing the pool as malicious. new privacy contracts get auto flagged. verified pool + verifier on blockscout, exact match. next: false positive report and a name tag"}],
  },
  {
    id: "roadmap", cat: "privacy", status: "live", dev: "Rome",
    title: "This roadmap", line: "Live progress, team notes and your ideas, in the open.",
    milestones: [["Page and real progress bars", true], ["Team sign-in, notes and chat", true], ["Community ideas", true], ["Live on stelx.app", true]],
    notes: [{ date: "24 Sep", by: "Rome", text: "live on stelx.app/roadmap. we can log in, tick steps, post notes and chat. community ideas open, they show once one of us approves" }, { date: "24 Sep", by: "Rome", text: "first cut up on a preview. light version, the dark one was hard to read. adding team logins so we can post notes ourselves + community ideas" }],
  },
  {
    id: "open-site", cat: "privacy", status: "next", dev: "Eddy",
    title: "Open-source website", line: "The site's code public, with a build anyone can check.",
    milestones: [["Wallet files committed with a hash check", false], ["Reproducible build", false], ["Published", false]],
  },
  {
    id: "bounty", cat: "privacy", status: "next", dev: "Kaka",
    title: "Bug bounty", line: "Paid rewards for finding bugs.",
    milestones: [["Scope and rewards", false], ["Published", false]],
  },
  {
    id: "clean-funds", cat: "privacy", status: "later", dev: "Eddy",
    title: "Proof of clean funds", line: "Show your deposit is clean without revealing which is yours.",
    milestones: [["Design", false], ["Circuit", false], ["Audit", false], ["Live", false]],
  },

  {
    id: "legacy", cat: "privacy", status: "later", dev: "Rome",
    title: "Legacy switch", line: "If you stop checking in, your private balance goes to the people you chose. Until then, nobody knows.",
    milestones: [["Design", false], ["Time-locked keys", false], ["Check-in and rollover", false], ["Heir claim", false], ["Review", false], ["Live", false]],
    notes: [{ date: "24 Sep", by: "Rome", text: "a separate legacy account, its key sealed to a date with time-lock encryption. each check-in moves it to a fresh one sealed further out. stop checking in and your heirs open it with their link. no contract change" }],
  },

  {
    id: "stocks", cat: "payments", status: "live", dev: "Rome",
    title: "Stocks in the pool", line: "195 stock tokens, held and sent privately.",
    milestones: [["Pool accepts 195 stocks", true], ["Deposit, send and withdraw any asset", true], ["Real shares after splits", true], ["Live", true]],
    notes: [{date: "24 Sep",by: "Rome",text: "first real stock deposit this morning (TSLA), in and back out fine"},{date: "23 Sep",by: "Rome",text: "stocks live on the site. ran it all on a mainnet fork first: AAPL in, private send, withdraw, all good. CRWD shows proper shares after its 4:1 split"}],
  },
  {
    id: "gift", cat: "payments", status: "building", dev: "Kaka",
    title: "Gift links", line: "Send a stock to anyone with a link.",
    milestones: [["Design", true], ["Create a link", true], ["Claim into any wallet", true], ["Take back unclaimed gifts", true], ["Live", false]],
  },
  {
    id: "pay-links", cat: "payments", status: "building", dev: "Kaka",
    title: "Payment links and QR", line: "A link or code that fills in the send for you.",
    milestones: [["Link format", false], ["Send fills itself in", false], ["QR on Receive", false], ["Live", false]],
  },
  {
    id: "portfolio", cat: "payments", status: "building", dev: "Eddy",
    title: "Portfolio in dollars", line: "Your holdings and total in USD.",
    milestones: [["Prices without sending your address", false], ["Holdings in USD", false], ["Total", false], ["Live", false]],
  },
  {
    id: "handles", cat: "payments", status: "next", dev: "Rome",
    title: "Pay @handle on X", line: "Send to an X handle, privately.",
    milestones: [["Design", true], ["Handle accounts", false], ["Signed handle list", false], ["Audit", false], ["Live", false]],
    notes: [{date: "23 Sep",by: "Rome",text: "design done. main rule: your @handle can never be used to see what you get paid. separate handle account that never takes deposits, you download the whole list so nobody sees who you look up, 72h delay on address changes"}],
  },
  {
    id: "wallet-apps", cat: "payments", status: "next", dev: "Kaka",
    title: "Open in your wallet, and an app icon", line: "One tap into MetaMask, Kraken or Rabby, and STELX on your home screen.",
    milestones: [["Open-in-wallet links", false], ["Installable app", false], ["Live", false]],
  },
  {
    id: "pay-anywhere", cat: "payments", status: "next", dev: "Rome",
    title: "Pay anywhere", line: "Pay someone on any of 20 chains, Solana and Arc included, straight from your private balance.",
    milestones: [["Bridge route tested", true], ["Quotes through our relay, so your IP stays hidden", false], ["Withdraw straight into the bridge", false], ["Delivery tracking", false], ["Live", false]],
    notes: [{date: "24 Sep",by: "Rome",text: "tried relay deposit addresses from robinhood chain. 10 USDG in, 9.90 USDC out on base, ~2s, about 10c. its just a plain transfer so a normal withdraw can go straight in, no new contract. refund addr needs to be a fresh one off your phrase, not your public wallet. round amounts by default"}],
  },
  {
    id: "ultimate", cat: "payments", status: "next", dev: "Rome",
    title: "Dark Mode", line: "Out of STELX and straight into a private pool on another chain. No wallet of yours at either end.",
    milestones: [["Pay anywhere live", false], ["Route into a private pool on the other side", false], ["Common amounts and timing, by default", false], ["Split big payments", false], ["Live", false]],
    notes: [{ date: "24 Sep", by: "Rome", text: "next step after pay anywhere. instead of landing in a normal wallet on base or arbitrum, it lands straight in a privacy pool there. round amounts, a bit of waiting and splitting big ones make it much harder to match up" }],
  },
  {
    id: "onramp", cat: "payments", status: "building", dev: "Eddy",
    title: "Private on-ramp", line: "Arrive from any of 20 chains, Solana included, straight into the pool.",
    milestones: [["Route", false], ["Build", false], ["Live", false]],
  },
  {
    id: "peer-cashin", cat: "payments", status: "next", dev: "Eddy",
    title: "Cash in with your bank app", line: "Pay a peer with Revolut or Wise and it lands straight in the pool. Works in the UK.",
    milestones: [["Route tested", false], ["Buy inside STELX", false], ["Lands in the pool", false], ["Real cash-in test", false], ["Live", false]],
  },
  {
    id: "offramp", cat: "offramp", status: "building", dev: "Kaka",
    title: "Private off-ramp", line: "A one-time Visa for Apple Pay, bought from your private balance. US only to start.",
    milestones: [["Card partner", false], ["Buy from your private balance", false], ["Card shows in STELX", false], ["Real purchase test", false], ["Live", false]],
  },
  {
    id: "peer-cashout", cat: "offramp", status: "next", dev: "Kaka",
    title: "Cash out to your bank app", line: "A peer buys your USDC and pays your Revolut or Wise. Works in the UK.",
    milestones: [["Route tested", false], ["Cash-out account from your phrase", false], ["Offer and withdraw from STELX", false], ["Real cash-out test", false], ["Live", false]],
  },
  {
    id: "merchants", cat: "payments", status: "later", dev: "Rome",
    title: "Pay with STELX", line: "Pay for compute and services privately, with a private receipt.",
    milestones: [["Merchant links", false], ["Order reference in the note", false], ["First partner", false]],
  },

  {
    id: "mainnet", cat: "protocol", status: "live", dev: "Rome",
    title: "Mainnet pool", line: "Live, verified, no owner, no admin.",
    milestones: [["Public ceremony", true], ["Audit", true], ["Deployed", true], ["Verified", true]],
    notes: [{date: "23 Sep",by: "Rome",text: "mainnet live. 31 contributions in the ceremony, contracts verified on sourcify and blockscout"}],
  },
  {
    id: "wallet-v2", cat: "protocol", status: "building", dev: "Eddy",
    title: "Wallet v2", line: "Sturdier scanning and view-only fixes, audited in one batch.",
    milestones: [["Reorg and RPC recovery", true], ["Lagging RPC handled", false], ["Per-chain keys", false], ["View-only fixes", false], ["Audit", false], ["Live", false]],
    notes: [{date: "24 Sep",by: "Rome",text: "outside reviewer found a few scanner edge cases (rpc dropping mid scan, reorgs). fixed, auditor signed off, live. rest of v2 goes to the auditor as one batch, not bit by bit"}],
  },
  {
    id: "sdk", cat: "protocol", status: "next", dev: "Eddy",
    title: "SDK", line: "Other apps add private balances.",
    milestones: [["API", false], ["Docs and examples", false], ["Published", false]],
  },
  {
    id: "swaps", cat: "protocol", status: "later", dev: "Rome",
    title: "Private swaps", line: "Trade stocks without leaving the pool.",
    milestones: [["Liquidity check", false], ["New pool design", false], ["Audit", false], ["Live", false]],
  },

  {
    id: "token-pool", cat: "token", status: "building", dev: "Kaka",
    title: "STELX pool", line: "Hold and send STELX privately, in its own audited pool.",
    milestones: [["Token checked", true], ["Pool built and tested on a mainnet copy", true], ["Deployed", false], ["Relay for STELX sends", false], ["Live", false]],
    notes: [{ date: "24 Sep", by: "Kaka", text: "pool built. same contract, circuit and wallet as the main pool byte for byte, so the audit and ceremony carry over. token has no tax, pause, blacklist or owner. deposit, private send and withdraw all passed with the real token on a mainnet copy. next: deploy and its relay" }],
  },
  {
    id: "stelx-drops", cat: "token", status: "next", dev: "Rome",
    title: "STELX giveaways", line: "Fastest-fingers gift links and community drops, paid in STELX.",
    milestones: [["First fastest-fingers gift", true], ["STELX pool live", false], ["First STELX drop", false]],
    notes: [{ date: "24 Sep", by: "Rome", text: "first fastest fingers gift on X, $10 in WETH. claimed in about 5 min. next ones in STELX once its pool is live" }],
  },
  {
    id: "relays", cat: "token", status: "later", dev: "Kaka",
    title: "Stake STELX to run a relay", line: "Anyone can run a relay by staking STELX and earn from every pool. Cheat and lose the stake.",
    milestones: [["Design", false], ["Staking contract", false], ["Audit", false], ["Live", false]],
  },
];

export const progress = (i: Item) => i.milestones.filter(([, done]) => done).length / i.milestones.length;
