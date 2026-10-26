import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { FEATURES } from "./registry"

test("every registered feature has a Help section", () => {
  const help = readFileSync(new URL("../../app/help/page.tsx", import.meta.url), "utf8")
  for (const feature of FEATURES) {
    assert.match(help, new RegExp(`id=["']${feature.helpAnchor}["']`), `${feature.name} is missing #${feature.helpAnchor}`)
  }
})
