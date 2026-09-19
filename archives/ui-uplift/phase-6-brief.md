# Phase 6 — AI Surfaces

## Deliverables

New Aurixa primitives (exported from `@/components/aurixa`):

| Primitive | File | Purpose |
| --- | --- | --- |
| `SuggestionChips` | `src/components/aurixa/SuggestionChips.tsx` | Row of tappable prompt suggestions above composers. Wraps or scrolls, keyboard-accessible. |
| `ToolCallCard` | `src/components/aurixa/ToolCallCard.tsx` | Collapsed-by-default tool invocation visualisation with running/success/error/pending states, JSON input/output panels, custom `renderOutput` slot. |
| `ModelBadge` | `src/components/aurixa/ModelBadge.tsx` | Persistent chip surfacing the current Model Hub binding in every AI surface header. Optional click → Model Hub. |
| `VoiceWaveform` | `src/components/aurixa/VoiceWaveform.tsx` | Compact bar-chart for voice-to-text capture; synthetic or amplitude-driven; reduced-motion fallback. |
| `ShimmerText` | `src/components/aurixa/ShimmerText.tsx` | Thin wrapper over the shipped `.aurixa-shimmer-text` class — preferred over loading dots for streaming/thinking states. |

## Style layer

Added to `src/styles/primitives.css`:

- `@keyframes aurixa-waveform` — vertical scale pulse used by `VoiceWaveform`.
- `.aurixa-waveform-bar` — bar element applying the animation.
- Reduced-motion fallback: waveform bars freeze at 50 % scale.

## Design rules enforced

- No hardcoded palette or fonts; all tone flows through `hsl(var(--*))` and `var(--glass-*)` tokens.
- Tool cards collapsed by default per chat-ui-composition contract.
- `motion-reduce:animate-none` on every animated surface.
- 44 px effective tap targets on chips (via `py-1.5` + generous label padding).
- `ModelBadge` designed to reflect Model Hub binding changes in real time when the caller re-renders it with new props.

## Migration guidance (for later phases)

- Agent widget composer: render `SuggestionChips` above the textarea.
- Report Q&A + Copilot headers: render `ModelBadge` bound to the same source of truth already wired to the Model Hub.
- Streaming states: replace ad-hoc "Loading…" strings with `<ShimmerText>Thinking…</ShimmerText>`.
- Voice-to-text controls: swap the mic pulse for `<VoiceWaveform active={recording} />` when a capture is live.
- Tool invocations inside assistant messages should render `<ToolCallCard />` (or the AI Elements `Tool` composite when the surface has already adopted AI Elements).

## Verification

- `bunx tsgo --noEmit` → clean for all Phase 6 files.
- No existing AI surfaces migrated in this phase; behaviour of the Agent widget, Report Q&A, and Chat is unchanged.
