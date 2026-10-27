import assert from "node:assert/strict"
import test from "node:test"
import { concentratedLock, decodeV3Position, foldLockerLogs, formatDuration, fungiblePercents, liveLockFilter, lockState, nextUnlock, parseLockerLog, wethToken, type LockerLog } from "./lock-logic"
import { lockerByAddress } from "./lockers"

const TEAM = "0xe2fe530c047f2d85298b07d9333c05737f1435fb"
const RANDOM = "0x2222222222222222222222222222222222222222"
const HOLDER = "0x3333333333333333333333333333333333333333"

const DEPOSIT_NFT = "0x8ada5a61cb829cf6dd4a74752fd8a7524261a767c2c80ee9398343e2063ef144"
const MANAGER = "0xc36442b4a4522e871399cd717abdd847ab11fe88"

function topic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`
}

function word(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0")
}

function depositNft(id: number, tokenId: number): LockerLog | null {
  return parseLockerLog({
    address: TEAM,
    topics: [DEPOSIT_NFT, topic(MANAGER), topic(HOLDER)],
    data: `0x${word(id)}${word(tokenId)}${word(1)}${word(1_795_822_875)}`,
    blockNumber: "0x10",
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex: "0x1",
  })
}

test("a Team Finance position deposit is a lock, and a random contract is not", () => {
  assert.equal(lockerByAddress(TEAM)?.name, "Team Finance")
  assert.equal(lockerByAddress(RANDOM), null)
  const lock = depositNft(24560, 86889)
  assert.equal(lock?.locker.name, "Team Finance")
  assert.equal(lock?.tokenId, "86889")
  assert.equal(lock?.action, "lock")
  assert.equal(lock?.unlockAt, 1_795_822_875_000)
  assert.equal(parseLockerLog({ address: RANDOM, topics: [DEPOSIT_NFT, topic(MANAGER), topic(HOLDER)], data: "0x", blockNumber: "0x10", transactionHash: `0x${"ab".repeat(32)}`, logIndex: "0x1" }), null)
  const filter = liveLockFilter().params[1] as { address: string[]; topics: string[][] }
  assert.ok(filter.address.includes(TEAM))
  assert.ok(!filter.address.includes(RANDOM))
  assert.ok(filter.topics[0].includes(DEPOSIT_NFT))
})

test("a withdrawal removes the lock and does not invent one", () => {
  const deposit = depositNft(10, 200)
  assert.ok(deposit)
  const withdrawn: LockerLog = { ...deposit, action: "withdraw", amount: BigInt(0), block: 20 }
  assert.equal(foldLockerLogs([deposit, withdrawn]).length, 0)
  assert.equal(foldLockerLogs([withdrawn]).length, 0)
  assert.equal(foldLockerLogs([deposit]).length, 1)
})

test("burned and locked percentages stay separate, including a partial lock", () => {
  const split = fungiblePercents({ supply: BigInt(100000) + BigInt(1000), burned: BigInt(60000), locked: BigInt(35000) })
  assert.equal(split.burned, 60)
  assert.equal(split.locked, 35)
  const partial = fungiblePercents({ supply: BigInt(100000) + BigInt(1000), burned: BigInt(0), locked: BigInt(50000) })
  assert.equal(partial.locked, 50)
  assert.equal(fungiblePercents({ supply: BigInt(1000), burned: BigInt(1), locked: BigInt(1) }).locked, null)
})

test("one locked V3 position is not reported as the whole pool", () => {
  const locked = concentratedLock({ custodianIsLocker: true, poolMatches: true, managerMatches: true })
  assert.equal(locked.positionPercent, 100)
  assert.equal(locked.poolWidePercent, null)
  assert.deepEqual(concentratedLock({ custodianIsLocker: true, poolMatches: false, managerMatches: true }), { positionPercent: null, poolWidePercent: null })
  assert.deepEqual(concentratedLock({ custodianIsLocker: true, poolMatches: true, managerMatches: false }), { positionPercent: null, poolWidePercent: null })
  const position = decodeV3Position(`0x${word(0)}${word(0)}${topic("0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f").slice(2)}${topic("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2").slice(2)}${word(3000)}${word(0)}${word(0)}${word(1)}`)
  assert.equal(position?.fee, 3000)
  assert.equal(wethToken(position?.token0 ?? "", position?.token1 ?? ""), "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f")
  assert.equal(wethToken("0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"), null)
})

test("an expired lock stays withdrawable until a withdrawal is observed", () => {
  const now = Date.parse("2026-10-26T12:00:00Z")
  const unlock = now - 60_000
  assert.equal(lockState({ unlockAt: unlock, permanent: false, withdrawn: false, extended: false, now }), "expired")
  assert.equal(lockState({ unlockAt: unlock, permanent: false, withdrawn: true, extended: false, now }), "withdrawn")
  assert.equal(lockState({ unlockAt: null, permanent: true, withdrawn: false, extended: false, now }), "permanent")
  assert.equal(lockState({ unlockAt: now + 2 * 60 * 60 * 1000, permanent: false, withdrawn: false, extended: false, now }), "expiring-soon")
  assert.equal(lockState({ unlockAt: now + 30 * 24 * 60 * 60 * 1000, permanent: false, withdrawn: false, extended: true, now }), "extended")
  assert.equal(formatDuration(28 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000), "28d 14h")
  assert.equal(formatDuration(17 * 60 * 60 * 1000 + 31 * 60 * 1000), "17h 31m")
  const soonest = nextUnlock([
    { unlockAt: now + 180 * 24 * 60 * 60 * 1000, state: "active" },
    { unlockAt: now + 28 * 24 * 60 * 60 * 1000, state: "active" },
    { unlockAt: now - 1000, state: "expired" },
  ])
  assert.equal(soonest, now + 28 * 24 * 60 * 60 * 1000)
})
