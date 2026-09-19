import * as React from "react"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "./input"

export interface SearchFieldProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  /** Class applied to the wrapping `.field-search` element. */
  wrapperClassName?: string
}

/**
 * Consistent, token-driven search input: a leading search icon + a muted
 * placeholder, built on the shared `.field-search` primitive and the base
 * <Input>. Prefer this over hand-rolling `<Search /> + <Input className="pl-9">`.
 */
const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, wrapperClassName, placeholder = "Search…", ...props }, ref) => (
    <div className={cn("field-search", wrapperClassName)}>
      <Search aria-hidden="true" />
      <Input ref={ref} type="search" placeholder={placeholder} className={className} {...props} />
    </div>
  )
)
SearchField.displayName = "SearchField"

export { SearchField }
