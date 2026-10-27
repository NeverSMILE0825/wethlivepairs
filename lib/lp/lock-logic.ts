import { LOCKER_REGISTRY, lockerByAddress, type LockerProvider } from "@/lib/lp/lockers"

/** Official Uniswap position managers. V3: NonfungiblePositionManager. V4: PositionManager. */
export const V3_POSITION_MANAGER = "0xc36442b4a4522e871399cd717abdd847ab11fe88"
export const V4_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e"
export const V3_FACTORY = "0x1f98431c8ad98523631ae4a59f267346ea31f984"
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

const DEPOSIT = "0xeb65d0f36862bbd8763c5e2c983c9d753267d223eee35a224d8d0a9d7ef433a2"
const DEPOSIT_NFT = "0x8ada5a61cb829cf6dd4a74752fd8a7524261a767c2c80ee9398343e2063ef144"
const WITHDRAW_TOKEN = "0x0d4e822e698a3b7d8bbfd9c6134543f053190e9179c0b891e527344267c74e2c"
const WITHDRAW_NFT = "0xc62daab170a6f948b96ecf94bc8026d453d9fa56f720914202e677c726a5f1f6"
const UNCX_DEPOSIT = "0x830357565da6ecfc26d8d9f69df488ed6f70361af9a07e570544aeb5c5e765e5"
const UNCX_WITHDRAW = "0xccad973dcd043c7d680389db4378bd6b9775db7124092e9e0422c9e46d7985dc"
const UNCX_NEW = "0x3e5a874dd8f086c73bba5a860cb04972e50b6207f84cc020037d576afa6ebc13"
const UNCX_WITHDRAW_ID = "0x4ad1282d02c0d7aa981ce2f5b4e42e99e212f6a24d11616393c32a87226e160c"
const UNCX_RELOCK = "0x139b970a1cf074dc6188d72d876cfd4d4992ae83931cf20dfdd59bb3b3dc0f91"
const UNCX_INCREMENT = "0x290ddee191319eda9ea34e6de4555381e35469d74d73fe0e80fe7f0836620ea0"

/** Topics that create, extend, increase, or close a lock. Withdrawals are included so a later scan can drop them. */
export const LOCKER_EVENT_TOPICS = [DEPOSIT, DEPOSIT_NFT, WITHDRAW_TOKEN, WITHDRAW_NFT, UNCX_DEPOSIT, UNCX_WITHDRAW, UNCX_NEW, UNCX_WITHDRAW_ID, UNCX_RELOCK, UNCX_INCREMENT]

const POSITIONS = "0x99fbab88"
const GET_POOL = "0x1698ee82"
const V4_POSITION = "0x7ba03aad"
const TOTAL_SUPPLY = "0x18160ddd"
const BALANCE_OF = "0x70a08231"
const LOOKBACK_BLOCKS = 50_400
const LOG_SPAN = 8_000

const ZERO = "0x0000000000000000000000000000000000000000"
const PROTOCOL_MINIMUM = BigInt(1000)

export type LockState = "active" | "expiring-soon" | "permanent" | "expired" | "withdrawn" | "extended" | "unknown"

export type LockSighting = {
  id: string
  pair: string | null
  token: string | null
  exchange: string
  feeBps: number | null
  from: string | null
  locker: LockerProvider
  amount: bigint
  positionId: string | null
  percent: number | null
  unlockAt: number | null
  block: number
  tx: string
  logIndex: number
  kind: "fungible" | "position"
}

export type LockerAction = "lock" | "relock" | "increase" | "withdraw"

export type LockerLog = {
  locker: LockerProvider
  action: LockerAction
  lockId: string | null
  token: string
  tokenId: string | null
  amount: bigint
  unlockAt: number | null
  owner: string | null
  block: number
  tx: string
  logIndex: number
}

export type KnownPair = {
  token: string
  exchange: string
  symbol: string
  name: string
  createdAt: string | null
}

