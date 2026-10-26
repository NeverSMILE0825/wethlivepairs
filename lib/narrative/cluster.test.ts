import assert from "node:assert/strict"
import test from "node:test"
import { clusterNarratives, crossChainMigration } from "./cluster"

test("related Tesla and Optimus names form one cluster without sharing a ticker", () => {
  const clusters = clusterNarratives([
    { id: "a", name: "Tesla Optimeme", symbol: "OPTIMEME", chain: "solana", createdAt: 1, deployer: "0x1" },
    { id: "b", name: "Musk Robot", symbol: "MUSKBOT", chain: "solana", createdAt: 2, deployer: "0x2" },
    { id: "c", name: "Optimus Inu", symbol: "OPTINU", chain: "ethereum", createdAt: 3, deployer: "0x3" },
    { id: "d", name: "Robotaxi Dog", symbol: "RTAXI", chain: "ethereum", createdAt: 4, deployer: "0x4" },
  ])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].name, "Tesla / Optimus Robotics")
  assert.equal(clusters[0].tokens.length, 4)
  assert.equal(clusters[0].confidence, "high")
  assert.ok(clusters[0].chains.includes("solana") && clusters[0].chains.includes("ethereum"))
})

test("generic AI tokens are not one narrative", () => {
  const clusters = clusterNarratives([
    { id: "a", name: "AI Dog", symbol: "AIDOG", chain: "solana", createdAt: 1, deployer: "0x1" },
    { id: "b", name: "AI Lawyer", symbol: "AILAW", chain: "solana", createdAt: 2, deployer: "0x2" },
    { id: "c", name: "Artificial Island", symbol: "ISLE", chain: "ethereum", createdAt: 3, deployer: "0x3" },
  ])
  assert.equal(clusters.length, 0)
})

test("a later Ethereum token is a Solana to Ethereum migration", () => {
  const first = Date.parse("2026-10-26T10:00:00Z")
  const move = crossChainMigration([
    ...Array.from({ length: 10 }, (_, index) => ({ chain: "solana", narrativeId: "x", at: first + index * 60_000 })),
    { chain: "ethereum", narrativeId: "x", at: first + 47 * 60_000 },
  ])
  assert.equal(move?.from, "solana")
  assert.equal(move?.to, "ethereum")
  assert.equal(move?.lagMinutes, 47)
  assert.equal(move?.fromCount, 10)
  assert.equal(move?.toCount, 1)
})
