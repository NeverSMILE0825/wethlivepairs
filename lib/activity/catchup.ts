import { FACTORIES, HEAD_REORG_BLOCKS, PAIR_CREATED_TOPIC, POOL_CREATED_TOPIC, V4_INITIALIZE_TOPIC, classifyRpcFailure, dexForFactory, parsePairCreated, quoteSide } from "@/lib/history/plan"
import { TRANSFER_TOPIC, blocksForHours, classifyLpTransfer, parseTransferLog, type ParsedTransfer } from "@/lib/lp/burn-logic"

/**
 * Wide reads try the enrichment hosts first. A host that names a block cap is skipped for larger
 * slices. The LP burn socket host is only the last resort, so a normal update does not share it.
 */
const CATCHUP_RPCS = ["https://rpc.mevblocker.io", "https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"] as const
const HOST_CAP = new Map<string, number>()

/** How far behind a published snapshot the open page will read from Ethereum. A day covers a missed publish. */
export const CATCHUP_HOURS = 24
export const CATCHUP_CHUNK = 2_000
const MIN_CHUNK = 20
const ZERO_TOPIC = `0x${"0".repeat(64)}`
const DEAD_TOPIC = `0x${"0".repeat(24)}000000000000000000000000000000000000dead`

export type CatchUpRange = { from: number; to: number }

/**
 * Blocks the page still has to read. `covered` is the last block already in the published snapshot.
 * The range never starts more than {@link CATCHUP_HOURS} behind the settled head.
 */
export function catchUpRange(head: number, covered: number | null): CatchUpRange | null {
  if (!Number.isInteger(head) || head < 1) return null
  const to = Math.max(0, head - HEAD_REORG_BLOCKS)
  const floor = Math.max(0, to - blocksForHours(CATCHUP_HOURS))
  const from = covered == null ? floor : Math.max(floor, covered - HEAD_REORG_BLOCKS + 1)
  if (from > to) return null
  return { from, to }
}

/** Where a swap recount should start. A young pair is counted from creation. An older pair only adds swaps after the snapshot. */
export function swapCountFrom(created: number | null, head: number, gapFrom: number | null, maxSpan: number): { mode: "full" | "gap"; from: number } | null {
  if (!Number.isInteger(head) || head < 0) return null
  if (created != null && created <= head && head - created <= maxSpan) return { mode: "full", from: created }
  if (gapFrom == null || gapFrom > head) return null
  const from = created != null ? Math.max(created, gapFrom) : gapFrom
  if (from > head || head - from > blocksForHours(CATCHUP_HOURS)) return null
  return { mode: "gap", from }
}

export type CaughtPair = {
  pair: string
  token: string
  token0: string
  dex: string
  block: number
  quote: "eth" | "weth"
  at: string
}

export type CatchUpRpc = (method: string, params: unknown[]) => Promise<unknown>

type RawLog = { address?: string; topics?: string[]; data?: string; blockNumber?: string; transactionHash?: string; logIndex?: string }

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

/** Two block timestamps place every event in the slice. One failed read falls back to the other. */
async function sliceClock(rpc: CatchUpRpc, from: number, to: number): Promise<(block: number) => string> {
  const stamp = async (block: number) => {
    try {
      const result = (await rpc("eth_getBlockByNumber", [hex(block), false])) as { timestamp?: string } | null
      const seconds = Number.parseInt(result?.timestamp ?? "", 16)
      return Number.isFinite(seconds) ? seconds * 1000 : null
    } catch {
      return null
    }
  }
  const start = await stamp(from)
  const end = to === from ? start : await stamp(to)
  return (block: number) => {
    if (start == null && end == null) return new Date(0).toISOString()
    if (start == null || end == null || to === from) return new Date(start ?? end ?? 0).toISOString()
    const ratio = (block - from) / Math.max(1, to - from)
    return new Date(start + ratio * (end - start)).toISOString()
  }
}

/** A provider that says "over 100 blocks" can answer a slice of that size. */
export function rangeCap(message: string): number | null {
  const match = /(?:over|exceeds?|more than)\s+(\d+)\s+blocks/i.exec(message)
  if (!match) return null
  const value = Number(match[1])
  return Number.isInteger(value) && value >= 1 ? value : null
}

export function blockSpan(method: string, params: unknown[]): number | null {
  if (method !== "eth_getLogs") return null
  const filter = params[0] as { fromBlock?: string; toBlock?: string } | undefined
  const from = Number.parseInt(filter?.fromBlock ?? "", 16)
  const to = Number.parseInt(filter?.toBlock ?? "", 16)
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return null
  return to - from + 1
}

