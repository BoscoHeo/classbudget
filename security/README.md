# SEC-3B proposed Rules and operating limits

`firestore.sec3b.rules` is a review candidate only. The root `firestore.rules`
is unchanged. No deployment configuration points at this candidate.

Existing required receipt fields remain `id`, `date`, `amount`, `item`, `store`,
`category`, `memo`; optional fields remain `createdAt`, `updatedAt`. Images,
PDFs, API keys, arbitrary extra fields and `proofType` remain excluded from cloud
documents (the application keeps proof information in `memo`).

The candidate adds nonnegative finite-range amounts/budgets (up to JS safe integer
maximum; fractional amounts remain supported), nonempty item, known categories,
and actual Gregorian calendar validation for YYYY-MM-DD, including leap years.
It keeps ownership, migration prerequisites, text lengths and deletion permissions.

Compatibility risk: formerly accepted negative amounts, impossible dates, empty
items, unknown categories and over-range budgets cannot be written under this
candidate. Existing documents are not modified; owner reads/deletes still work,
and updates can correct an invalid document. Review aggregate validation results
in an approved environment before any deployment. Refund/negative-amount workflows
require a separate business decision; the current UI and SEC-2 validator reject
negative amounts. No real user document scan was performed.

## Real usage controls

The migration marker's 450 count is not a trustworthy per-user storage quota.
Client-side buttons, busy flags and counters can be bypassed. The retained
transaction checks prevent accidental overwrites, not authenticated request abuse.

App Check can reduce calls from untrusted apps but is not a per-user rate limiter.
Stage client attestation and monitoring before considering enforcement; no App
Check production setting or integration is changed in this branch. Project-level
free quotas can protect against billing but leave shared availability vulnerable;
the SEC-3A observation of disabled billing is a dated snapshot, not a permanent cap.

A strict per-user count/rate limit needs trusted state (e.g. a counter document in
the existing Firestore, updated transactionally and enforced by Rules) or a trusted
server. Global listing/read quotas are harder to enforce with Rules alone. Such
schema/operating changes are out of this minimal branch; they need a separate
design, conflict tests, migration plan and approval. Do not declare safety based
on client-only restrictions. No new server/database/auth is introduced here.

## Local-data policy

Local-only legacy data keeps its original keys. Account-local data uses separate
UID keys, is not merged with legacy data, and is removed on account exit. Export a
JSON backup before login if you want to restore legacy data into your account's
local area, then use the existing explicit cloud migration function. Logging out
never deletes Firestore documents or downloaded files.

Local-only recovery after logout requires a deliberate ownership confirmation;
it is not authentication. Neither UID prefixes nor a confirmation dialog encrypt
browser storage or protect it from a person controlling the same browser profile.
Use separate OS/browser profiles for strong device isolation.
