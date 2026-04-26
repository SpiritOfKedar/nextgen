# Boltly NextGen (Unified Project)

End-to-end AI builder platform with:
- a `frontend/` React + Vite client
- a `backend/` Express + TypeScript API
- Supabase Postgres + Storage persistence
- Clerk auth
- multi-provider LLM streaming (OpenAI, Anthropic, Gemini)
- WebContainer sandbox boot/install/snapshot reuse

This README is the single source of truth for architecture, data flow, setup, and operations.

---

## Table of Contents

- Overview
- Repository Layout
- System Architecture
- End-to-End Flows
- API Surface
- Data Model (Conceptual)
- Environment Variables
- Local Development
- Build, Test, and Production Notes
- Troubleshooting
- Security and Reliability Notes
- Roadmap Ideas

---

## Overview

Boltly NextGen lets users chat with an AI to plan/build apps. The backend streams model output while the frontend:
- renders assistant markdown in real time
- extracts structured `boltAction` artifacts from the stream
- writes generated files into a browser WebContainer
- runs shell commands (`npm install`, `npm run dev`) in sandbox
- keeps thread-specific terminal/session state and recovery trails

The platform supports two conversation modes:
- `plan`: architectural reasoning and implementation planning (no file/shell actions expected)
- `build`: actionable generation with file and shell operations

---

## Repository Layout

> There is **no root `package.json`**. Run commands from `frontend/` or `backend/`.

```text
boltly-nextgen/
  frontend/                 # React + Vite UI, WebContainer runtime, chat UX
  backend/                  # Express API, LLM orchestration, persistence
  README.md                 # Unified documentation (this file)
```

High-value frontend modules:
- `frontend/src/hooks/useChat.ts` – chat orchestration, stream parsing, sandbox lifecycle, dependency snapshot logic
- `frontend/src/components/Chat/*` – chat panel, input, messages, mode/model controls
- `frontend/src/components/Workbench/*` – editor, preview, terminal UI
- `frontend/src/store/*` – Jotai atoms for chat, files, sandbox runtime

High-value backend modules:
- `backend/src/controllers/chatController.ts` – streaming chat endpoints
- `backend/src/services/chatService.ts` – provider selection, mode policy, persistence pipeline
- `backend/src/controllers/sandboxController.ts` – dependency plan/snapshot APIs
- `backend/src/controllers/terminalController.ts` – terminal events + recovery audits
- `backend/src/repositories/*` – thread/message/file/blob/session persistence
- `backend/src/config/db.ts` – Postgres + Supabase client init/fallback behavior

---

## System Architecture

```mermaid
flowchart LR
  U[User] --> FE[Frontend React App]
  FE -->|Bearer token| BE[Backend API /api]
  BE --> CK[Clerk Auth]
  BE --> DB[(Supabase Postgres)]
  BE --> ST[(Supabase Storage)]
  BE --> AI1[OpenAI]
  BE --> AI2[Anthropic]
  BE --> AI3[Google Gemini]
  FE --> WC[WebContainer Sandbox]
  FE -->|snapshot metadata/archives| BE
  BE -->|dependency plan + snapshot| FE
```

### Responsibilities Split

- **Frontend**
  - Auth bootstrap + route transitions (`/` and `/builder`)
  - Streaming UI rendering
  - Bolt artifact parsing + file tree updates
  - WebContainer install/dev-server lifecycle
  - Local snapshot cache (IndexedDB) and remote snapshot reuse handshake
  - Terminal telemetry + auto-recovery trigger

- **Backend**
  - Token-guarded API surface (Clerk middleware)
  - Thread + message sequencing with advisory locks
  - Streaming model responses
  - File version + shell command persistence
  - Plan/build mode policy enforcement
  - Sandbox dependency metadata + snapshot object storage
  - Terminal event/recovery audit persistence

---

## End-to-End Flows

## 1) User Sends a Prompt

```mermaid
sequenceDiagram
  participant User
  participant FE as Frontend
  participant BE as Backend
  participant LLM as Provider
  participant DB as Postgres

  User->>FE: Enter prompt (+ optional attachments)
  FE->>BE: POST /api/chat (message, threadId, model, mode, attachments)
  BE->>DB: allocate seq + insert user + assistant(streaming)
  BE->>LLM: start streaming completion
  loop streaming
    LLM-->>BE: text delta
    BE-->>FE: chunked text/plain stream
    BE->>DB: batch insert message_chunks
  end
  BE->>DB: finalize assistant + file_versions + shell_commands
  FE->>FE: parse bolt actions, write files, run shell in sandbox
```

Key behavior:
- Backend persists content safely even on interruptions (`streaming` -> `aborted`/`error` when needed).
- Frontend performs optimistic UI update and progressively hydrates assistant output.
- In `build` mode, generated files/shell commands are executed in sandbox context.

## 2) Thread Reload / Restore

```mermaid
sequenceDiagram
  participant FE as Frontend
  participant BE as Backend
  participant DB as Postgres
  participant WC as WebContainer

  FE->>BE: GET /api/chat/:threadId
  FE->>BE: GET /api/chat/:threadId/files or /files/delta
  BE->>DB: read thread messages + snapshot/delta
  BE-->>FE: messages + file payloads
  FE->>WC: write/update files
  FE->>FE: resolve dependency fingerprint
  FE->>BE: GET /api/sandbox/dependencies/:fingerprint
  FE->>BE: GET /api/sandbox/snapshots/:fingerprint (if available)
  FE->>WC: restore node_modules or run install
  FE->>WC: npm run dev
```

## 3) Sandbox Dependency Snapshot Loop