type RawLog = { address?: string; topics?: string[]; data?: string; blockNumber?: string; transactionHash?: string; logIndex?: string }

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
  const address = LOCKER_REGISTRY.filter((item) => item.enabled).map((item) => item.address)
  return {
    jsonrpc: "2.0" as const,
    id: 4,
    method: "eth_subscribe" as const,
    params: ["logs", { address, topics: [LOCKER_EVENT_TOPICS] }],
  }
}

export function lockLogFilter(from: number, to: number) {
  return {
    fromBlock: hex(from),
    toBlock: hex(to),
    address: LOCKER_REGISTRY.filter((item) => item.enabled).map((item) => item.address),
    topics: [LOCKER_EVENT_TOPICS],
  }
}

/** Newest range first, so a slow RPC still surfaces the latest locks. */
export function lockRanges(head: number): { from: number; to: number }[] {
  if (!Number.isInteger(head) || head < 0) return []
  const start = Math.max(0, head - LOOKBACK_BLOCKS)
  const ranges: { from: number; to: number }[] = []
  for (let from = start; from <= head; from += LOG_SPAN) ranges.push({ from, to: Math.min(head, from + LOG_SPAN - 1) })
  return ranges.reverse()
}

export function lockerLogFromMessage(payload: unknown): LockerLog | null {
  if (!payload || typeof payload !== "object") return null
  const result = (payload as { params?: { result?: RawLog } }).params?.result
  return result ? parseLockerLog(result) : null
}

export function parseLockerLog(log: RawLog): LockerLog | null {
  const locker = lockerByAddress(log.address)
  if (!locker || !Array.isArray(log.topics)) return null
  const topic0 = (log.topics[0] ?? "").toLowerCase()
  if (!LOCKER_EVENT_TOPICS.includes(topic0)) return null
  const block = Number.parseInt(log.blockNumber ?? "", 16)
  const logIndex = Number.parseInt(log.logIndex ?? "", 16)
  if (!Number.isInteger(block) || !Number.isInteger(logIndex)) return null
  if (!/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash ?? "")) return null
  const data = log.data ?? "0x"
  const base = {
    locker,
    block,
    tx: (log.transactionHash ?? "").toLowerCase(),
    logIndex,
    owner: topicAddress(log.topics[2]),
  }
  if (topic0 === DEPOSIT) {
    const token = topicAddress(log.topics[1])
    const id = word(data, 0)
    const amount = word(data, 1)
    const unlock = word(data, 2)
    if (!token || id == null || amount == null || amount <= BigInt(0)) return null
    return { ...base, action: "lock", lockId: id.toString(), token, tokenId: null, amount, unlockAt: seconds(unlock) }
  }
  if (topic0 === DEPOSIT_NFT) {
    const token = topicAddress(log.topics[1])
    const id = word(data, 0)
    const tokenId = word(data, 1)
    const amount = word(data, 2)
    const unlock = word(data, 3)
    if (!token || id == null || tokenId == null) return null
    return { ...base, action: "lock", lockId: id.toString(), token, tokenId: tokenId.toString(), amount: amount ?? BigInt(1), unlockAt: seconds(unlock) }
  }
  if (topic0 === WITHDRAW_TOKEN || topic0 === WITHDRAW_NFT) {
    const token = topicAddress(log.topics[1])
    const id = word(data, 0)
    if (!token || id == null) return null
    return { ...base, action: "withdraw", lockId: id.toString(), token, tokenId: topic0 === WITHDRAW_NFT ? word(data, 1)?.toString() ?? null : null, amount: BigInt(0), unlockAt: null }
  }
  if (topic0 === UNCX_DEPOSIT) {
    const token = addressWord(data, 0)
    const amount = word(data, 2)
    if (!token || amount == null || amount <= BigInt(0)) return null
    return { ...base, action: "lock", lockId: null, token, tokenId: null, amount, owner: addressWord(data, 1), unlockAt: seconds(word(data, 4)) }
  }
  if (topic0 === UNCX_WITHDRAW) {
    const token = addressWord(data, 0)
    if (!token) return null
    return { ...base, action: "withdraw", lockId: null, token, tokenId: null, amount: BigInt(0), owner: null, unlockAt: null }
  }
  if (topic0 === UNCX_NEW || topic0 === UNCX_RELOCK || topic0 === UNCX_INCREMENT) {
    const id = word(data, 0)
    const token = addressWord(data, 1)
    if (id == null || !token) return null
    const action: LockerAction = topic0 === UNCX_NEW ? "lock" : topic0 === UNCX_RELOCK ? "relock" : "increase"
    const amount = word(data, topic0 === UNCX_INCREMENT ? 4 : 3)
    const unlock = topic0 === UNCX_INCREMENT ? null : word(data, 5)
    return { ...base, action, lockId: id.toString(), token, tokenId: null, amount: amount ?? BigInt(0), owner: addressWord(data, 2), unlockAt: seconds(unlock) }
  }
  if (topic0 === UNCX_WITHDRAW_ID) {
    const id = word(data, 0)
    const token = addressWord(data, 1)
    const remaining = word(data, 3)
    if (id == null || !token) return null
    return { ...base, action: "withdraw", lockId: id.toString(), token, tokenId: null, amount: remaining ?? BigInt(0), owner: addressWord(data, 2), unlockAt: null }
  }
  return null
}

