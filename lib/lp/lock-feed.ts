import type { PairRecord } from "@/lib/types"
import { gatherLockerLogs, resolveLock, type KnownPair, type LockSighting } from "@/lib/lp/lock-logic"

const RPCS = ["https://ethereum-rpc.publicnode.com", "https://rpc.mevblocker.io", "https://rpc.flashbots.net"]

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>

export function knownPairs(rows: readonly PairRecord[]): Map<string, KnownPair> {
  const map = new Map<string, KnownPair>()
  for (const row of rows) {
    if (!row?.address) continue
    map.set(row.address.toLowerCase(), {
      token: (row.tokenAddress ?? "").toLowerCase(),
      exchange: row.exchange ?? "",
      symbol: row.symbol ?? "",
      name: row.tokenName || row.name || "",
      createdAt: row.created_at ?? null,
    })
  }
  return map
}

export async function publicRpc(method: string, params: unknown[]): Promise<unknown> {
  let last = "RPC failed"
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
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

/** Active WETH locks from verified locker contracts over the last seven days. */
export async function loadRecentLocks(rpc: Rpc, known: ReadonlyMap<string, KnownPair>, cancelled?: () => boolean): Promise<{ lock: LockSighting; at: string; symbol: string; name: string; createdAt: string | null }[]> {
  const headHex = await rpc("eth_blockNumber", [])
  const head = Number.parseInt(String(headHex), 16)
  if (!Number.isInteger(head)) return []
  const logs = await gatherLockerLogs(head, async (filter) => rpc("eth_getLogs", [filter]))
  const times = new Map<number, string>()
  const out: { lock: LockSighting; at: string; symbol: string; name: string; createdAt: string | null }[] = []
  for (const log of logs) {
    if (cancelled?.()) return out
    try {
      const lock = await resolveLock(log, async (to, data) => {
        const result = await rpc("eth_call", [{ to, data }, "latest"])
        return typeof result === "string" ? result : null
      }, known)
      if (!lock) continue
      const row = lock.pair ? known.get(lock.pair) : undefined
      out.push({ lock, at: await blockTime(rpc, log.block, times), symbol: row?.symbol ?? "", name: row?.name ?? "", createdAt: row?.createdAt ?? null })
    } catch {
      continue
    }
  }
  return out
}

async function blockTime(rpc: Rpc, block: number, cache: Map<number, string>): Promise<string> {
  const saved = cache.get(block)
  if (saved) return saved
  try {
    const result = (await rpc("eth_getBlockByNumber", [`0x${block.toString(16)}`, false])) as { timestamp?: string } | null
    const seconds = Number.parseInt(result?.timestamp ?? "", 16)
    const iso = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
    cache.set(block, iso)
    return iso
  } catch {
    return new Date().toISOString()
  }
}
