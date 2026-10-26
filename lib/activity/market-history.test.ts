import assert from "node:assert/strict"
import test from "node:test"
import { mergeConditionPoints, pointsInRange, type ConditionPoint } from "./market-history"

function point(hour: number, score: number): ConditionPoint {
  return { at: `2026-10-26T${String(hour).padStart(2, "0")}:00:00Z`, score, band: "Mixed", pairs: hour, burns: 0, locks: 0, gas: null, eth1h: null, methodology: "observed-counts-v1" }
}

test("market condition history keeps every published point and does not depend on a browser", () => {
  const stored = mergeConditionPoints([], point(10, 42))
  const again = mergeConditionPoints(stored, point(11, 63))
  const third = mergeConditionPoints(again, point(12, 78))
  assert.deepEqual(third.map((item) => item.score), [42, 63, 78])
  const replaced = mergeConditionPoints(third, { ...point(12, 80) })
  assert.deepEqual(replaced.map((item) => item.score), [42, 63, 80])
  const now = Date.parse("2026-10-26T12:30:00Z")
  assert.equal(pointsInRange(replaced, now, 3 * 60 * 60 * 1000).length, 3)
})
