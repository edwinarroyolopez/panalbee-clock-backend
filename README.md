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

Configuration is validated at startup. `MONGODB_URI`, 32-byte minimum access
and management secrets, issuer, audience, and comma-separated `CORS_ORIGINS`
are required. Access tokens are short-lived JOSE HS256 bearer tokens. Passwords
are stored with Node scrypt hashes.

Customer phone access sends a WhatsApp template through the tenant's active
WhatsApp channel, falling back to `WHATSAPP_PHONE_NUMBER_ID`. Configure the
approved template with `WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME` and
`WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE`; defaults are `login_otp_temp` and
`es_CO`. The template body receives the six-digit code as its first variable.

Tenant operators can cancel or reschedule active appointments only with a
required unforeseen-event reason. The appointment change is committed before
immediate notification delivery, so tenant lifecycle responses include
`notificationStatus` and `notificationErrorCode` when manual customer contact
is needed. Configure the approved `es_CO` templates with
`WHATSAPP_APPOINTMENT_RESCHEDULED_TEMPLATE_NAME` and
`WHATSAPP_APPOINTMENT_CANCELLED_TEMPLATE_NAME`. Both receive customer name,
tenant name, localized appointment time, and reason in that order. Delivery
uses the tenant's active WhatsApp channel or `WHATSAPP_PHONE_NUMBER_ID`.

Start, completion, no-show, immutable timeline, satisfaction, and private-photo
contracts are specified in [`docs/appointment-lifecycle.md`](docs/appointment-lifecycle.md).

## Routes

- `GET /api/v1/health/live`, `GET /api/v1/health/ready`
- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `GET /api/v1/tenants/me`, authenticated tenant location reads and update
- `GET /api/v1/backoffice/tenants`, admin-only audited tenant status update
- `POST /api/v1/public/:tenantSlug/customer-access/challenges`, request a
  non-enumerating WhatsApp verification challenge
- `POST /api/v1/public/:tenantSlug/customer-access/sessions`, exchange the code
  for a 12-hour opaque customer bearer
- `GET|POST /api/v1/public/:tenantSlug/customer-appointments/*`, list and manage
  only appointments owned by the verified customer
- `GET|POST /api/v1/appointments/:appointmentId/*`, tenant lifecycle, timeline,
  and private evidence

Verification codes expire after 10 minutes, allow five attempts, and are
stored only as domain-separated HMACs. Customer session tokens are returned
once and persisted only as SHA-256 hashes. MongoDB TTL indexes remove expired
challenge and session records.

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
