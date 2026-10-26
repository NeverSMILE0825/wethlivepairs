"use client"

import { PROTOCOL_FILTERS, protocolIdentity, type ProtocolFilterId } from "@/lib/protocol/identity"

const LABEL: Record<ProtocolFilterId, string> = { all: "All", v2: "V2", v3: "V3", v4: "V4" }

export function ProtocolBadge({ exchange, feeBps, hook }: { exchange: string | null | undefined; feeBps?: number | null; hook?: string | null }) {
  if (!exchange) return null
  const identity = protocolIdentity(exchange, { feeBps, hook })
  return <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground" title={identity.title}>{identity.badge}</span>
}

export function ProtocolFilter({ value, counts, onChange }: { value: ProtocolFilterId; counts: Record<ProtocolFilterId, number>; onChange: (id: ProtocolFilterId) => void }) {
  return (
    <div className="flex flex-wrap gap-1 px-3 pt-2" role="group" aria-label="Protocol">
      {PROTOCOL_FILTERS.map((id) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${value === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
          {LABEL[id]} {counts[id]}
        </button>
      ))}
    </div>
  )
}

export function readProtocol(key: string): ProtocolFilterId {
  try {
    const saved = localStorage.getItem(key)
    return saved === "v2" || saved === "v3" || saved === "v4" ? saved : "all"
  } catch {
    return "all"
  }
}
