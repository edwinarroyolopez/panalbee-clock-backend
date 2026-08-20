# Panalbee Clock Backend

NestJS 11 API backed by MongoDB and Mongoose. Runtime routes
use `/api/v1`; tenant authority comes from a verified access token and current
database membership, while Backoffice authority uses separate internal roles.

## Setup

```bash
yarn install
cp .env.example .env
yarn db:indexes
yarn start:dev
```

Configuration is validated at startup. `MONGODB_URI`, a 32-byte minimum
`ACCESS_TOKEN_SECRET`, issuer, audience, and comma-separated `CORS_ORIGINS` are
required. Access tokens are short-lived JOSE HS256 bearer tokens. Passwords are
stored with Node scrypt hashes.

## Routes

- `GET /api/v1/health/live`, `GET /api/v1/health/ready`
- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `GET /api/v1/tenants/me`, authenticated tenant location reads and update
- `GET /api/v1/backoffice/tenants`, admin-only audited tenant status update

Unknown DTO fields are rejected. Errors use stable `reasonCode` envelopes and
include the response `x-request-id` value.

## Verification

```bash
yarn lint                 # non-mutating
yarn test:unit
yarn test:core            # isolated replica-set core/API/security checks
yarn test:integration     # replica-set-backed model and service integration
yarn test:security        # replica-set-backed tenancy and RBAC
yarn test:e2e             # all MongoDB integration/security/API suites
yarn build
yarn audit:source         # file-size and known-secret-pattern checks
```

The MongoDB scripts start an isolated `MongoMemoryReplSet`, synchronize named
indexes twice to prove idempotence, run Jest serially, and stop the replica set.
Tests inject their own `MONGODB_URI` and never load the target `.env` connection.
