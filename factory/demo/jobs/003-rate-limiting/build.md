STATUS: READY

# Build: Rate limiting (after round 1)

## Changes
- `src/middleware/rateLimit.js`: limiter, 100 req / 60 s, JSON 429 body.
- `src/app.js`: mount limiter on `/api`; `trust proxy` set to 1 hop.
- `test/rateLimit.test.js`: one test per AC.

## Acceptance criteria
| AC   | Test                                         | Result |
|------|----------------------------------------------|--------|
| AC-1 | test/rateLimit.test.js "AC-1: 101st is 429"  | pass   |
| AC-2 | test/rateLimit.test.js "AC-2: Retry-After"   | pass   |
| AC-3 | test/rateLimit.test.js "AC-3: per IP"        | pass   |
| AC-4 | test/rateLimit.test.js "AC-4: /health open"  | pass   |

## Test run
`npm test`: pass 18, fail 0

## Review responses
- security: spoofable `X-Forwarded-For` → `trust proxy` limited to 1 hop.
- code: AC-4 was untested → added the test.

## Commits
- 4e1c2aa fix: trust only one proxy hop for client IP
- 9b07d31 test: cover /health bypass
- 1f3a9e0 feat: rate limit /api per IP
