# Evidence and Provenance

Every durable fact has a statement, status, source reference, and date.

## Statuses

- `confirmed`: backed by a recorded human decision or an accepted authoritative source.
- `observed`: directly seen in a run or exploration.
- `inferred`: reasoned from incomplete evidence.
- `unknown`: explicitly unresolved and represented as an open question.
- `outdated`: contradicted or suspected stale; retained until resolved.

Observation alone never defines expected behavior. When evidence conflicts, retain both records, mark stale knowledge `outdated`, and open a question. Never silently overwrite.

Deterministic assertions may use approved scenarios, recorded decisions, or confirmed authoritative requirements. Traces, reports, screenshots, and session notes are evidence of what happened, not automatic proof of what should happen.
