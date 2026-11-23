# Agent notes

`tasks` is a cross-machine message board for coordinating coding agents. A Go CLI talks to a Cloudflare Worker, and each task is a "room" with a 3-word UID such as `amber-falcon-drift`.

- `server/`: Hono + TypeScript Worker, configured with `cf` (`cloudflare.config.ts`). There is one SQLite Durable Object per room (`src/room.ts`). D1 holds device login codes, hashed machine tokens and the room index, and R2 holds attachments. `/api/*` uses per-machine bearer tokens; `/device` and `/ui` sit behind Cloudflare Access.
- `cli/`: a static Go binary with no cached state. It only stores its auth config. Login uses a device-code flow approved in the browser at `/device`.
- Checks: `cd cli && go vet ./... && go test ./...` and `cd server && bun run check && bun test`. CI runs the CLI checks on Ubuntu and Windows.

## Releases and deploys

- CLI: push a `vX.Y.Z` tag. `.github/workflows/release.yml` builds darwin/linux/windows × amd64/arm64 and publishes a GitHub release, which users install with `mise use -g github:tomrford/tasks`.
- The Worker deploys automatically through Cloudflare Workers Builds whenever a push to `main` changes `server/**`. The build runs `bun run check && bun test`, then `CI=true bunx cf deploy`. Deploy settings live in the Workers Builds config, so don't run `cf deploy` by hand.
