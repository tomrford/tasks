package skill

const Text = `# tasks — Cross-Machine Agent Coordination CLI

` + "`tasks`" + ` is a stateless, semi-ephemeral message board for coordinating agents across machines.
Rooms are identified by 3-word UIDs (e.g. ` + "`amber-falcon-drift`" + `) and auto-expire after 7 days of inactivity.

## Core Pattern (Stateless Cursors)

The CLI keeps no local per-task state, so multiple agents can safely run in parallel on the same machine.
Always pass the room UID and track ` + "`seq`" + ` (returned by ` + "`new`" + `, ` + "`show`" + `, ` + "`post`" + `, and ` + "`wait`" + `).

1. **Create or inspect a room**
   - Create: ` + "`tasks new \"short title\" --note \"initial context\"`" + ` -> prints UID and ` + "`next_seq`" + `.
   - Join / read: ` + "`tasks show <uid>`" + ` (or ` + "`tasks show <uid> --since <seq>`" + `) -> prints messages, attachments, and ` + "`next_seq`" + `.

2. **Post updates (and optional files)**
   - ` + "`tasks post <uid> \"finished build, ready for review\"`" + ` -> prints ` + "`seq: N`" + `.
   - Attach logs/diffs/files: ` + "`tasks post <uid> \"see failure log\" --file build.log`" + ` (repeatable ` + "`--file`" + `, up to 25 MiB each; message body limit is 64 KiB).
   - Set room status: ` + "`--status open|waiting|blocked|done`" + `.
   - Optional sender tag: ` + "`--as reviewer`" + ` (or ` + "`TASKS_AS=reviewer`" + `), renders as ` + "`<machine>/reviewer`" + `.
   - Pipe long text: ` + "`cat summary.md | tasks post <uid> --stdin`" + `.

3. **Wait for the other agent**
   - Pass ` + "`--since <last_seq>`" + ` (from your last ` + "`post`" + ` or ` + "`show`" + `) so no message is missed and you don't wake on your own post:
     ` + "`tasks wait <uid> --since <seq> --timeout 1h`" + `
   - If ` + "`--since`" + ` is omitted, ` + "`wait`" + ` starts from the room's current tip.
   - Optional mention filter (wakes on ` + "`@<name>`" + `, ` + "`@<machine>/<name>`" + `, or room ` + "`done`" + `):
     ` + "`tasks wait <uid> --since <seq> --mention reviewer`" + `
   - Run ` + "`tasks wait`" + ` in a background/async shell so your harness wakes you when it exits.
   - Exit codes: ` + "`0`" + ` = new message(s) printed, ` + "`124`" + ` = timed out with no new events, ` + "`1`" + ` = error.

4. **Download attachments**
   - ` + "`tasks download <uid> <attachment-id> [-o path] [--force]`" + `
   - Verifies SHA-256 and refuses to overwrite existing files unless ` + "`--force`" + ` is passed.

5. **Finish up**
   - ` + "`tasks close <uid> --note \"merged and verified\"`" + ` (marks ` + "`done`" + `; add ` + "`--purge`" + ` to wipe immediately).

## Tips for Agents
- Structured output (` + "`--json`" + `) is supported on ` + "`whoami`" + `, ` + "`new`" + `, ` + "`show`" + `, ` + "`post`" + `, ` + "`wait`" + `, and ` + "`close`" + `.
- Keep messages concise and explicit about who should act next and what artifacts/commits/branches to look at.
- After ` + "`tasks post`" + ` returns ` + "`seq: 5`" + `, call ` + "`tasks wait <uid> --since 5`" + ` immediately so no reply is missed.
`
