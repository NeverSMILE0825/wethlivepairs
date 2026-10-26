import assert from "node:assert/strict"
import test from "node:test"
import { formatFeeTier, matchesProtocol, pooledWethReading, protocolCounts, protocolIdentity } from "./identity"

test("protocol badges keep V2, V3 fee, and V4 hook distinct", () => {
  assert.equal(protocolIdentity("Uniswap V2").badge, "V2")
  assert.equal(protocolIdentity("Uniswap V3", { feeBps: 3000 }).badge, "V3 · 0.3%")
  assert.equal(protocolIdentity("Uniswap V4").badge, "V4")
  assert.equal(protocolIdentity("Uniswap V4", { hook: "0x1111111111111111111111111111111111111111" }).badge, "V4 · Hook")
  assert.equal(protocolIdentity("Uniswap V4", { hook: "0x0000000000000000000000000000000000000000" }).hook, false)
  assert.equal(formatFeeTier(500), "0.05%")
  assert.equal(protocolIdentity("SushiSwap").badge, "Sushi")
})

test("protocol filter counts V2, V3, and V4 without treating SushiSwap as Uniswap V2", () => {
  const exchanges = [...Array(30).fill("Uniswap V2"), ...Array(40).fill("Uniswap V3"), ...Array(10).fill("Uniswap V4"), "SushiSwap"]
  const counts = protocolCounts(exchanges)
  assert.equal(counts.all, 81)
  assert.equal(counts.v2, 30)
  assert.equal(counts.v3, 40)
  assert.equal(counts.v4, 10)
  assert.equal(matchesProtocol("Uniswap V3", "v3"), true)
  assert.equal(matchesProtocol("Uniswap V3", "v2"), false)
  assert.equal(matchesProtocol("SushiSwap", "v2"), false)
  assert.equal(matchesProtocol("SushiSwap", "all"), true)
})

test("V4 pooled WETH is not taken from the shared PoolManager balance", () => {
  assert.equal(pooledWethReading("Uniswap V4", 12).value, null)
  assert.match(pooledWethReading("Uniswap V4", 12).reason ?? "", /PoolManager/)
  assert.equal(pooledWethReading("Uniswap V3", 3.5).value, 3.5)
  assert.equal(pooledWethReading("Uniswap V2", 1).value, 1)
})