```mermaid
flowchart TD
  A[Compute dep fingerprint] --> B{Local node_modules + marker match?}
  B -- yes --> R[Reuse local deps]
  B -- no --> C{IndexedDB snapshot hit?}
  C -- yes --> D[Restore snapshot to WebContainer]
  C -- no --> E{Remote snapshot available?}
  E -- yes --> F[Download + restore]
  E -- no --> G[npm install]
  D --> H[npm run dev]
  F --> H
  G --> I[Create snapshot archive]
  I --> J[Save IndexedDB + upload remote]
  J --> H
```

## 4) Terminal Recovery Audit Flow

- Frontend reports terminal events to:
  - `POST /api/terminal/:threadId/events`
- On detected runtime issue, frontend runs planned recovery commands and logs:
  - `POST /api/terminal/:threadId/recovery-audits`
- Session replay endpoint:
  - `GET /api/terminal/:threadId/session`

---

## API Surface

Base URL (local): `http://localhost:3001/api`

### Auth
- `POST /auth/sync` – ensure Clerk user is mirrored to internal user row

### Chat
- `POST /chat` – send user prompt, stream assistant response
- `GET /chat/history` – list user threads
- `GET /chat/:threadId` – fetch thread messages
- `GET /chat/:threadId/files` – full current thread snapshot
- `GET /chat/:threadId/files/delta?sinceSeq=<n>` – incremental file changes

### Terminal
- `GET /terminal/:threadId/session`
- `POST /terminal/:threadId/events`
- `POST /terminal/:threadId/recovery-audits`

### Sandbox Cache/Snapshot
- `GET /sandbox/dependencies/:fingerprint`
- `PUT /sandbox/dependencies/:fingerprint`
- `GET /sandbox/snapshots/:fingerprint`
- `PUT /sandbox/snapshots/:fingerprint`
- `GET /sandbox/templates/:templateId`
- `PUT /sandbox/templates/:templateId`

---

## Data Model (Conceptual)

Core entities used by repositories:
- `users` – internal user mapped from Clerk identity
- `threads` – conversation containers (`last_mode`, plan metadata)
- `messages` – ordered by per-thread `seq`, with statuses
- `message_chunks` – streaming delta persistence
- `file_versions` – append-only file history per message
- `thread_file_state` – denormalized current file snapshot for fast load
- `code_blobs` – content-addressed storage metadata (`sha256`)
- `plan_contexts` – approved plan text reused for build mode context
- `shell_commands` – extracted shell operations linked to message/thread
- `terminal_events` – persisted terminal telemetry
- `terminal_recovery_audits` – recovery attempts and outcomes

Concurrency and integrity:
- Per-thread advisory locks ensure sequence/version correctness.
- Finalization path commits message completion + file/shell artifacts together.
- Boot-time orphan-stream cleanup marks stale `streaming` messages as `aborted`.

---

## Environment Variables

## Frontend (`frontend/.env`)

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:3001/api
```

## Backend (`backend/.env`)

```env
PORT=3001
FRONTEND_URL=http://localhost:5173

# Clerk
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:6543/postgres?sslmode=require
SUPABASE_STORAGE_BUCKET=code-files
SUPABASE_SNAPSHOT_BUCKET=snapshots

# Optional cache/ops
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
SANDBOX_TOOLCHAIN_VERSION=webcontainer-npm-v1
DB_CONNECT_TIMEOUT_MS=10000

# AI providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# Optional logging
LOG_LEVEL=info
LOG_FORMAT=text
LOG_HTTP_HEALTH=false
```

---

## Local Development

Use two terminals.

## 1) Backend

```bash
cd backend
npm install
npm run dev
```

Backend health check:
- `GET http://localhost:3001/health`

## 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL:
- `http://localhost:5173`

---

## Build, Test, and Production Notes

## Frontend

```bash
cd frontend
npm run build
npm run preview
```

## Backend

```bash
cd backend
npm run build
npm run start
```

## Backend tests

```bash
cd backend
npm test
```

Current test target includes chat mode policy validation.

---

## Troubleshooting

## App boots but chat fails with auth errors
- Verify Clerk keys in both frontend and backend env files.
- Confirm browser session is signed in.
- Ensure `Authorization: Bearer <token>` is reaching backend.

## Backend won’t start (DB errors)
- Validate `SUPABASE_DB_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm DB/network reachability from your machine.
- If pooler auth has tenant/user mismatch, backend includes a direct-host fallback path.

## Frontend can’t call backend (CORS)
- Confirm `FRONTEND_URL` matches actual frontend origin.
- Default allowed origin is `http://localhost:5173`.

## Slow or repeated `npm install` inside sandbox
- Expected on first run or changed dependency fingerprint.
- Subsequent runs should improve via local and remote snapshot reuse.

## Thread restore seems stale/incomplete
- Check `/chat/:threadId/files/delta` behavior and fallback to full snapshot path.
- Verify thread/file writes were finalized (not interrupted stream only).

---

## Security and Reliability Notes

- Auth-required API routes are guarded by Clerk middleware.
- Internal user IDs are separate from external Clerk IDs.
- Message/file sequencing uses DB advisory locks to prevent race conditions.
- Streaming chunks are persisted incrementally to reduce data loss risk on interruption.
- Backend logs support request-level correlation (`X-Request-Id` exposure).
- Snapshot upload failures are tracked with retry metadata instead of silent failure.

---

## Roadmap Ideas

- Add database migration files and schema docs under `backend/migrations/`.
- Add OpenAPI/Swagger spec for the full API.
- Expand integration tests for streaming + sandbox snapshot lifecycle.
- Add per-provider latency/error dashboards.
- Add deploy guides (Docker, managed secrets, CI/CD pipeline).

