# Firestore Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Strict Ownership**: Every document in `/datasets/{datasetId}`, `/datasets/{datasetId}/chunks/{chunkId}`, and `/userSettings/{userId}` belongs strictly to a single verified Firebase Auth user (`ownerId == request.auth.uid`). No cross-user reads or writes are permitted.
2. **Atomic Dataset-to-Chunk Integrity**: A `/datasets/{datasetId}/chunks/{chunkId}` document cannot be created unless its parent `/datasets/{datasetId}` exists in the same atomic write batch (`existsAfter` / `getAfter`) and has the exact same `ownerId`.
3. **Immutability & Temporal Integrity**:
   - `ownerId` and `createdAt` are immutable after document creation.
   - `createdAt` and `updatedAt` MUST equal server `request.time`.
   - `DatasetChunk` documents are strictly append-only/deletable (updates are denied).
4. **Volumetric & Schema Bounds**:
   - Every document ID matches `^[a-zA-Z0-9_\-]+$` and `<= 128` characters.
   - Every string field enforces explicit `.size()` bounds and filename/ID regex constraints; no arbitrary shadow fields are permitted (`hasAll` + `hasOnly` on create; `affectedKeys().hasOnly(...)` on update).
5. **Query Security**: `allow list` on `/datasets` and `/datasets/{datasetId}/chunks` explicitly verifies `resource.data.ownerId == request.auth.uid` without `get()` lookups; `/userSettings` forbids `list` entirely.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)

1. **Unauthenticated Read/Write**: Read `/datasets/ds_1` or write `/userSettings/uid_a` with `request.auth == null`.
2. **Unverified Email Spoof**: Write `/datasets/ds_1` with `request.auth.uid == 'uid_a'` and `request.auth.token.email_verified == false`.
3. **Identity Spoofing on Create**: User `uid_a` attempts to create `/datasets/ds_1` with `ownerId: 'uid_b'`.
4. **Shadow Field Injection on Create**: User `uid_a` creates `/datasets/ds_1` with all valid fields plus ghost field `isAdmin: true`.
5. **Client-Forged Timestamp**: User `uid_a` creates `/datasets/ds_1` with a client-supplied `createdAt` not equal to `request.time`.
6. **ID Poisoning**: User `uid_a` attempts to create `/datasets/invalid..id/../../etc` or a 200-char document ID.
7. **Orphan Chunk Creation**: User `uid_a` creates `/datasets/nonexistent_ds/chunks/chunk_0` without an atomic parent dataset document.
8. **Cross-Owner Chunk Hijack**: User `uid_b` attempts to write a chunk under `uid_a`'s dataset `/datasets/ds_owned_by_a/chunks/chunk_1`.
9. **Immutable Chunk Mutation**: User `uid_a` attempts `update` on `/datasets/ds_1/chunks/chunk_0`.
10. **Immutable Owner / CreatedAt Tampering**: User `uid_a` updates `/datasets/ds_1` attempting to alter `ownerId`, `createdAt`, or `recordCount`.
11. **Value Poisoning on Allowed Update Field**: User `uid_a` updates `/datasets/ds_1` with `filename: 12345` or a 500-char filename string.
12. **Out-of-Bounds Settings Injection / Blanket List Scraping**: User `uid_a` writes `arimaP: 999` to `/userSettings/uid_a`, or executes an unconstrained `list` query on `/userSettings` or `/datasets` belonging to `uid_b`.
