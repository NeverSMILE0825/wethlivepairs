import assert from "node:assert/strict"
import test from "node:test"
import { TRANSFER_TOPIC } from "./burn-logic"
import { concentratedLock, formatDuration, fungiblePercents, liveLockFilter, lockFromMessage, lockState, nextUnlock } from "./lock-logic"
import { lockerByAddress } from "./lockers"

const TEAM = "0xe2fe530c047f2d85298b07d9333c05737f1435fb"
const RANDOM = "0x2222222222222222222222222222222222222222"
const PAIR = "0x1111111111111111111111111111111111111111"
const HOLDER = "0x3333333333333333333333333333333333333333"

function topic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`
}

function transfer(to: string, amount: bigint, position = false) {
  return {
    params: {
      result: {
        address: PAIR,
        topics: [TRANSFER_TOPIC, topic(HOLDER), topic(to), ...(position ? [topic("0x00000000000000000000000000000000000000c8")] : [])],
        data: position ? "0x" : `0x${amount.toString(16).padStart(64, "0")}`,
        blockNumber: "0x10",
        transactionHash: `0x${"ab".repeat(32)}`,
        logIndex: "0x1",
      },
    },
  }
}

test("a V2 transfer into Team Finance is a lock, and a random contract is not", () => {
  assert.equal(lockerByAddress(TEAM)?.name, "Team Finance")
  assert.equal(lockerByAddress(RANDOM), null)
  const lock = lockFromMessage(transfer(TEAM, BigInt(99000)))
  assert.equal(lock?.locker.name, "Team Finance")
  assert.equal(lock?.amount, BigInt(99000))
  assert.equal(lockFromMessage(transfer(RANDOM, BigInt(99000))), null)
  const recipients = (liveLockFilter().params[1] as { topics: [string, null, string[]] }).topics[2]
  assert.ok(recipients.some((item) => item.endsWith(TEAM.slice(2))))
  assert.ok(!recipients.some((item) => item.endsWith(RANDOM.slice(2))))
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
  const nft = lockFromMessage(transfer(TEAM, BigInt(0), true))
  assert.equal(nft?.positionId, "200")
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
