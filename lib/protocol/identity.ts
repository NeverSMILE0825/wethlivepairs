/** Uniswap generation for a pool. SushiSwap is a V2-style fork and stays out of the V2 filter. */

export type ProtocolVersion = "v2" | "v3" | "v4" | "other"

export type ProtocolFilterId = "all" | "v2" | "v3" | "v4"

export const PROTOCOL_FILTERS: readonly ProtocolFilterId[] = ["all", "v2", "v3", "v4"]

export type ProtocolIdentity = {
  chain: "ethereum"
  dex: string
  version: ProtocolVersion
  feeBps: number | null
  hook: boolean
  badge: string
  title: string
}

const ZERO_HOOK = "0x0000000000000000000000000000000000000000"

export function protocolVersion(exchange: string): ProtocolVersion {
  const name = exchange.trim()
  if (/uniswap/i.test(name) && /\bv4\b/i.test(name)) return "v4"
  if (/uniswap/i.test(name) && /\bv3\b/i.test(name)) return "v3"
  if (/uniswap/i.test(name) && /\bv2\b/i.test(name)) return "v2"
  return "other"
}

/** Uniswap fee is hundredths of a bip: 3000 is 0.30%. */
export function formatFeeTier(feeBps: number | null | undefined): string | null {
  if (feeBps == null || !Number.isFinite(feeBps) || feeBps <= 0) return null
  const percent = feeBps / 10_000
  const text = percent >= 1 ? percent.toFixed(0) : percent >= 0.1 ? percent.toFixed(1) : percent.toFixed(2)
  return `${text.replace(/0+$/, "").replace(/\.$/, "")}%`
}

export function protocolIdentity(exchange: string, extra?: { feeBps?: number | null; hook?: string | null }): ProtocolIdentity {
  const version = protocolVersion(exchange)
  const fee = formatFeeTier(extra?.feeBps)
  const hookAddress = (extra?.hook ?? "").toLowerCase()
  const hook = hookAddress !== "" && hookAddress !== ZERO_HOOK
  const dex = version === "other" ? (exchange.trim() || "Unknown DEX") : `Uniswap ${version.toUpperCase()}`
  let badge = version === "other" ? (/\bsushi/i.test(exchange) ? "Sushi" : "DEX") : version.toUpperCase()
  if (version === "v3" && fee) badge = `V3 · ${fee}`
  if (version === "v4" && hook) badge = "V4 · Hook"
  const title = [dex, fee ? `${fee} fee` : null, hook ? "hooked pool" : null].filter(Boolean).join(" · ")
  return { chain: "ethereum", dex, version, feeBps: extra?.feeBps ?? null, hook, badge, title }
}

export function matchesProtocol(exchange: string | null | undefined, filter: ProtocolFilterId): boolean {
  if (filter === "all") return true
  return protocolVersion(exchange ?? "") === filter
}

export function protocolCounts(exchanges: readonly (string | null | undefined)[]): Record<ProtocolFilterId, number> {
  const counts = { all: exchanges.length, v2: 0, v3: 0, v4: 0 }
  for (const exchange of exchanges) {
    const version = protocolVersion(exchange ?? "")
    if (version === "v2" || version === "v3" || version === "v4") counts[version] += 1
  }
  return counts
}

/**
 * V2 reserves and a V3 pool's own WETH balance are pool-specific.
 * V4 keeps every pool inside one PoolManager, so that contract's WETH balance is not this pool.
 */
export function pooledWethReading(exchange: string | null | undefined, value: number | null): { value: number | null; reason: string | null } {
  if (protocolVersion(exchange ?? "") === "v4") {
    return { value: null, reason: "Uniswap V4 keeps every pool in one PoolManager. That contract's WETH balance is not this pool, so pooled WETH is N/A until a pool-specific figure exists." }
  }
  return { value: value != null && Number.isFinite(value) ? value : null, reason: null }
}
