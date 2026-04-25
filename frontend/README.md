# NextGen Frontend

Frontend app for the Boltly NextGen builder, powered by React + TypeScript + Vite.

## Important repo layout

This repository does **not** have a root `package.json`.

- Frontend commands must run from `frontend/`
- Backend commands must run from `backend/`

Running `npm` commands from the repository root will fail with `ENOENT` (missing `package.json`).

## Local development

Open two terminals:

### 1) Start backend API

```bash
cd backend
npm install
npm run dev
```

Expected API base URL: `http://localhost:3001/api`

### 2) Start frontend

```bash
cd frontend
npm install
npm run dev
```

Expected frontend URL: `http://localhost:5173`

## Build and preview

From `frontend/`:

```bash
npm run build
npm run preview
```

Default preview URL is typically `http://localhost:4173`.

## Environment notes

- Frontend requires `VITE_CLERK_PUBLISHABLE_KEY`.
- Frontend API target is controlled by `VITE_API_URL` (defaults to `http://localhost:3001/api`).
- Backend DB startup depends on Supabase/Postgres env vars (`SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

If backend terminal appears stuck during boot, check DB credentials/network and startup logs first.
