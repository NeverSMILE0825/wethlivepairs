/** Major features that must have a matching section id on the Help page. */
export const FEATURES = [
  { id: "protocol-filters", name: "Protocol filters", route: "/all", helpAnchor: "protocol-filters" },
  { id: "lp-locks", name: "LP locks", route: "/all", helpAnchor: "lp-locks" },
  { id: "lock-percentage", name: "Lock percentage", route: "/help", helpAnchor: "lp-lock-percentage" },
  { id: "narrative-clusters", name: "Narrative clusters", route: "/trends", helpAnchor: "narrative-clusters" },
  { id: "market-history", name: "Market condition history", route: "/all", helpAnchor: "market-condition-history" },
] as const

export const SOURCE_STATUS = [
  { id: "ethereum", name: "Ethereum logs", status: "configured" as const, note: "Pair creation, LP burns, and verified V2 locker transfers." },
  { id: "coingecko", name: "CoinGecko", status: "configured" as const, note: "ETH price fallback. Trending pools are not ingested." },
  { id: "dexscreener", name: "DEX Screener", status: "not-configured" as const, note: "No trending adapter is called. Pair links still open DEXTools." },
  { id: "gmgn", name: "GMGN", status: "not-configured" as const, note: "No API credential is configured." },
  { id: "pumpfun", name: "pump.fun", status: "not-configured" as const, note: "The server-only key is not set, and the browser never calls it." },
  { id: "solana", name: "Solana launches", status: "not-configured" as const, note: "The chain registry can score supplied observations. Live Solana ingestion is not running." },
  { id: "ai", name: "Narrative model", status: "not-configured" as const, note: "Clustering uses the alias dictionary. No model call is made." },
] as const
