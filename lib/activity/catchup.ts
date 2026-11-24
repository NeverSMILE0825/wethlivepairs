import { FACTORIES, HEAD_REORG_BLOCKS, PAIR_CREATED_TOPIC, POOL_CREATED_TOPIC, V4_INITIALIZE_TOPIC, classifyRpcFailure, dexForFactory, parsePairCreated, quoteSide } from "@/lib/history/plan"
import { TRANSFER_TOPIC, blocksForHours, classifyLpTransfer, parseTransferLog, type ParsedTransfer } from "@/lib/lp/burn-logic"

/** Same hosts as live-activity enrichment. The LP burn socket is not used here. */
const CATCHUP_RPCS = ["https://rpc.mevblocker.io", "https://eth.drpc.org"] as const

/** How far behind a published snapshot the open page will read from Ethereum. A day covers a missed publish. */
export const CATCHUP_HOURS = 24
export const CATCHUP_CHUNK = 2_000
const MIN_CHUNK = 200
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

async function logsBetween(rpc: CatchUpRpc, filter: Record<string, unknown>, from: number, to: number): Promise<RawLog[]> {
  const found: RawLog[] = []
  let size = CATCHUP_CHUNK
  let cursor = from
  while (cursor <= to) {
    const end = Math.min(to, cursor + size - 1)
    try {
      const page = await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(cursor), toBlock: hex(end) }])
      if (!Array.isArray(page)) throw new Error("No log list")
      found.push(...(page as RawLog[]))
      cursor = end + 1
      if (size < CATCHUP_CHUNK) size = Math.min(CATCHUP_CHUNK, size * 2)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Log scan failed"
      if (classifyRpcFailure(message) !== "fatal" && size > MIN_CHUNK) {
        size = Math.max(MIN_CHUNK, Math.floor(size / 2))
        continue
      }
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

/** Enrichment hosts only. The LP burn socket stays on its own endpoint. */
export async function catchUpRpc(method: string, params: unknown[]): Promise<unknown> {
  let last = "RPC failed"
  for (const url of CATCHUP_RPCS) {
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
      last = error instanceof Error ? error.message : "RPC error"
    }
  }
  throw new Error(last)
}
