## What this changes

<!-- and why. If it fixes an issue, link it. -->

## Checks

- [ ] `npm run typecheck && npm run build && npm test` all pass
- [ ] A test covers this — for a bug fix, one that would have failed before it
- [ ] Any new property-scoped tool takes `site_url`, and `scripts/check-tools.mjs` counts are updated
- [ ] Docs updated where a documented claim changed (README, `.env.example`, privacy page)
- [ ] No tool calls `google.options()` (process-global; would act as the server, not the caller, in hosted mode)

## Notes for the reviewer

<!-- Anything non-obvious: a tradeoff, something you were unsure about, something you deliberately left out. -->
