import assert from "node:assert/strict"
import test from "node:test"
import { NATIVE_ETH, V4_INITIALIZE_TOPIC, WETH } from "../history/plan"
import { TRANSFER_TOPIC, blocksForHours } from "../lp/burn-logic"
import { CATCHUP_HOURS, blockSpan, catchUpRange, hostsForSpan, rangeCap, readCatchUp, swapCountFrom } from "./catchup"

const HEAD = 26_400_000

test("a catch-up starts at the published block and stops a day behind at most", () => {
  const covered = HEAD - 1_000
  const range = catchUpRange(HEAD, covered)
  assert.equal(range?.to, HEAD - 12)
  assert.equal(range?.from, covered - 12 + 1)
  const stale = catchUpRange(HEAD, HEAD - blocksForHours(CATCHUP_HOURS) - 50_000)
  assert.equal(stale?.from, stale!.to - blocksForHours(CATCHUP_HOURS))
  assert.equal(catchUpRange(HEAD, HEAD), null)
})

test("a young pair is counted from creation and an older pair only adds swaps after the snapshot", () => {
  assert.deepEqual(swapCountFrom(HEAD - 100, HEAD, HEAD - 5_000, 1_800), { mode: "full", from: HEAD - 100 })
  assert.deepEqual(swapCountFrom(HEAD - 10_000, HEAD, HEAD - 4_000, 1_800), { mode: "gap", from: HEAD - 4_000 })
  assert.equal(swapCountFrom(HEAD - 10_000, HEAD, null, 1_800), null)
  assert.equal(swapCountFrom(null, HEAD, HEAD - blocksForHours(48), 1_800), null)
})

test("a V4 native ETH initialize is kept and a token-token pool is not", async () => {
  const token = "0x2222222222222222222222222222222222222222"
  const pool = "0x" + "ab".repeat(32)
  const pair = "0x1111111111111111111111111111111111111111"
  const holder = "0x3333333333333333333333333333333333333333"
  const dead = "0x" + "0".repeat(24) + "000000000000000000000000000000000000dead"
  const logs = new Map<string, unknown[]>([
    ["0x000000000004444c5dc75cb358380d2e3de08a90", [{
      address: "0x000000000004444c5dc75cb358380d2e3de08a90",
      topics: [V4_INITIALIZE_TOPIC, pool, "0x" + NATIVE_ETH.slice(2).padStart(64, "0"), "0x" + token.slice(2).padStart(64, "0")],
      data: "0x" + "00".repeat(32),
      blockNumber: "0x10",
    }, {
      address: "0x000000000004444c5dc75cb358380d2e3de08a90",
      topics: [V4_INITIALIZE_TOPIC, "0x" + "cd".repeat(32), "0x" + token.slice(2).padStart(64, "0"), "0x" + "44".repeat(32)],
      data: "0x" + "00".repeat(32),
      blockNumber: "0x11",
    }]],
    [pair, [{
      address: pair,
      topics: [TRANSFER_TOPIC, "0x" + holder.slice(2).padStart(64, "0"), dead],
      data: "0x" + BigInt(5000).toString(16).padStart(64, "0"),
      blockNumber: "0x12",
      transactionHash: "0x" + "ef".repeat(32),
      logIndex: "0x1",
    }]],
  ])
  const rpc = async (method: string, params: unknown[]) => {
    if (method === "eth_getBlockByNumber") return { timestamp: "0x65000000" }
    const filter = params[0] as { address?: string | string[] }
    const addresses = Array.isArray(filter.address) ? filter.address : [filter.address]
    return addresses.flatMap((address) => logs.get((address ?? "").toLowerCase()) ?? [])
  }
  const found = await readCatchUp(rpc, { from: 1, to: 20 }, [pair])
  assert.equal(found.pairs.length, 1)
  assert.equal(found.pairs[0]?.pair, pool)
  assert.equal(found.pairs[0]?.token, token)
  assert.equal(found.pairs[0]?.quote, "eth")
  assert.equal(found.pairs[0]?.dex, "Uniswap V4")
  assert.notEqual(found.pairs[0]?.token, WETH)
  assert.equal(found.burns.length, 1)
  assert.equal(found.burns[0]?.pair, pair)
})

test("a provider that allows only 100 blocks is read in slices", async () => {
  const token = "0x2222222222222222222222222222222222222222"
  const pool = "0x" + "ab".repeat(32)
  const spans: number[] = []
  const rpc = async (method: string, params: unknown[]) => {
    if (method === "eth_getBlockByNumber") return { timestamp: "0x65000000" }
    const span = blockSpan(method, params)
    if ((span ?? 0) > 100) throw new Error("ranges over 100 blocks are not supported on free plan")
    spans.push(span ?? 0)
    const filter = params[0] as { fromBlock?: string; toBlock?: string }
    const from = Number.parseInt(filter.fromBlock ?? "", 16)
    const to = Number.parseInt(filter.toBlock ?? "", 16)
    if (from > 16 || to < 16) return []
    return [{
      address: "0x000000000004444c5dc75cb358380d2e3de08a90",
      topics: [V4_INITIALIZE_TOPIC, pool, "0x" + NATIVE_ETH.slice(2).padStart(64, "0"), "0x" + token.slice(2).padStart(64, "0")],
      data: "0x" + "00".repeat(32),
      blockNumber: "0x10",
    }]
  }
  const found = await readCatchUp(rpc, { from: 1, to: 250 }, [])
  assert.equal(found.pairs.length, 1)
  assert.equal(found.pairs[0]?.quote, "eth")
  assert.ok(spans.every((span) => span <= 100))
  assert.ok(spans.length > 1)
})

test("a host capped at 100 blocks is not asked for a wider slice", () => {
  const caps = new Map([["https://eth.drpc.org", 100]])
  const hosts = ["https://rpc.mevblocker.io", "https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"]
  assert.deepEqual(hostsForSpan(hosts, caps, 421), ["https://rpc.mevblocker.io", "https://ethereum-rpc.publicnode.com"])
  assert.deepEqual(hostsForSpan(hosts, caps, 100), hosts)
  assert.equal(rangeCap("ranges over 100 blocks are not supported on free plan"), 100)
  assert.equal(blockSpan("eth_blockNumber", []), null)
})
