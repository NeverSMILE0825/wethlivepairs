import { TRANSFER_TOPIC } from "@/lib/lp/burn-logic"
import { LOCKER_REGISTRY, lockerByAddress, type LockerProvider } from "@/lib/lp/lockers"

const ZERO = "0x0000000000000000000000000000000000000000"
const PROTOCOL_MINIMUM = BigInt(1000)

export type LockState = "active" | "expiring-soon" | "permanent" | "expired" | "withdrawn" | "extended" | "unknown"

export type LockSighting = {
  pair: string
  from: string | null
  locker: LockerProvider
  amount: bigint
  positionId: string | null
  block: number
  tx: string
  logIndex: number
}

export function fungiblePercents(input: { supply: bigint; burned: bigint; locked: bigint }): { burned: number | null; locked: number | null } {
  const available = input.supply - PROTOCOL_MINIMUM
  if (available <= BigInt(0) || input.burned < BigInt(0) || input.locked < BigInt(0)) return { burned: null, locked: null }
  if (input.burned + input.locked > available) return { burned: null, locked: null }
  const percent = (amount: bigint) => Number((amount * BigInt(10000)) / available) / 100
  return { burned: percent(input.burned), locked: percent(input.locked) }
}

/** A concentrated-liquidity NFT in a locker is that position, not the whole pool. */
export function concentratedLock(input: { custodianIsLocker: boolean; poolMatches: boolean; managerMatches: boolean }): { positionPercent: number | null; poolWidePercent: number | null } {
  if (!input.custodianIsLocker || !input.poolMatches || !input.managerMatches) return { positionPercent: null, poolWidePercent: null }
  return { positionPercent: 100, poolWidePercent: null }
}

export function lockState(input: { unlockAt: number | null; permanent: boolean; withdrawn: boolean; extended: boolean; now: number }): LockState {
  if (input.withdrawn) return "withdrawn"
  if (input.permanent) return "permanent"
  if (input.unlockAt == null) return "unknown"
  if (input.unlockAt <= input.now) return "expired"
  if (input.extended) return "extended"
  if (input.unlockAt - input.now <= 24 * 60 * 60 * 1000) return "expiring-soon"
  return "active"
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (ms >= day) {
    const days = Math.floor(ms / day)
    const hours = Math.floor((ms % day) / hour)
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }
  if (ms >= hour) {
    const hours = Math.floor(ms / hour)
    const minutes = Math.floor((ms % hour) / minute)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  return `${Math.max(1, Math.floor(ms / minute))}m`
}

export function nextUnlock(locks: readonly { unlockAt: number | null; state: LockState }[]): number | null {
  const times = locks.filter((lock) => (lock.state === "active" || lock.state === "expiring-soon" || lock.state === "extended") && lock.unlockAt != null).map((lock) => lock.unlockAt as number)
  return times.length === 0 ? null : Math.min(...times)
}

export function liveLockFilter() {
  const recipients = LOCKER_REGISTRY.filter((item) => item.enabled).map((item) => `0x${item.address.slice(2).padStart(64, "0")}`)
  return {
    jsonrpc: "2.0" as const,
    id: 4,
    method: "eth_subscribe" as const,
    params: ["logs", { topics: [TRANSFER_TOPIC, null, recipients] }],
  }
}

export function lockFromMessage(payload: unknown): LockSighting | null {
  if (!payload || typeof payload !== "object") return null
  const result = (payload as { params?: { result?: { address?: string; topics?: string[]; data?: string; blockNumber?: string; transactionHash?: string; logIndex?: string } } }).params?.result
  if (!result || !Array.isArray(result.topics)) return null
  if ((result.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return null
  const to = topicAddress(result.topics[2])
  const locker = lockerByAddress(to)
  if (!locker) return null
  const from = topicAddress(result.topics[1])
  if (from === ZERO) return null
  const pair = (result.address ?? "").toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(pair)) return null
  let amount = BigInt(0)
  const positionTopic = result.topics[3]
  const positionId = positionTopic && /^0x[0-9a-fA-F]{64}$/.test(positionTopic) ? BigInt(positionTopic).toString() : null
  if (!positionId) {
    try {
      amount = BigInt(result.data ?? "0x0")
    } catch {
      return null
    }
    if (amount <= BigInt(0)) return null
  }
  const block = Number.parseInt(result.blockNumber ?? "", 16)
  const logIndex = Number.parseInt(result.logIndex ?? "", 16)
  if (!Number.isInteger(block) || !Number.isInteger(logIndex)) return null
  if (!/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash ?? "")) return null
  return { pair, from, locker, amount, positionId, block, tx: (result.transactionHash ?? "").toLowerCase(), logIndex }
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null
  return `0x${topic.slice(-40).toLowerCase()}`
}
