VERDICT: CHANGES

# Code review (round 1)

## Test run
`npm test`: pass 17, fail 0

## Findings
- [blocker] `test/rateLimit.test.js`: AC-4 (`/health` is never limited) has no test.
