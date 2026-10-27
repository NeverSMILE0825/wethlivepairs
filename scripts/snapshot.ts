import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { mergeConditionPoints, type ConditionPoint } from "../lib/activity/market-history"
import { launchScore } from "../lib/activity/pulse"
import { buildSignals } from "../lib/activity/signals"
import { fetchPairDetails } from "../lib/details"
import { fetchGasTracker } from "../lib/market/gas-tracker"
import { fetchGasTrackerBrowser, fetchGasTrackerGist } from "./gas-live"
import { freshMarketStatus } from "../lib/market/server"
import { defaultFetch } from "../lib/market/types"
import { buildPumpSeed } from "../lib/pump/sample"
import { captureHistory } from "../lib/narrative/engine"
import { fetchNews } from "../lib/narrative/rss"
import type { HistoryPoint, SnapshotFile } from "../lib/narrative/types"
import { scanChain } from "../lib/lp/chain-scan"
import { knownPairs, loadRecentLocks, publicRpc } from "../lib/lp/lock-feed"
import { applyChainBurns, buildLpBurns } from "../lib/lp/monitor"
import { HISTORY_RETAIN_MS, HISTORY_SCOPE, mergeRecords, openHistoryJob } from "../lib/history/plan"
import { enrichIdentity, readHead, scanHistoricalBurns, scanHistoricalPairs } from "../lib/history/scan"
import { collectWethPairs } from "../lib/scrape"
import { COLLECTION_MAX_HOURS, EMPTY_DETAIL, normalizeLp, type PairRecord } from "../lib/types"

const PREVIOUS_URL = "https://wethlivepairs.site/data/snapshot.json"
const HISTORY_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000
const HISTORY_MAX_POINTS = 700

