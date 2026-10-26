import { matchConcepts } from "@/lib/narrative/text"

/** Specific concepts that describe one story. Generic words such as AI or dog are not members. */
const FAMILIES = [
  { id: "tesla-optimus", name: "Tesla / Optimus Robotics", members: ["tesla", "elon-musk", "robot"] },
] as const

export type NarrativeObservation = {
  id: string
  name: string
  symbol: string
  chain: string
  createdAt: number
  deployer: string
  volume?: number | null
}

export type NarrativeCluster = {
  id: string
  name: string
  tokens: NarrativeObservation[]
  concepts: string[]
  chains: string[]
  deployers: number
  confidence: "high" | "low"
  breadth: "broad" | "concentrated"
  warning: string | null
}

export function clusterNarratives(tokens: readonly NarrativeObservation[]): NarrativeCluster[] {
  const grouped = new Map<string, { name: string; tokens: NarrativeObservation[]; concepts: Set<string> }>()
  for (const token of tokens) {
    const specific = matchConcepts(token.name, token.symbol, null).filter((hit) => !hit.generic)
    const family = FAMILIES.find((item) => specific.some((hit) => (item.members as readonly string[]).includes(hit.id)))
    if (!family) continue
    const bucket = grouped.get(family.id) ?? { name: family.name, tokens: [], concepts: new Set<string>() }
    bucket.tokens.push(token)
    for (const hit of specific) if ((family.members as readonly string[]).includes(hit.id)) bucket.concepts.add(hit.id)
    grouped.set(family.id, bucket)
  }
  const clusters: NarrativeCluster[] = []
  for (const [id, bucket] of grouped) {
    if (bucket.tokens.length < 2 || bucket.concepts.size < 2) continue
    const deployers = new Set(bucket.tokens.map((token) => token.deployer.toLowerCase())).size
    const volumes = bucket.tokens.map((token) => token.volume ?? 0)
    const total = volumes.reduce((sum, value) => sum + value, 0)
    const largest = volumes.reduce((max, value) => Math.max(max, value), 0)
    const concentrated = total > 0 && largest / total >= 0.9
    clusters.push({
      id,
      name: bucket.name,
      tokens: bucket.tokens,
      concepts: [...bucket.concepts],
      chains: [...new Set(bucket.tokens.map((token) => token.chain))],
      deployers,
      confidence: bucket.concepts.size >= 2 && deployers >= 2 ? "high" : "low",
      breadth: concentrated || deployers < 2 ? "concentrated" : "broad",
      warning: concentrated ? "One token accounts for at least 90% of tracked volume." : deployers < 2 ? "One deployer created these tokens." : null,
    })
  }
  return clusters
}

export type ChainHop = { chain: string; narrativeId: string; at: number }

export function crossChainMigration(events: readonly ChainHop[]): { from: string; to: string; firstAt: number; arrivedAt: number; lagMinutes: number; fromCount: number; toCount: number } | null {
  const ordered = [...events].filter((event) => Number.isFinite(event.at)).sort((a, b) => a.at - b.at)
  const first = ordered[0]
  if (!first) return null
  const arrived = ordered.find((event) => event.chain !== first.chain)
  if (!arrived) return null
  return {
    from: first.chain,
    to: arrived.chain,
    firstAt: first.at,
    arrivedAt: arrived.at,
    lagMinutes: Math.round((arrived.at - first.at) / 60_000),
    fromCount: ordered.filter((event) => event.chain === first.chain).length,
    toCount: ordered.filter((event) => event.chain === arrived.chain).length,
  }
}
