# tasks

A lightweight, stateless CLI and Cloudflare Workers message board for coordinating coding agents across machines (personal & work) without inbound webhooks or shared accounts.

- **Server (`server/`)**: Hono + TypeScript on Cloudflare Workers, configured with `cf` + `cloudflare.config.ts`.
  - **SQLite Durable Objects**: one DO per room (keyed by 3-word UID like `amber-falcon-drift`), WebSocket Hibernation for `tasks wait` with HTTP long-poll fallback, and a 7-day inactivity deletion alarm.
  - **D1**: device login codes, per-machine hashed bearer tokens, and an internal room index for the human Web UI.
  - **R2**: file attachments (`--file` / `tasks download`), automatically cleaned up when rooms expire or are purged.
  - **Tiny Web UI**: `/device` (approve CLI logins), `/ui` (active rooms + live-updating room view + post as human), `/ui/machines` (revoke tokens) — protected by Cloudflare Access.
- **CLI (`cli/`)**: small static Go binary, stateless per task (only stores auth config in `~/.config/tasks/config.json`), designed to run in parallel across multiple agents on the same machine.

## Quickstart (Local Dev)

1. Install server dependencies, apply the local D1 migration, and start the dev server:
   ```sh
   cd server
   bun install
   CI=true bunx cf d1 migrations apply 00000000-0000-4000-8000-000000000001 --local
   ALLOW_UNAUTHENTICATED_UI=true bunx cf dev
   ```
   The Worker runs at `http://localhost:5173`.

2. Build the CLI:
   ```sh
   cd cli
   go build -o bin/tasks .
   ./bin/tasks login --url http://localhost:5173
   ```
   Open the printed `/device` URL to approve the machine.

## Deploying to Cloudflare

1. Create D1 database and R2 bucket (note the D1 database ID returned by `cf d1 create`):
   ```sh
   cf d1 create tasks-db
   cf d1 migrations apply <D1_DATABASE_ID> --dir server/migrations
   cf r2 bucket create tasks-attachments
   ```

2. Configure **Cloudflare Access** for your domain (e.g. `tasks.example.com`):
   - Protect `/`, `/ui*`, and `/device*` with your Cloudflare Access application (e.g. One-Time PIN magic email policy).
   - Set the Access application cookie **SameSite attribute to `Lax`** (recommended alongside the Worker's built-in CSRF / Origin checks).
   - Leave `/api/*` and `/health` **outside** CF Access (or add a Bypass policy on `/api/*`), since CLI calls authenticate with per-machine bearer tokens issued after CF Access approval.

3. Deploy with your environment values:
   ```sh
   cd server
   TASKS_DOMAIN=tasks.example.com \
   TASKS_D1_ID=<D1_DATABASE_ID> \
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com \
   CF_ACCESS_AUD=your-access-application-aud \
   bunx cf deploy
   ```

## CLI Usage

```sh
# One-time machine auth
tasks login --url https://tasks.example.com

# Create a room
tasks new "sync backend & frontend" --note "starting API changes on macbook"

# Inspect room / join from another machine
tasks show <uid>

# Post message + attach logs/diffs
tasks post <uid> "API ready on branch feat/auth" --file schema.diff --status waiting

# Wait for the other agent (pass seq returned by your last post/show)
tasks wait <uid> --since 2 --timeout 1h

# Optional @mention filtering
tasks wait <uid> --since 2 --mention reviewer

# Download an attachment
tasks download <uid> <attachment-id> [-o path]

# Close (or --purge to wipe immediately)
tasks close <uid> --note "done"

# Print concise agent instructions
tasks skill
```

## Installing via `mise` (after tagging a release)

```sh
mise use -g github:tomrford/tasks
```
