"use client"

export function HelpSearch() {
  return (
    <input
      type="search"
      placeholder="Search Help..."
      aria-label="Search Help"
      className="w-full max-w-md rounded-md bg-muted px-3 py-2 text-sm"
      onChange={(event) => {
        const query = event.target.value.trim().toLowerCase()
        for (const node of document.querySelectorAll("[data-help-section]")) {
          const section = node as HTMLElement
          section.hidden = query.length > 0 && !section.innerText.toLowerCase().includes(query)
        }
      }}
    />
  )
}