async function main() {
  const requested = Number(process.env.SNAPSHOT_HOURS)
  const hours =
    Number.isFinite(requested) && requested > 0 && requested <= COLLECTION_MAX_HOURS
      ? requested
      : COLLECTION_MAX_HOURS

  const generatedAt = new Date().toISOString()
  const generatedMs = Date.parse(generatedAt)
  const previousP = loadPrevious()
  const newsP = fetchNews(generatedMs)
  console.log(`Collecting WETH pairs for the last ${hours} hours...`)
  const listingP = collectWethPairs(hours)
  const previous = await previousP
  const liveStarted = Date.now()
  const liveP = scanChain(previous?.rows ?? [], previous?.chain ?? null, new Date(generatedAt))
    .then((result) => {
      console.log(`[LP-MONITOR] Known-pair scan finished in ${Date.now() - liveStarted}ms, before market details.`)
      return result
    })
    .catch((error: unknown) => {
      console.warn(`[LP-MONITOR] Scan stopped. Checkpoint kept. ${error instanceof Error ? error.message : "unknown error"}`)
      return null
    })
  const listing = await listingP
  const { rows, scanned } = listing
  if (!listing.listingComplete) {
    console.warn(`[HISTORY] DEXTools live listing ended at ${listing.listingOldestAt ?? "unknown"} before the ${hours}h cutoff. Older pairs require the Ethereum backfill.`)
  }
  console.log(`Matched ${rows.length} WETH pairs after scanning ${scanned} pools. Loading details while the chain scan continues...`)
  const detailsP = fetchPairDetails(rows.map((row) => row.address))
  const [live, details, news] = await Promise.all([liveP, detailsP, newsP])
  const records: PairRecord[] = rows.map((row) =>
    normalizeLp({ ...row, ...(details[row.address.toLowerCase()] ?? { ...EMPTY_DETAIL }) }),
  )
  const retained = retainPairs(records.map((row) => ({ ...row, listingSource: row.listingSource ?? "dextools" })), previous?.rows, generatedMs)
  let chain = live?.checkpoint ?? previous?.chain
  let chainBurns: Awaited<ReturnType<typeof scanChain>>["burns"] = live?.burns ?? []
  if (chain?.lastError) console.warn(`[LP-MONITOR] ${chain.lastError}`)
  else if (chain) console.log(`[LP-MONITOR] Checkpoint ${chain.lpMonitorBlock ?? "unset"} · head ${chain.headBlock ?? "unknown"}`)
  const alreadyWatched = new Set((previous?.rows ?? []).map((row) => row.address.toLowerCase()))
  const fresh = retained.filter((row) => !alreadyWatched.has(row.address.toLowerCase()))
  if (fresh.length > 0 && chain?.headBlock != null) {
    try {
      const extra = await scanChain(fresh, { ...chain, lpMonitorBlock: Math.max(0, chain.headBlock - 400) }, new Date(generatedAt))
      const kept = chain.lpMonitorBlock
      if (extra.checkpoint.lpMonitorBlock != null && (kept == null || extra.checkpoint.lpMonitorBlock >= kept)) chain = extra.checkpoint
      chainBurns = [...chainBurns, ...extra.burns]
      console.log(`[LP-MONITOR] New pairs scanned: ${fresh.length}`)
    } catch (error) {
      console.warn(`[LP-MONITOR] New-pair scan stopped. ${error instanceof Error ? error.message : "unknown error"}`)
    }
  }
  let backfill = previous?.backfill
  let historicalRows = retained
  let historicalBurns = chainBurns
  try {
    const head = chain?.headBlock ?? await readHead()
    const pairJob = openHistoryJob("weth-pairs", head, generatedAt, previous?.backfill?.pairs)
    const burnJob = previous?.backfill?.burns
      ? openHistoryJob("lp-burns", head, generatedAt, previous.backfill.burns)
      : { ...pairJob, id: "lp-burns" as const, status: "running" as const, phase: "recent" as const, cursor: pairJob.recentStart, blocksDone: 0, pairsFound: 0, burnsFound: 0, error: null, stage: "Scanning historical LP transfers to burn addresses", startedAt: generatedAt, updatedAt: generatedAt }
    const pairScan = pairJob.status === "completed" ? { job: pairJob, pairs: [] as PairRecord[] } : await scanHistoricalPairs(pairJob, new Date(generatedAt))
    historicalRows = mergePairs(retained, pairScan.pairs)
    historicalRows = await enrichIdentity(historicalRows)
    const knownPairs = new Set(historicalRows.filter((row) => row.exchange !== "Unknown DEX").map((row) => row.address.toLowerCase()))
    const burnScan = burnJob.status === "completed" ? { job: burnJob, burns: [] as typeof chainBurns } : await scanHistoricalBurns(burnJob, knownPairs, new Date(generatedAt))
    historicalBurns = [...chainBurns, ...burnScan.burns]
    backfill = {
      pairs: { ...pairScan.job, pairsFound: historicalRows.filter((row) => row.listingSource === "ethereum-pair-created").length },
      burns: burnScan.job,
      scope: HISTORY_SCOPE,
      providerNote: listing.listingComplete ? null : `DEXTools live listing oldest pool: ${listing.listingOldestAt ?? "unknown"}.`,
    }
    console.log(`[HISTORY] Pairs ${pairScan.job.phase} ${pairScan.job.blocksDone}/${pairScan.job.blocksTotal}. Burns ${burnScan.job.phase} ${burnScan.job.blocksDone}/${burnScan.job.blocksTotal}.`)
  } catch (error) {
    console.warn(`[HISTORY] Backfill paused. Live snapshot still publishes. ${error instanceof Error ? error.message : "unknown error"}`)
  }
  const withChain = applyChainBurns(historicalRows, historicalBurns)
  let lpLocks: NonNullable<SnapshotFile["lpLocks"]> = []
  try {
    const found = await loadRecentLocks(publicRpc, knownPairs(withChain))
    lpLocks = found.map(({ lock, at, symbol, name, createdAt }) => ({
      id: lock.id,
      at,
      pair: lock.pair,
      token: lock.token,
      exchange: lock.exchange,
      symbol,
      name,
      locker: lock.locker.name,
      positionId: lock.positionId,
      percent: lock.percent,
      unlockAt: lock.unlockAt == null ? null : new Date(lock.unlockAt).toISOString(),
      tx: lock.tx,
      feeBps: lock.feeBps,
      createdAt,
    }))
    console.log(`[LP-LOCK] ${lpLocks.length} active WETH locks from verified lockers`)
  } catch (error) {
    console.warn(`[LP-LOCK] Lock scan skipped. ${error instanceof Error ? error.message : "unknown error"}`)
  }
  const history = trimHistory([...(previous?.history ?? []), captureHistory(withChain, generatedAt)], generatedMs)
  const lp = buildLpBurns(withChain, previous, generatedAt, historicalBurns)
  for (const event of lp.events.filter((event) => event.kind === "newly-burned" && event.detectedAt === generatedAt)) {
    console.log(`[LP-BURN] New event saved ${event.pair} ${event.burnTx ?? "no-tx"}`)
  }
  const snapshot: SnapshotFile = {
    generatedAt,
    hours,
    scanned,
    rows: withChain,
    news,
    history,
    lpBurns: lp.events,
    lpLocks,
    lpScan: lp.scan,
    chain,
    backfill,
  }
  try {
    snapshot.signals = buildSignals(snapshot)
  } catch (error) {
    console.warn(`[ACTIVITY] Signals skipped. ${error instanceof Error ? error.message : "unknown error"}`)
  }
  const file = path.join("public", "data", "snapshot.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(snapshot))
  const ethUsd = await writeMarket()
  await writeConditionHistory(withChain, lp.events, generatedAt)
  await writePumpers(withChain, ethUsd)
  await writeGasTracker()
  console.log(
    `Wrote ${file} (${records.length} rows, ${news.length} headlines, ${history.length} history points, ${lp.events.length} LP burns).`,
  )
}

/** Seed for the header so a first visit shows ETH and gas before the browser's own refresh answers. */
async function writeMarket(): Promise<number | null> {
  try {
    const status = await freshMarketStatus()
    await writeFile(path.join("public", "data", "market.json"), JSON.stringify(status))
    console.log(`[MARKET] ETH ${status.eth.data?.priceUsd ?? "unavailable"} via ${status.eth.data?.source ?? "-"} · gas ${status.gas.data?.standard.gwei.toFixed(4) ?? "unavailable"} gwei via ${status.gas.data?.source ?? "-"}`)
    return status.eth.data?.priceUsd ?? null
  } catch (error) {
    console.warn(`[MARKET] Seed skipped. ${error instanceof Error ? error.message : "unknown error"}`)
    return null
  }
}

/** Append one published market-condition point. A failed read starts a new file and never fails the snapshot. */
async function writeConditionHistory(rows: PairRecord[], burns: { burnAt?: string | null; detectedAt?: string | null }[], generatedAt: string) {
  const file = path.join("public", "data", "market-conditions.json")
  const now = Date.parse(generatedAt)
  const hour = 60 * 60 * 1000
  const inside = (at: number, start: number) => Number.isFinite(at) && at <= start + hour && at > start
  const pairs1h = rows.filter((row) => inside(Date.parse(row.created_at), now - hour)).length
  const pairsPrevious = rows.filter((row) => inside(Date.parse(row.created_at), now - 2 * hour)).length
  const burnTime = (event: { burnAt?: string | null; detectedAt?: string | null }) => Date.parse(event.burnAt || event.detectedAt || "")
  const burns1h = burns.filter((event) => inside(burnTime(event), now - hour)).length
  const burnsPrevious = burns.filter((event) => inside(burnTime(event), now - 2 * hour)).length
  let gas: number | null = null
  let eth1h: number | null = null
  let eth24h: number | null = null
  try {
    const status = JSON.parse(await readFile(path.join("public", "data", "market.json"), "utf8")) as { gas?: { data?: { standard?: { gwei?: number } } }; eth?: { data?: { change1h?: number; change24h?: number } } }
    gas = status.gas?.data?.standard?.gwei ?? null
    eth1h = status.eth?.data?.change1h ?? null
    eth24h = status.eth?.data?.change24h ?? null
  } catch {
    gas = null
  }
  const scored = launchScore({ pairs1h, pairsPrevious, pairsBaseline: null, burns1h, burnsPrevious, burnsBaseline: null, tx1h: null, txPrevious: null, txBaseline: null, netWeth: null, medianMultiple: null, above12Share: null, gasGwei: gas, eth1h, eth24h })
  const point: ConditionPoint = { at: generatedAt, score: scored.score, band: scored.band, pairs: pairs1h, burns: burns1h, locks: rows.filter((row) => row.lpStatus === "locked").length, gas, eth1h, methodology: "observed-counts-v1" }
  let existing: ConditionPoint[] = []
  try {
    const response = await fetch("https://wethlivepairs.site/data/market-conditions.json")
    if (response.ok) {
      const body = await response.json() as { points?: ConditionPoint[] }
      if (Array.isArray(body.points)) existing = body.points
    }
  } catch {
    existing = []
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ points: mergeConditionPoints(existing, point) }))
    console.log(`[MARKET] History ${point.score} / 100 · pairs ${pairs1h} · burns ${burns1h}`)
  } catch (error) {
    console.warn(`[MARKET] History skipped. ${error instanceof Error ? error.message : "unknown error"}`)
  }
}