/** Hosts that already refused a wider slice are left for the next, smaller read. */
export function hostsForSpan(hosts: readonly string[], caps: ReadonlyMap<string, number>, span: number | null): string[] {
  if (span == null) return [...hosts]
  return hosts.filter((url) => {
    const cap = caps.get(url)
    return cap == null || span <= cap
  })
}

async function logsBetween(rpc: CatchUpRpc, filter: Record<string, unknown>, from: number, to: number): Promise<RawLog[]> {
  const found: RawLog[] = []
  let size = CATCHUP_CHUNK
  let cursor = from
  let stalls = 0
  while (cursor <= to) {
    const end = Math.min(to, cursor + size - 1)
    try {
      const page = await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(cursor), toBlock: hex(end) }])
      if (!Array.isArray(page)) throw new Error("No log list")
      found.push(...(page as RawLog[]))
      cursor = end + 1
      stalls = 0
    } catch (error) {
      const message = error instanceof Error ? error.message : "Log scan failed"
      const cap = rangeCap(message)
      const span = end - cursor + 1
      if (cap != null && span > cap) {
        size = Math.max(1, Math.min(size, cap))
        stalls = 0
        continue
      }
      const kind = classifyRpcFailure(message)
      if (kind !== "fatal" && size > MIN_CHUNK) {
        size = Math.max(MIN_CHUNK, Math.floor(size / 2))
        stalls = 0
        continue
      }
      stalls += 1
      if (stalls < 3 && kind !== "fatal") continue
      throw error
    }
  }
  return found
}

/** New WETH and V4 native-ETH pairs, plus LP burns of the pairs this page already shows. */
export async function readCatchUp(rpc: CatchUpRpc, range: CatchUpRange, burnPairs: readonly string[]): Promise<{ pairs: CaughtPair[]; burns: Array<ParsedTransfer & { at: string }> }> {
  const clock = await sliceClock(rpc, range.from, range.to)
  const created = await logsBetween(rpc, {
    address: FACTORIES.map((item) => item.address),
    topics: [[PAIR_CREATED_TOPIC, POOL_CREATED_TOPIC, V4_INITIALIZE_TOPIC]],
  }, range.from, range.to)
  const pairs: CaughtPair[] = []
  const seen = new Set<string>()
  for (const log of created) {
    const row = parsePairCreated(log)
    if (!row) continue
    const dex = dexForFactory(row.factory)
    const side = quoteSide(row.token0, row.token1, dex)
    if (!dex || !side || seen.has(row.pair)) continue
    seen.add(row.pair)
    pairs.push({ pair: row.pair, token: side.token, token0: row.token0, dex, block: row.block, quote: side.quote, at: clock(row.block) })
  }
  const fresh = pairs.filter((item) => /^0x[0-9a-f]{40}$/.test(item.pair)).map((item) => item.pair)
  const addresses = [...new Set([...fresh, ...burnPairs.map((item) => item.toLowerCase())].filter((item) => /^0x[0-9a-f]{40}$/.test(item)))].slice(0, 48)
  const burns: Array<ParsedTransfer & { at: string }> = []
  for (let index = 0; index < addresses.length; index += 12) {
    const batch = addresses.slice(index, index + 12)
    const logs = await logsBetween(rpc, {
      address: batch,
      topics: [TRANSFER_TOPIC, null, [ZERO_TOPIC, DEAD_TOPIC]],
    }, range.from, range.to)
    for (const log of logs) {
      const transfer = parseTransferLog(log as Parameters<typeof parseTransferLog>[0])
      if (!transfer || classifyLpTransfer(transfer) !== "irreversible-burn") continue
      burns.push({ ...transfer, at: clock(transfer.block) })
    }
  }
  return { pairs, burns }
}

/** Reads one Ethereum method. A host that cannot take the block span is not asked. */
export async function catchUpRpc(method: string, params: unknown[]): Promise<unknown> {
  const span = blockSpan(method, params)
  const hosts = hostsForSpan(CATCHUP_RPCS, HOST_CAP, span)
  if (hosts.length === 0) {
    const tightest = Math.min(...HOST_CAP.values())
    throw new Error(`ranges over ${Number.isFinite(tightest) ? tightest : 100} blocks are not supported on free plan`)
  }
  let last = "RPC failed"
  for (const url of hosts) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      })
      const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (!response.ok || payload.error) throw new Error(payload.error?.message || `HTTP ${response.status}`)
      return payload.result
    } catch (error) {
      const message = error instanceof Error ? error.message : "RPC error"
      const cap = rangeCap(message)
      if (cap != null) HOST_CAP.set(url, Math.min(HOST_CAP.get(url) ?? cap, cap))
      last = message
    }
  }
  throw new Error(last)
}
