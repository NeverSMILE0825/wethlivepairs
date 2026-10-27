"use client"

import { useEffect, useRef } from "react"
import { assetFailure, reloadFresh } from "@/lib/recover"

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const tried = useRef(false)
  useEffect(() => {
    console.error(error)
    if (assetFailure(error) && reloadFresh()) return
    if (tried.current) return
    tried.current = true
    const timer = window.setTimeout(retry, 300)
    return () => window.clearTimeout(timer)
  }, [error, retry])

  return <p className="px-4 py-6 text-sm text-muted-foreground">Reading this page.</p>
}
