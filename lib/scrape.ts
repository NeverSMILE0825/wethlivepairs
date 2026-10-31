import { ListingError, requestJson, sleep } from "@/lib/http"
import { NATIVE_ETH } from "@/lib/history/plan"
import { protocolVersion } from "@/lib/protocol/identity"
import { COLLECTION_MAX_HOURS, UNKNOWN_EXCHANGE, type PairRow } from "@/lib/types"

const LISTING_API = "https://www.dextools.io/api/core"
const EXCHANGES_API = "https://www.dextools.io/shared/exchanges/v2"
const CHAIN = "ether"
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
/** Some listings write native ETH as this placeholder instead of the zero address Uniswap V4 uses. */
const NATIVE_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
const PAGE_SIZE = 100
const PAGE_DELAY_MS = 120

type TokenSide = {
  address?: string
  name?: string
  symbol?: string
}

type Pool = {
  creationTime?: string
  exchange?: string
  address?: string
  liquidity?: number | null
  price?: number | null
  poolRemaining?: number | null
  mainToken?: TokenSide
  sideToken?: TokenSide
}

type ListingPage = {
  pools: Pool[]
  next?: { ts?: number }
}

function parseCreated(value: string): Date {
  const text = value.trim().replace(" ", "T")
  const normalized = text.endsWith("Z") ? text : `${text}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    throw new ListingError(`Unreadable creation time: ${value}`)
  }
  return date
}

function isWeth(token: TokenSide | undefined): boolean {
  return (token?.address ?? "").toLowerCase() === WETH_ADDRESS
}

function isNativeEth(token: TokenSide | undefined): boolean {
  const address = (token?.address ?? "").toLowerCase()
  return address === NATIVE_ETH || address === NATIVE_PLACEHOLDER
}

function pairName(token: TokenSide | undefined): string {
  const symbol = token?.symbol?.trim() || "?"
  const tokenName = token?.name?.trim() ?? ""
  if (tokenName && tokenName.toLowerCase() !== symbol.toLowerCase()) {
    return `${symbol}(${tokenName})`
  }
  return symbol
}

function pairUrl(address: string): string {
  return `https://www.dextools.io/app/${CHAIN}/pair-explorer/${encodeURIComponent(address)}`
}

function toRow(pool: Pool, exchangeNames: Map<string, string>): PairRow | null {
  const address = pool.address?.trim() ?? ""
  const createdRaw = pool.creationTime?.trim() ?? ""
  if (!address || !createdRaw) return null
  const slug = (pool.exchange ?? "").trim().toLowerCase()
  const exchange = (slug && exchangeNames.get(slug)) || UNKNOWN_EXCHANGE
  const nativeQuote = (isNativeEth(pool.mainToken) || isNativeEth(pool.sideToken)) && protocolVersion(exchange) === "v4"
  const wethQuote = isWeth(pool.mainToken) || isWeth(pool.sideToken)
  if (!wethQuote && !nativeQuote) return null
  const token = nativeQuote
    ? (isNativeEth(pool.mainToken) && !isNativeEth(pool.sideToken) ? pool.sideToken : pool.mainToken)
    : (isWeth(pool.mainToken) && !isWeth(pool.sideToken) ? pool.sideToken : pool.mainToken)
  if (!token?.address || isNativeEth(token)) return null
  const quote = token === pool.mainToken ? pool.sideToken : pool.mainToken
  const quoteSymbol = quote?.symbol?.trim() || ""
  return {
    name: pairName(token),
    created_at: parseCreated(createdRaw).toISOString(),
    exchange,
    address,
    tokenAddress: token.address.trim(),
    url: pairUrl(address),
    price: typeof pool.price === "number" ? pool.price : null,
    remaining: typeof pool.poolRemaining === "number" ? pool.poolRemaining : null,
    remainingUnit: !quoteSymbol || quoteSymbol.toUpperCase() === "WETH" || quoteSymbol.toUpperCase() === "ETH" ? "ETH" : quoteSymbol,
    listingLiquidity: typeof pool.liquidity === "number" ? pool.liquidity : null,
    quote: nativeQuote ? "eth" : "weth",
  }
}

