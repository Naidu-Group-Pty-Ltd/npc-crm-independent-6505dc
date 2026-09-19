/**
 * Which customer the report is about — typed, not scrolled.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 * A plain drop-down listing every open case in whatever order the server
 * returned it. On a tenant with two hundred customers that is not a picker:
 * there is no way to type a name, and no way to reach a customer by the
 * Passport reference an operator is reading off another screen — which is
 * how a reference is normally carried between screens.
 *
 * ── The rule is not this component's ──────────────────────────────────
 * Matching goes through `caseSearch.pure.ts`, which the Compliance Passport
 * register uses as well. A customer who can be found on one screen and not
 * on another is how an operator concludes a case does not exist, so there is
 * one rule and both surfaces import it.
 *
 * ── It searches, it does not fetch ────────────────────────────────────
 * The list is the one the page already loaded. This filters it in the
 * browser and never queries on a keystroke, so nothing here can leave a
 * customer's name in a request log, and typing cannot fail.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { caseSearchLabel, filterCases, type SearchableCase } from "@/lib/aml/caseSearch.pure";

export interface PickerCase extends SearchableCase {
  id: string;
}

export function AustracCustomerPicker({
  id, cases, value, onChange, disabled,
}: {
  /** Carries the field's own label. A `<button>` is labelable. */
  id: string;
  cases: PickerCase[];
  value: string | null;
  onChange: (caseId: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => cases.find((c) => c.id === value) ?? null, [cases, value]);
  const matches = useMemo(() => filterCases(cases, query), [cases, query]);

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected
                ? caseSearchLabel(selected)
                : "Search by customer name or Passport reference"}
            </span>
            <ChevronsUpDown aria-hidden className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] min-w-[18rem] p-0"
        >
          {/*
            `shouldFilter={false}` because the matching rule is the register's
            own and lives in one module. cmdk's default scorer would be a
            second, different answer to "is this the customer they meant".
          */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type a name or a Passport reference…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                <span className="flex flex-col items-center gap-1 px-4 py-3 text-center">
                  <Search aria-hidden className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">No customer matches that.</span>
                  <span className="text-xs text-muted-foreground">
                    Try part of the name, or the Passport reference with or without its hyphens.
                  </span>
                </span>
              </CommandEmpty>
              <CommandGroup>
                {matches.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => { onChange(c.id); setOpen(false); setQuery(""); }}
                  >
                    <Check
                      aria-hidden
                      className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.subject_display_name ?? "Unnamed customer"}</span>
                      {c.case_reference && (
                        // `opacity`, not `text-muted-foreground`: the item's
                        // own selected state repaints the foreground, and a
                        // fixed muted colour stays put underneath it — the
                        // reference went unreadable on the highlighted row,
                        // which is the row an operator is looking at.
                        <span className="block truncate text-xs opacity-70">
                          {c.case_reference}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/*
        Clearing is its own control rather than a "Not yet chosen" row in the
        list. A row that unsets the field sits among the customers and reads
        like one of them, and it is the only row in that list that can undo
        work rather than record it.
      */}
      {selected && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear the selected customer"
          onClick={() => onChange(null)}
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