/** Etherscan's gas guzzler and spender tables. A failed read keeps the last file and never fails the snapshot. */
async function writeGasTracker() {
  const file = path.join("public", "data", "gas-tracker.json")
  try {
    const board = await readGasTracker()
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(board))
    console.log(`[GAS] Tracker block ${board.block ?? "?"} · ${board.guzzlers.length} guzzlers · ${board.spenders.length} spenders`)
  } catch (error) {
    let kept = false
    try {
      await access(file)
      kept = true
    } catch {
      kept = false
    }
    console.warn(`[GAS] Tracker skipped. ${error instanceof Error ? error.message : "unknown error"}${kept ? " Keeping the last table." : ""}`)
  }
}

async function readGasTracker() {
  try {
    return await fetchGasTracker()
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.warn(`[GAS] Direct read failed. ${message} Retrying with a browser request.`)
  }
  try {
    return await fetchGasTrackerBrowser()
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.warn(`[GAS] Browser read failed. ${message} Reading the last published table.`)
    return fetchGasTrackerGist()
  }
}

/** Historical reserve buckets for Top Pumpers. A failed read skips the seed and never fails the snapshot. */
async function writePumpers(rows: PairRecord[], ethUsd: number | null) {
  try {
    if (ethUsd == null || !(ethUsd > 0)) {
      console.warn("[PUMP] Seed skipped. No ETH price.")
      return
    }
    const seed = await buildPumpSeed({ rows, fetcher: defaultFetch, ethUsd, budgetMs: 20_000 })
    await writeFile(path.join("public", "data", "pumpers.json"), JSON.stringify(seed))
    console.log(`[PUMP] ${seed.points.length} price points across ${seed.decimals ? Object.keys(seed.decimals).length : 0} tokens`)
  } catch (error) {
    console.warn(`[PUMP] Seed skipped. ${error instanceof Error ? error.message : "unknown error"}`)
  }
}

