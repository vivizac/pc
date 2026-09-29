# Olli AI Privacy Gateway

## Status

Phase 2 skeleton and Phase 3 request-scoped identity are complete. Phase 4 hardens free-text de-identification and the final fail-closed egress guard without connecting the gateway to `api/chat.js` yet.

The gateway is intentionally **not connected to `api/chat.js` yet**. Existing feedback, summary, and streaming behavior remains unchanged until a later migration phase.

Voice transcription is also outside this gateway because the current Realtime transcription path sends microphone audio directly to OpenAI before text sanitization is possible.

## Server-only flow

```
raw app data
  -> ai-context-builder
  -> ai-privacy-sanitizer
  -> ai-egress-guard
  -> (future) OpenAI client
```

## Modules

- `api/_lib/ai-context-builder.cjs`
  - Builds a strict allowlisted AI context.
  - Keeps only `subject_ref`, `request_type`, optional `age_band`, optional `question`, and record `type/period/text`.
  - Does not forward record IDs, student IDs, academy IDs, names, or arbitrary source object fields.

- `api/_lib/ai-privacy-sanitizer.cjs`
  - Replaces known student aliases and configured sensitive entities.
  - Masks phone numbers, email addresses, resident-registration-number patterns, UUID-style internal identifiers, labeled birth dates, labeled addresses, and specific school/kindergarten/daycare names.
  - Operates on an AI-bound copy only; it never mutates Supabase source data.

- `api/_lib/ai-egress-guard.cjs`
  - Final fail-closed inspection.
  - Blocks forbidden identifier keys, explicit forbidden values, raw phone/email patterns, resident-registration-number patterns, UUID-style identifiers, specific school names, labeled birth dates, and labeled addresses.
  - Throws `AI_PRIVACY_EGRESS_BLOCKED` without echoing the leaked private value in the error message.

- `api/_lib/ai-request-scope.cjs`
  - Generates a fresh opaque `subject_<random>` reference for every AI request.
  - Keeps the real `studentId` and `jobId` as non-enumerable server-only properties.
  - JSON serialization exposes only the opaque subject reference, so real identity is not sent even if the scope object is serialized accidentally.

- `api/_lib/ai-privacy-gateway.cjs`
  - Orchestrates request scope -> build -> sanitize -> guard.
  - Uses a fresh request-scoped `subject_ref` and `학생A/학생B...` inside text.
  - Derives the common two-syllable given-name alias for standard three-syllable Korean names, e.g. `김민서` -> `민서`, so both forms are anonymized.

## Invariants

1. Supabase source data is never anonymized in place.
2. Privacy processing runs on the server, not only in the browser.
3. OpenAI-bound context must be allowlisted rather than forwarding raw database rows.
4. If final inspection fails, external AI transmission must stop.
5. Actual identity mappings must not be included in the AI payload.
6. Raw AI prompts and student records should not be added to operational logs.

## Current fake-data coverage

`tests/ai-privacy-gateway.test.cjs` checks:

- subject full name and alias -> `학생A`
- another student -> `학생B`
- guardian -> `보호자A`
- school -> `학교A`
- phone/email masking
- student/record IDs excluded from allowlisted context
- forbidden-key and forbidden-value blocking
- fail-closed behavior when a configured secret survives sanitization
- Korean full-name + given-name alias anonymization without client-provided aliases
- request-scoped opaque subject refs
- real `studentId/jobId` staying readable internally but absent from JSON
- multiple simultaneous request scopes receiving distinct refs with no cross-request identity leakage
- free-text resident-registration-number, UUID, birth-date, address, and specific school-name redaction
- fail-closed blocking when those high-risk patterns reach the egress guard unsanitized
- alternate structured PII fields such as guardian phone, DOB, postal code, school name, and resident-registration number
- ordinary lesson dates and generic school-stage wording remaining usable

## Next phase

Do not migrate every AI feature at once.

Phase 4 still keeps the gateway disconnected from production AI traffic. The next migration step should connect one non-streaming existing feature first, while preserving its existing feedback job/student binding. Compare output quality and privacy behavior before expanding feature-by-feature. Streaming feedback should be migrated only after the same gateway contract works for the non-streaming path.
