"use client"

import { useEffect, useRef } from "react"
import { assetFailure, reloadFresh } from "@/lib/recover"

export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  const tried = useRef(false)
  useEffect(() => {
    console.error(error)
    if (assetFailure(error) && reloadFresh()) return
    if (tried.current) return
    tried.current = true
    const again = retry ?? reset
    if (!again) return
    const timer = window.setTimeout(again, 300)
    return () => window.clearTimeout(timer)
  }, [error, retry, reset])

  return (
    <html lang="en" className="dark">
      <body style={{ margin: 0, minHeight: "100vh", background: "#0a0a0a", color: "#a3a3a3", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ margin: 0, padding: "2rem", fontSize: "14px" }}>Reconnecting…</p>
      </body>
    </html>
  )
}
