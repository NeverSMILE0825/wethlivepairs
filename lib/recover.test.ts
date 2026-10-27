import assert from "node:assert/strict"
import test from "node:test"
import { assetFailure } from "./recover"

test("a missing script after a deploy is an asset failure, and a render error is not", () => {
  assert.equal(assetFailure(new Error("Failed to load script: /_next/static/chunks/app.js")), true)
  assert.equal(assetFailure(new Error("Loading CSS chunk failed")), true)
  assert.equal(assetFailure(new Error("Failed to fetch dynamically imported module")), true)
  assert.equal(assetFailure(new TypeError("Cannot read properties of undefined (reading 'trim')")), false)
})