async function loadPrevious(): Promise<SnapshotFile | null> {
  try {
    const response = await fetch(PREVIOUS_URL, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    const payload = (await response.json()) as SnapshotFile
    return Array.isArray(payload.history) ? payload : { ...payload, history: [] }
  } catch (error) {
    console.warn(`Previous snapshot was not loaded: ${error instanceof Error ? error.message : "unknown error"}`)
    return null
  }
}

function retainPairs(current: PairRecord[], previous: PairRecord[] | undefined, now: number): PairRecord[] {
  const seen = new Set(current.map((row) => row.address.toLowerCase()))
  const extra = (previous ?? []).filter((row) => {
    const at = Date.parse(row.created_at)
    return !seen.has(row.address.toLowerCase()) && Number.isFinite(at) && now - at <= HISTORY_RETAIN_MS
  })
  if (extra.length > 0) console.log(`[LP-MONITOR] Kept ${extra.length} stored pairs that this listing page did not return`)
  return [...current, ...extra]
}

function mergePairs(current: PairRecord[], extra: PairRecord[]): PairRecord[] {
  return mergeRecords(current, extra)
}

function trimHistory(points: HistoryPoint[], now: number): HistoryPoint[] {
  return points
    .filter((point) => Number.isFinite(Date.parse(point.at)) && now - Date.parse(point.at) <= HISTORY_MAX_AGE_MS)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-HISTORY_MAX_POINTS)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
