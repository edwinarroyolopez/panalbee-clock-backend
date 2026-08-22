# Appointment lifecycle, timeline, and feedback

This document is the authoritative runtime contract for appointment outcomes,
history, satisfaction responses, and private evidence.

## Lifecycle

Persisted statuses are `PENDING`, `CONFIRMED`, `IN_PROGRESS`, `CANCELLED`,
`COMPLETED`, and `NO_SHOW`. `requiresOutcome` is not persisted. It is true when
an appointment remains in `PENDING`, `CONFIRMED`, or `IN_PROGRESS` after
`endsAt`. The corresponding derived `outcomeState` is `OUTCOME_REQUIRED`.

| Command | Accepted source | Time rule | Terminal effect |
| --- | --- | --- | --- |
| Start | `PENDING`, `CONFIRMED` | No earlier than 30 minutes before `startsAt` | Sets `IN_PROGRESS` and `startedAt` |
| Complete | `IN_PROGRESS`, or an overdue active appointment | Overdue fallback requires `endsAt <= now` | Sets `COMPLETED`, `completedAt`, and releases the availability lock |
| No-show | `PENDING`, `CONFIRMED`, `IN_PROGRESS` | Not before `startsAt` | Sets `NO_SHOW`, `noShowAt`, governed reason, and releases the lock |
| Cancel/reschedule | `PENDING`, `CONFIRMED` | Existing active-appointment rules | Preserves notification and audit behavior |

No-show reasons are `CUSTOMER_DID_NOT_ARRIVE`,
`CUSTOMER_CANCELLED_TOO_LATE`, `COULD_NOT_CONTACT_CUSTOMER`, and `OTHER`.
`OTHER` requires a non-empty note.

Lifecycle commands require an `idempotencyKey`. Replaying the same command and
payload returns the original result. Reusing the key with a different payload
returns `IDEMPOTENCY_KEY_CONFLICT`. Transactions and appointment predicates
serialize races, so only one incompatible terminal outcome can commit.

## Timeline

Timeline events are append-only. Their types are `CREATED`, `RESCHEDULED`,
`CANCELLED`, `STARTED`, `COMPLETED`, `NO_SHOW`, `EVIDENCE_ADDED`, and
`SURVEY_SUBMITTED`. Domain operations append events in the same MongoDB
transaction as their state change. Model middleware rejects update, replace,
and delete operations against timeline, evidence, and survey records.

Public timelines redact actor IDs/types, internal reasons and notes, and staff
service-evidence events. Legacy appointments receive a deterministic synthetic
created history until this idempotent backfill is run:

```bash
yarn db:backfill-appointment-timeline
```

## Feedback and evidence

Exactly one satisfaction response can be stored for a completed appointment.
Rating is an integer from 1 through 5; comment and one survey evidence ID are
optional. Submission is idempotent. The evidence must belong to the same
tenant, appointment, customer, and `SURVEY` scope.

Uploads accept one JPEG, PNG, or WEBP file up to 5 MiB. Validation checks both
declared MIME type and file signature. Metadata is immutable and stores the
Cloudinary public ID internally, but API views never expose that storage key.
Customers can access only their own `SURVEY` evidence.

Cloudinary uploads use authenticated delivery under a tenant/appointment
folder. Access endpoints return a signed URL that expires after five minutes.
The database record is committed transactionally; failed persistence triggers
best-effort asset cleanup. Configure all three values together:

```dotenv
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Missing credentials keep non-upload behavior available and return the stable
storage-unavailable error for upload attempts. Live Cloudinary smoke requires
external credentials; unit and MongoDB integration suites use injected storage.

## API and authorization

Tenant routes use the authenticated tenant bearer and role policy:

- `POST /api/v1/appointments/:id/start`
- `POST /api/v1/appointments/:id/complete`
- `POST /api/v1/appointments/:id/no-show`
- `GET /api/v1/appointments/:id/timeline`
- `POST /api/v1/appointments/:id/evidence`
- `GET /api/v1/appointments/:id/evidence/:evidenceId/access`

Public fallback management routes live under
`/api/v1/public/:tenantSlug/appointments/:id`. Reads and multipart evidence use
`X-Appointment-Management-Token`; JSON mutations place `managementToken` in the
body. Tokens never belong in URLs.

Verified customer routes live under
`/api/v1/public/:tenantSlug/customer-appointments/:id` and require the customer
bearer in `Authorization`. Timeline, evidence upload/access, and survey enforce
tenant plus customer ownership. All public feedback responses send
`Cache-Control: private, no-store`.
