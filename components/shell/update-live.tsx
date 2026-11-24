"use client"

import { useLpMonitor } from "@/components/lp/monitor-context"

export function UpdateLiveButton() {
  const { refreshLive, catching, catchError } = useLpMonitor()
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void refreshLive()}
        disabled={catching}
        title={catchError ?? "Read pairs, LP burns, locks, and the latest transaction, reserve, and holder figures from Ethereum."}
        className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-60"
      >
        {catching ? "Updating…" : "Update"}
      </button>
      {catchError ? <span className="max-w-40 truncate text-[10px] text-amber-600 dark:text-amber-400" title={catchError}>Update failed</span> : null}
    </span>
  )
}
