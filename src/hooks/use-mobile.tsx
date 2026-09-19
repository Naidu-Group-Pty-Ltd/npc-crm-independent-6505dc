import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Read the breakpoint NOW, if there is a window to read it from.
 *
 * The state used to start `undefined` — false — and correct itself in an
 * effect, so every surface that switches layout on this hook drew its
 * desktop form for one frame on a phone and then swapped. On a register
 * that is a table flashing into a list; on a modal it is a full-width
 * dialog snapping to a sheet.
 *
 * Reading it during initialisation cannot change what the hook reports
 * after mount — the effect still owns every later answer — it only makes
 * the first answer the true one. Guarded so a non-browser environment (a
 * test runner without `matchMedia`, a server render) keeps the old
 * behaviour rather than throwing.
 */
function readIsMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  } catch {
    return false
  }
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(readIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
