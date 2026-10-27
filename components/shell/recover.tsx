"use client"

import { Component, type ReactNode } from "react"
import { assetFailure, reloadFresh } from "@/lib/recover"

type State = { failed: boolean; attempt: number }

/** Keeps a failed section from replacing the whole document with the framework error screen. */
export class Recover extends Component<{ children: ReactNode; label: string; className?: string }, State> {
  state: State = { failed: false, attempt: 0 }
  private timer: number | null = null

  static getDerivedStateFromError(): Pick<State, "failed"> {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(error)
    if (assetFailure(error) && reloadFresh()) return
    if (this.timer != null || this.state.attempt >= 2) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))
    }, 400)
  }

  componentWillUnmount() {
    if (this.timer != null) window.clearTimeout(this.timer)
  }

  render() {
    if (this.state.failed) {
      return <div className={this.props.className ?? "min-w-0"}><p className="px-4 py-6 text-sm text-muted-foreground">Reading {this.props.label}.</p></div>
    }
    return <div key={this.state.attempt} className="contents">{this.props.children}</div>
  }
}

/** One bad card drops out. The list around it stays. */
export class ItemBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}