/** One row per lock. A withdrawal removes it. A relock keeps the original block. */
export function foldLockerLogs(logs: readonly LockerLog[]): LockerLog[] {
  const sorted = [...logs].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
  const map = new Map<string, LockerLog>()
  for (const log of sorted) {
    if (log.lockId) {
      const key = `${log.locker.address}:${log.lockId}`
      if (log.action === "withdraw" && log.amount <= BigInt(0)) {
        map.delete(key)
        continue
      }
      if (log.action === "withdraw") {
        const prev = map.get(key)
        if (prev) map.set(key, { ...prev, amount: log.amount })
        continue
      }
      const prev = map.get(key)
      if (prev && log.action !== "lock") map.set(key, { ...prev, amount: log.amount > BigInt(0) ? log.amount : prev.amount, unlockAt: log.unlockAt ?? prev.unlockAt })
      else map.set(key, { ...log, action: "lock" })
      continue
    }
    if (log.action === "withdraw") {
      for (const [key, item] of map) {
        if (item.lockId == null && item.locker.address === log.locker.address && item.token === log.token) map.delete(key)
      }
      continue
    }
    map.set(`${log.locker.address}:${log.tx}:${log.logIndex}`, { ...log, action: "lock" })
  }
  return [...map.values()]
}

export function decodeV3Position(data: string): { token0: string; token1: string; fee: number; liquidity: bigint } | null {
  const token0 = addressWord(data, 2)
  const token1 = addressWord(data, 3)
  const fee = word(data, 4)
  const liquidity = word(data, 7)
  if (!token0 || !token1 || fee == null || liquidity == null) return null
  return { token0, token1, fee: Number(fee), liquidity }
}

export function wethToken(token0: string, token1: string): string | null {
  const a = token0.toLowerCase()
  const b = token1.toLowerCase()
  if (a === WETH && b !== WETH) return b
  if (b === WETH && a !== WETH) return a
  if (a === WETH && b === WETH) return WETH
  return null
}

export async function gatherLockerLogs(head: number, getLogs: (filter: ReturnType<typeof lockLogFilter>) => Promise<unknown>): Promise<LockerLog[]> {
  const found: LockerLog[] = []
  for (const range of lockRanges(head)) {
    let page: unknown
    try {
      page = await getLogs(lockLogFilter(range.from, range.to))
    } catch {
      const mid = Math.floor((range.from + range.to) / 2)
      for (const half of [{ from: range.from, to: mid }, { from: mid + 1, to: range.to }]) {
        try {
          const retry = await getLogs(lockLogFilter(half.from, half.to))
          if (Array.isArray(retry)) for (const item of retry) {
            const log = parseLockerLog(item as RawLog)
            if (log) found.push(log)
          }
        } catch {
          continue
        }
      }
      continue
    }
    if (!Array.isArray(page)) continue
    for (const item of page) {
      const log = parseLockerLog(item as RawLog)
      if (log) found.push(log)
    }
  }
  return foldLockerLogs(found)
}

