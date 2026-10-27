import { onActivity, type ActivitySighting } from "@/lib/activity/bus"
import { EnrichmentEngine } from "@/lib/activity/enrichment"
import { ActivityStore, burnActivity, lockActivity, pairActivity } from "@/lib/activity/store"
import { formatDuration } from "@/lib/lp/lock-logic"

let store: ActivityStore | null = null
let engine: EnrichmentEngine | null = null

export function activityStore(): ActivityStore {
  store ??= new ActivityStore()
  return store
}

export function activityEngine(): EnrichmentEngine | null {
  return engine
}

export function applySighting(target: ActivityStore, sighting: ActivitySighting) {
  if (sighting.type === "pair") {
    const record = sighting.record
    target.ensurePair({ pair: record.address, token: record.tokenAddress, exchange: record.exchange, createdAt: record.created_at, creationBlock: record.creationBlock ?? null, token0: sighting.token0 })
    target.upsert(pairActivity(record, true))
  } else if (sighting.type === "burn") {
    const event = sighting.event
    target.ensurePair({ pair: event.pair, token: event.tokenAddress, exchange: event.exchange, createdAt: event.createdAt, creationBlock: null })
    target.upsert(burnActivity(event, true))
  } else if (sighting.type === "lock") {
    const record = sighting.record
    const lock = sighting.lock
    const position = lock.positionId ? `Position #${lock.positionId}` : "LP token"
    const percent = lock.kind === "position" ? "100% of this position" : lock.percent == null ? "Pool-wide locked N/A" : `${lock.percent}% locked`
    const unlock = lock.unlockAt == null ? "Unlock unknown" : `Unlock ${new Date(lock.unlockAt).toLocaleString()}`
    const lockedAt = Date.parse(sighting.at)
    const duration = lock.unlockAt != null && Number.isFinite(lockedAt) && lock.unlockAt > lockedAt ? `Duration ${formatDuration(lock.unlockAt - lockedAt)}` : null
    const remaining = lock.unlockAt == null ? null : lock.unlockAt <= Date.now() ? "Expired / Withdrawable" : `${formatDuration(lock.unlockAt - Date.now())} left`
    const token = record?.tokenAddress ?? lock.token
    target.upsert(lockActivity({
      id: lock.id,
      at: sighting.at,
      pair: lock.pair,
      token,
      exchange: record?.exchange || lock.exchange,
      symbol: sighting.symbol || record?.symbol || "",
      name: sighting.name || record?.tokenName || record?.name || "",
      detail: [lock.locker.name, position, percent, duration, unlock, remaining].filter((item): item is string => item != null).join(" · "),
      href: token ? `/tokens/${token}` : `https://etherscan.io/tx/${lock.tx}`,
      live: true,
      feeBps: lock.feeBps,
      createdAt: record?.created_at ?? null,
    }))
  } else {
    engine?.onHead(sighting.block)
  }
}

/** Starts Live Activity enrichment once per tab. */
export function startActivity(): () => void {
  const target = activityStore()
  engine ??= new EnrichmentEngine(target)
  engine.start()
  const off = onActivity((sighting) => applySighting(target, sighting))
  return () => {
    off()
    engine?.stop()
  }
}
