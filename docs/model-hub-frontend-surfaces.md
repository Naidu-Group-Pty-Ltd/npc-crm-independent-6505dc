# Model Hub → Front-End Surfaces Inventory (Phase 0)

Generated as the first step of the "Live Model Hub → Front-End Sync" initiative
(`.lovable/plan.md`). Every entry is a place in the client that either **shows** a
model or **lets the user pick** one. Phases 2–4 replace each of these with the
model-hub-driven `<LiveModelBadge>` or `<LiveModelChipGroup>` so a Model Hub
change is reflected within ~1s.

Legend:
- **Display** — chip / label / "powered by …" text (no user choice)
- **Picker** — user chooses per-turn / per-generation
- **Admin** — Model Hub write surface (already correct)

---

## Report Q&A (the concrete example)

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/components/report-qa/ModelSelector.tsx` | 20–133 | **Picker** | Hardcoded 4-provider dropdown. Rewrite in Phase 3 as a 4-slot picker sourced from `agent_model_assignments` (`report_qa_primary` / `_fast` / `_deep` / `_search`). |
| `src/components/report-qa/ModelBadge.tsx` | 11–66 | **Display** | Hardcoded chip on every assistant message. Becomes `<LiveModelBadge modelId={message.metadata.resolved_model_id} />`. |
| `src/components/report-qa/ModelSwitchDivider.tsx` | 15–25 | **Display** | Divider when user swaps mid-thread. Replace with `<LiveModelBadge modelId={…} />`. |
| `src/pages/ReportQA.tsx` | 222, 271, 1044, 1156, 1178, 2235–2338, 2574 | **Picker + Display** | State moves from `selectedModel: ModelProvider` → `selectedAgentKey: AgentKey`. Payload field renames `modelProvider` → `agentKey`; edge fn maps legacy values for back-compat. |
| `src/pages/ReportQA.tsx` | 2383 | **Copy** | Hardcoded "Agent tools are unavailable for Perplexity" text — becomes derived from the resolved family. |

## Aurixa Agent (chat widget + pages)

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/components/agent/AgentChatWidget.tsx` | 722 | **Display** | "Gemini · Live" pill. Replace with `<LiveModelBadge agentKey="ai_dashboard_agent" />`. |
| `src/components/agent/AgentInsights.tsx` | n/a | **Display** | Add live chip in the aurora hero band showing the assigned insight-writer model. |
| `src/pages/agent/AgentPlans.tsx` | n/a | **Display** | Add `<LiveModelBadge agentKey="agent_planner" />` next to the orb. |
| `src/pages/agent/AgentSkills.tsx` | n/a | **Display** | Show model per skill (skills call the same planner). |

## Market Updates

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/pages/MarketUpdates.tsx` | 255 | **Display** | Hardcoded "Gemini 3 Flash" badge on Ask AI. Replace with `<LiveModelBadge agentKey="market_intelligence" />` + `<ModelUpgradeButton agentKey="market_intelligence" />`. |
| `src/components/market-updates/MarketQAAnswerActions.tsx` | n/a | **Display** | Answer footer chip — pull `resolved_model_id` from the QA response. |
| `src/pages/qa/MarketQADigests.tsx` | n/a | **Display** | Digest footer — `<LiveModelBadge agentKey="market_qa_digest" />`. |
| `src/pages/qa/MarketQASubscriptions.tsx` | n/a | **Display** | Same as above per subscription. |

## Marketing Intelligence

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/components/marketing/AIDigestPanel.tsx` | 56 | **Display** | Hardcoded "Gemini 3 Flash" chip. |
| `src/components/marketing/BudgetAdvisorPanel.tsx` | 100 | **Display** | Hardcoded "Gemini 3 Flash" chip. |
| `src/components/marketing/BenchmarksPanel.tsx` | 176 | **Display** | "Perplexity Research + Citations" section header. |
| `src/components/marketing/MarketCorrelationPanel.tsx` | 237 | **Display** | "Perplexity Research" section header. |

## Reports (Investment / Comparison / Portfolio / Suburb / Cash Flow)

Add a footer chip driven by the `resolved_model_id` persisted on each report
row. Report-level `agentKey`s: `investment_report`, `comparison_report`,
`portfolio_review`, `suburb_snapshot`, `cash_flow_analysis`. All resolve
through `_shared/llmRouter.ts` today — nothing changes server-side, only the
footer display becomes live.

Related client files touched in Phase 4:
- `src/components/clients/PropertyReportGenerator.tsx` line 188 uses a
  hardcoded `model: 'google/gemini-2.5-flash'` in the client — that literal
  needs to move behind an `agentKey` and be resolved server-side.

## Email Copilot / Voice / PDF / Vision

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/pages/EmailCopilot.tsx` | 1147 | **Display** | "Call OpenAI Whisper" comment + UI copy — becomes `<LiveModelBadge agentKey="voice_transcription" />`. |
| `src/components/templateBuilder/TemplateDesignAgentPanel.tsx` | 89 | **Comment** | "Gemini accepts it" — cosmetic, add chip via `agentKey="template_design_agent"`. |
| PDF/vision extractors (`ai_doc_classifications`, VOI, OCR) | — | **Display** | Add chip per surface via `agentKey="pdf_parsing"` / `chart_analysis` / `formara_extraction`. |

## Integrations page

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/pages/Integrations.tsx` | 89, 99, 119–122 | **Display** | Brand cards are legitimate provider identity — keep as-is (they name the provider, not the assigned model). Uses `BrandMark` already. |

## Model Hub (admin write surface)

| File | Line(s) | Kind | Notes |
| --- | --- | --- | --- |
| `src/pages/ModelHub.tsx` | 84–87, 572 | **Admin** | Already correct — this is the source of truth. Phase 5 adds query invalidation + toast that names the surfaces just refreshed. |

## Error surfaces (not model chips — ignore for this project)

- `src/pages/ErrorLogs.tsx` 957–958 — provider-name string matching for error
  classification. Not a display of the *assigned* model; leave untouched.

---

## Registry of `agent_key`s referenced above

Consolidated in `src/lib/modelHub/agentKeys.ts` (created in Phase 1). Keys used
across the surfaces catalogued here:

```
report_qa_primary
report_qa_fast
report_qa_deep
report_qa_search
ai_dashboard_agent
agent_planner
market_intelligence
market_qa_digest
marketing_ai_digest
marketing_budget_advisor
marketing_benchmarks
marketing_correlation
investment_report
comparison_report
portfolio_review
suburb_snapshot
cash_flow_analysis
email_copilot
voice_transcription
template_design_agent
pdf_parsing
chart_analysis
formara_extraction
image_generation
```

Any key not yet seeded in `agent_model_assignments` will be added by the Phase 3
migration alongside the new `report_qa_*` slots.

---

## Out of scope for this initiative

- Provider brand cards on the Integrations page (identity, not assignment).
- Error-classification string matching (not a display chip).
- Anything under `src/branding/` (visual tokens, not model routing).
