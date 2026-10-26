export type ConditionPoint = {
  at: string
  score: number
  band: string
  pairs: number
  burns: number
  locks: number
  gas: number | null
  eth1h: number | null
  methodology: "observed-counts-v1"
}

const FIVE_MINUTES = 5 * 60 * 1000

export function conditionBucket(at: number): number {
  return Math.floor(at / FIVE_MINUTES)
}

/** One point per five-minute bucket. A later publish in the same bucket replaces the earlier one. */
export function mergeConditionPoints(existing: readonly ConditionPoint[], point: ConditionPoint, limit = 8_640): ConditionPoint[] {
  const bucket = conditionBucket(Date.parse(point.at))
  const next = existing.filter((item) => conditionBucket(Date.parse(item.at)) !== bucket && Number.isFinite(Date.parse(item.at)))
  next.push(point)
  next.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return next.slice(-limit)
}

export function pointsInRange(points: readonly ConditionPoint[], now: number, spanMs: number): ConditionPoint[] {
  return points.filter((point) => {
    const at = Date.parse(point.at)
    return Number.isFinite(at) && at <= now && now - at <= spanMs
  })
}