async function fetchExchangeNames(): Promise<Map<string, string>> {
  const query = new URLSearchParams({ allowUnknowns: "false", chain: CHAIN })
  const payload = (await requestJson(`${EXCHANGES_API}?${query}`)) as {
    data?: { exchanges?: { slug?: string; name?: string }[] }[]
  }
  const names = new Map<string, string>()
  for (const block of payload.data ?? []) {
    for (const item of block.exchanges ?? []) {
      const slug = item.slug?.trim().toLowerCase()
      const name = item.name?.trim()
      if (slug && name) names.set(slug, name)
    }
  }
  if (names.size === 0) {
    throw new ListingError("DEXTools exchange list was empty.")
  }
  return names
}

async function fetchPage(cursor: number | null): Promise<ListingPage> {
  const path =
    cursor === null
      ? `/pool/listing/liveNew/latest?chain=${CHAIN}&limit=${PAGE_SIZE}`
      : `/pool/listing/liveNew?ts=${cursor}&chain=${CHAIN}&limit=${PAGE_SIZE}`
  const payload = (await requestJson(LISTING_API + path)) as { data?: ListingPage }
  if (!payload.data || !Array.isArray(payload.data.pools)) {
    throw new ListingError("DEXTools listing response did not include a pools list.")
  }
  return payload.data
}

export async function collectWethPairs(hours: number): Promise<{ rows: PairRow[]; scanned: number; listingOldestAt: string | null; listingComplete: boolean }> {
  if (!Number.isFinite(hours) || hours <= 0 || hours > COLLECTION_MAX_HOURS) {
    throw new ListingError(`Choose a period between 1 and ${COLLECTION_MAX_HOURS} hours.`)
  }

  const cutoff = Date.now() - hours * 60 * 60 * 1000
  // About 14 pages cover one hour of every Ethereum pool. 80 pages used to stop near 6 hours, so 12h and 24h counted the same pairs.
  const maxPages = Math.min(420, Math.ceil(hours * 14) + 4)
  const matches: PairRow[] = []
  const seen = new Set<string>()
  let scanned = 0
  let cursor: number | null = null
  let previousCursor: number | null = null
  let listingOldest = Number.POSITIVE_INFINITY
  let listingComplete = false

  const exchangeNames = await fetchExchangeNames()

  for (let page = 0; page < maxPages; page++) {
    let data: ListingPage
    try {
      data = await fetchPage(cursor)
    } catch (error) {
      console.warn(`[HISTORY] DEXTools listing stopped on page ${page + 1}. ${error instanceof Error ? error.message : "unknown error"}`)
      break
    }
    if (data.pools.length === 0) break

    let oldestOnPage = Number.POSITIVE_INFINITY
    for (const pool of data.pools) {
      scanned += 1
      const createdRaw = pool.creationTime?.trim()
      const created = createdRaw ? parseCreated(createdRaw).getTime() : null
      if (created !== null && created < oldestOnPage) oldestOnPage = created
      if (created !== null && created < cutoff) continue
      const row = toRow(pool, exchangeNames)
      if (!row) continue
      const key = row.address.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      matches.push(row)
    }

    if (oldestOnPage < listingOldest) listingOldest = oldestOnPage
    const nextTs = data.next?.ts
    if (oldestOnPage < cutoff) {
      listingComplete = true
      break
    }
    if (nextTs === undefined || nextTs === null) break
    if (previousCursor !== null && nextTs >= previousCursor) break
    previousCursor = nextTs
    cursor = nextTs
    if (page < maxPages - 1) await sleep(PAGE_DELAY_MS)
  }

  matches.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return {
    rows: matches,
    scanned,
    listingOldestAt: Number.isFinite(listingOldest) ? new Date(listingOldest).toISOString() : null,
    listingComplete,
  }
}