export async function resolveLock(log: LockerLog, call: (to: string, data: string) => Promise<string | null>, known: ReadonlyMap<string, KnownPair>): Promise<LockSighting | null> {
  if (log.action === "withdraw") return null
  const id = `${log.locker.address}:${log.lockId ?? `${log.tx}:${log.logIndex}`}`
  if (log.tokenId && log.token === V3_POSITION_MANAGER) {
    const encoded = await call(V3_POSITION_MANAGER, POSITIONS + pad(BigInt(log.tokenId)))
    const position = encoded ? decodeV3Position(encoded) : null
    if (!position) return null
    const token = wethToken(position.token0, position.token1)
    if (!token) return null
    const poolHex = await call(V3_FACTORY, GET_POOL + padAddress(position.token0) + padAddress(position.token1) + pad(BigInt(position.fee)))
    const pool = poolHex ? addressWord(poolHex, 0) : null
    const pair = pool && pool !== ZERO ? pool : null
    const row = pair ? known.get(pair) : undefined
    return sighting(log, id, { pair, token: row?.token ?? token, exchange: row?.exchange ?? "Uniswap V3", feeBps: position.fee, percent: 100, kind: "position" })
  }
  if (log.tokenId && log.token === V4_POSITION_MANAGER) {
    const encoded = await call(V4_POSITION_MANAGER, V4_POSITION + pad(BigInt(log.tokenId)))
    const token0 = encoded ? addressWord(encoded, 0) : null
    const token1 = encoded ? addressWord(encoded, 1) : null
    const fee = encoded ? word(encoded, 2) : null
    if (!token0 || !token1 || fee == null) return null
    const token = wethToken(token0, token1)
    if (!token) return null
    return sighting(log, id, { pair: null, token, exchange: "Uniswap V4", feeBps: Number(fee), percent: 100, kind: "position" })
  }
  if (log.tokenId) return null
  const row = known.get(log.token)
  if (!row) return null
  const supplyHex = await call(log.token, TOTAL_SUPPLY)
  const balanceHex = await call(log.token, BALANCE_OF + padAddress(log.locker.address))
  const supply = supplyHex ? word(supplyHex, 0) : null
  const locked = balanceHex ? word(balanceHex, 0) : null
  const percent = supply != null && locked != null ? fungiblePercents({ supply, burned: BigInt(0), locked }).locked : null
  return sighting(log, id, { pair: log.token, token: row.token, exchange: row.exchange, feeBps: null, percent, kind: "fungible" })
}

function sighting(log: LockerLog, id: string, extra: Pick<LockSighting, "pair" | "token" | "exchange" | "feeBps" | "percent" | "kind">): LockSighting {
  return {
    id,
    from: log.owner,
    locker: log.locker,
    amount: log.amount,
    positionId: log.tokenId,
    unlockAt: log.unlockAt,
    block: log.block,
    tx: log.tx,
    logIndex: log.logIndex,
    ...extra,
  }
}

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

function pad(value: bigint): string {
  return value.toString(16).padStart(64, "0")
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0")
}

function word(data: string, index: number): bigint | null {
  const body = data.startsWith("0x") ? data.slice(2) : data
  const slice = body.slice(index * 64, (index + 1) * 64)
  if (!/^[0-9a-fA-F]{64}$/.test(slice)) return null
  return BigInt(`0x${slice}`)
}

function addressWord(data: string, index: number): string | null {
  const value = word(data, index)
  if (value == null) return null
  return `0x${value.toString(16).padStart(40, "0")}`.toLowerCase()
}

function seconds(value: bigint | null): number | null {
  if (value == null || value <= BigInt(0) || value > BigInt(10_000_000_000)) return null
  return Number(value) * 1000
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null
  return `0x${topic.slice(-40).toLowerCase()}`
}
