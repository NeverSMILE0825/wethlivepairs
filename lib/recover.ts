const AT = "weth-recover-at"
const COUNT = "weth-recover-n"

/** A missing script or stylesheet after a deploy. A normal render error is not one of these. */
export function assetFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "")
  return /chunk|stylesheet|failed to load script|failed to fetch|dynamically imported|importing a module|loading css/i.test(text)
}

/**
 * Load the current deployment, not a cached copy of the previous one.
 * Returns false when this tab already tried, so a real render error cannot reload forever.
 */
export function reloadFresh(): boolean {
  try {
    const at = Number(sessionStorage.getItem(AT) || 0)
    const count = Number(sessionStorage.getItem(COUNT) || 0)
    if (count >= 2 || (at > 0 && Date.now() - at < 15_000)) return false
    sessionStorage.setItem(AT, String(Date.now()))
    sessionStorage.setItem(COUNT, String(count + 1))
    const url = new URL(window.location.href)
    url.searchParams.set("v", String(Date.now()))
    window.location.replace(url.toString())
    return true
  } catch {
    return false
  }
}

export function clearRecovery(): void {
  try {
    sessionStorage.removeItem(AT)
    sessionStorage.removeItem(COUNT)
  } catch {
    // Storage can be blocked. The page still stays up.
  }
}

const pagesBase = process.env.PAGES_BASE ?? process.env.NEXT_PUBLIC_BASE_PATH ?? ""

/** Runs before React. A missing script or stylesheet reloads the current deployment once. */
export const recoverBootScript = `(function(){var base=${JSON.stringify(pagesBase)};if(base){var orig=window.fetch;window.fetch=function(input,init){if(typeof input==="string"&&input.charAt(0)==="/"&&input.indexOf(base)!==0)input=base+input;return orig.call(this,input,init);};}function reload(){try{var at=Number(sessionStorage.getItem("${AT}")||0);var n=Number(sessionStorage.getItem("${COUNT}")||0);if(n>=2||(at>0&&Date.now()-at<15000))return;sessionStorage.setItem("${AT}",String(Date.now()));sessionStorage.setItem("${COUNT}",String(n+1));var url=new URL(location.href);url.searchParams.set("v",String(Date.now()));location.replace(url.toString());}catch(e){}}window.addEventListener("error",function(event){var target=event.target;if(!target||!target.tagName)return;var ours=typeof target.src==="string"?target.src:typeof target.href==="string"?target.href:"";if(ours&&ours.indexOf(location.origin)!==0)return;if(target.tagName==="SCRIPT")reload();if(target.tagName==="LINK"&&target.rel==="stylesheet")reload();},true);window.addEventListener("unhandledrejection",function(event){var reason=event.reason;var text=reason&&(reason.message||String(reason))||"";if(/chunk|stylesheet|failed to load script|failed to fetch|dynamically imported|importing a module|loading css/i.test(text))reload();});})();`
