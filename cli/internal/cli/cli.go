package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/tomrford/tasks/cli/internal/client"
	"github.com/tomrford/tasks/cli/internal/config"
	"github.com/tomrford/tasks/cli/internal/skill"
)

const exitTimeout = 124

type stringSlice []string

func (s *stringSlice) String() string { return strings.Join(*s, ",") }
func (s *stringSlice) Set(v string) error {
	*s = append(*s, v)
	return nil
}

// normalizeArgs reorders recognized flags before positional arguments so callers
// (especially agents) can pass flags before or after positionals while preserving
// `--` and allowing positional values starting with `-` (e.g. Markdown bullets).
func normalizeArgs(fs *flag.FlagSet, args []string) []string {
	var flags []string
	var positionals []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positionals = append(positionals, args[i+1:]...)
			break
		}
		if strings.HasPrefix(arg, "-") && len(arg) > 1 {
			rawName := strings.TrimLeft(arg, "-")
			name := rawName
			hasEq := false
			if idx := strings.IndexByte(rawName, '='); idx != -1 {
				name = rawName[:idx]
				hasEq = true
			}
			f := fs.Lookup(name)
			if f == nil {
				// Let -h / --help reach FlagSet, treat unrecognized `- ...` text as positional
				if name == "h" || name == "help" {
					flags = append(flags, arg)
				} else {
					positionals = append(positionals, arg)
				}
				continue
			}
			flags = append(flags, arg)
			if hasEq {
				continue
			}
			if bf, ok := f.Value.(interface{ IsBoolFlag() bool }); ok && bf.IsBoolFlag() {
				continue
			}
			if i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		} else {
			positionals = append(positionals, arg)
		}
	}
	if len(positionals) > 0 {
		return append(append(flags, "--"), positionals...)
	}
	return flags
}

func Run(args []string, version string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stdout)
		return 0
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := args[0]
	rest := args[1:]

	switch cmd {
	case "-h", "--help", "help":
		printUsage(stdout)
		return 0
	case "version", "--version", "-v":
		fmt.Fprintln(stdout, version)
		return 0
	case "skill":
		fmt.Fprint(stdout, skill.Text)
		return 0
	case "login":
		return runLogin(ctx, rest, stdout, stderr)
	case "whoami":
		return runWhoAmI(ctx, rest, stdout, stderr)
	case "new", "create":
		return runNew(ctx, rest, stdout, stderr)
	case "show", "read", "join":
		return runShow(ctx, rest, stdout, stderr)
	case "post", "send":
		return runPost(ctx, rest, stdin, stdout, stderr)
	case "wait", "watch":
		return runWait(ctx, rest, stdout, stderr)
	case "download", "fetch", "get":
		return runDownload(ctx, rest, stdout, stderr)
	case "close", "done":
		return runClose(ctx, rest, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n", cmd)
		printUsage(stderr)
		return 2
	}
}

func printUsage(w io.Writer) {
	fmt.Fprint(w, `tasks — cross-machine semi-ephemeral task board CLI

Usage:
  tasks login [--url URL] [--name MACHINE]
  tasks whoami [--json]
  tasks new [title] [--note TEXT] [--as LABEL] [--ttl DAYS] [--json]
  tasks show <uid> [--since SEQ] [--json]
  tasks post <uid> [message] [--file PATH...] [--as LABEL] [--status STATUS] [--stdin] [--json]
  tasks wait <uid> [--since SEQ] [--timeout 1h] [--mention NAME] [--poll] [--json]
  tasks download <uid> <attachment-id> [-o PATH] [--force]
  tasks close <uid> [--note TEXT] [--as LABEL] [--purge] [--json]
  tasks skill
  tasks version

Environment:
  TASKS_URL     Override server URL (requires TASKS_TOKEN if changing origin)
  TASKS_TOKEN   Override bearer token
  TASKS_AS      Default --as sender label
  TASKS_CONFIG  Override config file path
`)
}

func requireClient(stderr io.Writer) (*client.Client, config.Config, bool) {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(stderr, "error loading config: %v\n", err)
		return nil, cfg, false
	}
	if cfg.URL == "" || cfg.Token == "" {
		fmt.Fprintln(stderr, "not logged in — run `tasks login --url https://tasks.example.com` first (or set TASKS_URL and TASKS_TOKEN)")
		return nil, cfg, false
	}
	return client.New(cfg.URL, cfg.Token), cfg, true
}

func defaultAs(flagVal string) string {
	if strings.TrimSpace(flagVal) != "" {
		return strings.TrimSpace(flagVal)
	}
	return strings.TrimSpace(os.Getenv("TASKS_AS"))
}

func printJSON(w io.Writer, v any) int {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return 1
	}
	return 0
}

func runLogin(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	cfg, _ := config.Load()
	host, _ := os.Hostname()
	host = strings.Split(host, ".")[0]

	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	fs.SetOutput(stderr)
	urlFlag := fs.String("url", cfg.URL, "Server base URL (e.g. https://tasks.example.com)")
	nameFlag := fs.String("name", host, "Machine name to register")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}

	serverURL, err := config.NormalizeURL(*urlFlag)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 2
	}
	if serverURL == "" {
		fmt.Fprintln(stderr, "error: --url is required (e.g. tasks login --url https://tasks.example.com)")
		return 2
	}
	machineName := strings.TrimSpace(*nameFlag)
	if machineName == "" {
		fmt.Fprintln(stderr, "error: --name is required")
		return 2
	}

	c := client.New(serverURL, "")
	start, err := c.DeviceStart(ctx, machineName)
	if err != nil {
		fmt.Fprintf(stderr, "error starting device login: %v\n", err)
		return 1
	}

	fmt.Fprintf(stdout, "Open this URL to approve machine %q:\n  %s\n\nCode: %s\nWaiting for approval...\n",
		machineName, start.VerificationURL, start.UserCode)

	interval := time.Duration(start.Interval) * time.Second
	if interval < time.Second {
		interval = 2 * time.Second
	}
	deadline := time.Now().Add(time.Duration(start.ExpiresIn) * time.Second)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			fmt.Fprintln(stderr, "cancelled")
			return 1
		case <-time.After(interval):
		}

		poll, err := c.DevicePoll(ctx, start.DeviceCode)
		if err != nil {
			fmt.Fprintf(stderr, "poll error: %v\n", err)
			continue
		}

		switch poll.Status {
		case "pending":
			continue
		case "approved":
			newCfg := config.Config{
				URL:     serverURL,
				Token:   poll.Token,
				Machine: machineName,
			}
			if poll.Machine != nil && poll.Machine.Name != "" {
				newCfg.Machine = poll.Machine.Name
			}
			if err := config.Save(newCfg); err != nil {
				fmt.Fprintf(stderr, "error saving config: %v\n", err)
				return 1
			}
			p, _ := config.Path()
			fmt.Fprintf(stdout, "Logged in as %s (%s)\nConfig saved to %s\n", newCfg.Machine, newCfg.URL, p)
			return 0
		case "denied":
			fmt.Fprintln(stderr, "login request was denied")
			return 1
		case "expired":
			fmt.Fprintln(stderr, "login request expired")
			return 1
		}
	}

	fmt.Fprintln(stderr, "login timed out waiting for approval")
	return 1
}

func runWhoAmI(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("whoami", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "Output JSON")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}

	c, cfg, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	m, err := c.WhoAmI(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}
	if *asJSON {
		return printJSON(stdout, map[string]any{"url": cfg.URL, "machine": m})
	}
	fmt.Fprintf(stdout, "machine: %s (%s)\nserver: %s\n", m.Name, m.ID, cfg.URL)
	return 0
}

func runNew(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("new", flag.ContinueOnError)
	fs.SetOutput(stderr)
	note := fs.String("note", "", "Initial message body")
	asFlag := fs.String("as", "", "Optional sender label")
	ttlDays := fs.Int("ttl", 0, "Inactivity TTL in days (default 7, max 30)")
	asJSON := fs.Bool("json", false, "Output JSON")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}

	c, _, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	title := strings.TrimSpace(strings.Join(fs.Args(), " "))
	room, err := c.CreateTask(ctx, title, *note, defaultAs(*asFlag), *ttlDays)
	if err != nil {
		fmt.Fprintf(stderr, "error creating task: %v\n", err)
		return 1
	}

	if *asJSON {
		return printJSON(stdout, room)
	}
	fmt.Fprintf(stdout, "uid: %s\n", room.UID)
	if room.Title != "" {
		fmt.Fprintf(stdout, "title: %s\n", room.Title)
	}
	fmt.Fprintf(stdout, "status: %s\nnext_seq: %d\n", room.Status, room.LastSeq)
	return 0
}

func runShow(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("show", flag.ContinueOnError)
	fs.SetOutput(stderr)
	since := fs.Int("since", 0, "Only show messages with seq > since")
	asJSON := fs.Bool("json", false, "Output JSON")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "usage: tasks show <uid> [--since SEQ] [--json]")
		return 2
	}
	uid := fs.Arg(0)

	c, _, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	room, err := c.GetTask(ctx, uid, *since)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}

	if *asJSON {
		return printJSON(stdout, room)
	}

	header := fmt.Sprintf("room: %s  status: %s", room.UID, room.Status)
	if room.Title != "" {
		header += fmt.Sprintf("  title: %s", room.Title)
	}
	fmt.Fprintln(stdout, header)
	if len(room.Messages) == 0 {
		fmt.Fprintln(stdout, "(no messages)")
	} else {
		for _, m := range room.Messages {
			printMessage(stdout, m)
		}
	}
	fmt.Fprintf(stdout, "next_seq: %d\n", room.LastSeq)
	return 0
}

func runPost(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("post", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asFlag := fs.String("as", "", "Optional sender label")
	statusFlag := fs.String("status", "", "Optional status update: open|waiting|blocked|done")
	fromStdin := fs.Bool("stdin", false, "Read message body from stdin")
	asJSON := fs.Bool("json", false, "Output JSON")
	var files stringSlice
	fs.Var(&files, "file", "Attach file path (repeatable)")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "usage: tasks post <uid> [message] [--file PATH...] [--as LABEL] [--status STATUS] [--stdin] [--json]")
		return 2
	}
	uid := fs.Arg(0)
	body := strings.TrimSpace(strings.Join(fs.Args()[1:], " "))
	if *fromStdin {
		raw, err := io.ReadAll(stdin)
		if err != nil {
			fmt.Fprintf(stderr, "error reading stdin: %v\n", err)
			return 1
		}
		if body != "" {
			body += "\n" + strings.TrimSpace(string(raw))
		} else {
			body = strings.TrimSpace(string(raw))
		}
	}

	if body == "" && len(files) == 0 && *statusFlag == "" {
		fmt.Fprintln(stderr, "error: provide a message, --file, --status, or --stdin")
		return 2
	}

	c, _, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	senderLabel := defaultAs(*asFlag)
	var attIDs []string
	for _, fpath := range files {
		att, err := c.UploadAttachment(ctx, uid, fpath, senderLabel)
		if err != nil {
			fmt.Fprintf(stderr, "error uploading %s: %v\n", fpath, err)
			return 1
		}
		attIDs = append(attIDs, att.ID)
	}

	resp, err := c.PostMessage(ctx, uid, body, senderLabel, *statusFlag, attIDs)
	if err != nil {
		fmt.Fprintf(stderr, "error posting message: %v\n", err)
		return 1
	}

	if *asJSON {
		return printJSON(stdout, resp)
	}
	fmt.Fprintf(stdout, "seq: %d\nstatus: %s\nnext_seq: %d\n", resp.Seq, resp.Status, resp.LastSeq)
	return 0
}

func runWait(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wait", flag.ContinueOnError)
	fs.SetOutput(stderr)
	since := fs.Int("since", -1, "Wait for messages with seq > since (defaults to current room tip)")
	timeoutStr := fs.String("timeout", "1h", "Max wait duration (e.g. 15m, 1h)")
	mention := fs.String("mention", "", "Only wake on @<name> mention (or room done)")
	forcePoll := fs.Bool("poll", false, "Force HTTP long-polling instead of WebSocket")
	asJSON := fs.Bool("json", false, "Output JSON")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "usage: tasks wait <uid> [--since SEQ] [--timeout 1h] [--mention NAME] [--poll] [--json]")
		return 2
	}
	uid := fs.Arg(0)

	dur, err := time.ParseDuration(*timeoutStr)
	if err != nil || dur <= 0 {
		fmt.Fprintf(stderr, "error: invalid --timeout %q\n", *timeoutStr)
		return 2
	}

	c, _, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	effectiveSince := *since
	if effectiveSince < 0 {
		snap, err := c.GetTask(ctx, uid, 999999999)
		if err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 1
		}
		effectiveSince = snap.LastSeq
	}

	ev, err := c.Wait(ctx, uid, client.WaitOptions{
		Since:     effectiveSince,
		Mention:   *mention,
		Timeout:   dur,
		ForcePoll: *forcePoll,
	})
	if err != nil {
		if errors.Is(err, client.ErrWaitTimeout) {
			if *asJSON {
				_ = printJSON(stdout, map[string]any{"timeout": true, "since": effectiveSince})
			} else {
				fmt.Fprintf(stderr, "timed out after %s with no new messages\n", dur)
			}
			return exitTimeout
		}
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}

	if *asJSON {
		return printJSON(stdout, ev)
	}

	if ev.Purged {
		fmt.Fprintf(stdout, "room %s was purged\n", uid)
		return 0
	}
	for _, m := range ev.Messages {
		printMessage(stdout, m)
	}
	fmt.Fprintf(stdout, "status: %s\nnext_seq: %d\n", ev.Status, ev.LastSeq)
	return 0
}

func runDownload(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("download", flag.ContinueOnError)
	fs.SetOutput(stderr)
	outPath := fs.String("o", "", "Destination file path")
	outLong := fs.String("output", "", "Destination file path")
	force := fs.Bool("force", false, "Overwrite destination file if it already exists")
	forceShort := fs.Bool("f", false, "Overwrite destination file if it already exists")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}
	if fs.NArg() < 2 {
		fmt.Fprintln(stderr, "usage: tasks download <uid> <attachment-id> [-o PATH] [--force]")
		return 2
	}
	uid := fs.Arg(0)
	attID := fs.Arg(1)
	dest := *outPath
	if dest == "" {
		dest = *outLong
	}

	c, _, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	writtenPath, n, err := c.DownloadAttachment(ctx, uid, attID, dest, *force || *forceShort)
	if err != nil {
		fmt.Fprintf(stderr, "error downloading attachment: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "saved %s (%d bytes)\n", writtenPath, n)
	return 0
}

func runClose(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("close", flag.ContinueOnError)
	fs.SetOutput(stderr)
	note := fs.String("note", "", "Optional closing message")
	asFlag := fs.String("as", "", "Optional sender label")
	purge := fs.Bool("purge", false, "Immediately delete room and all attachments")
	asJSON := fs.Bool("json", false, "Output JSON")
	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "usage: tasks close <uid> [--note TEXT] [--as LABEL] [--purge] [--json]")
		return 2
	}
	uid := fs.Arg(0)

	c, _, ok := requireClient(stderr)
	if !ok {
		return 1
	}

	resp, err := c.CloseTask(ctx, uid, *note, defaultAs(*asFlag), *purge)
	if err != nil {
		fmt.Fprintf(stderr, "error closing room: %v\n", err)
		return 1
	}
	if *asJSON {
		return printJSON(stdout, resp)
	}
	if resp.Purged {
		fmt.Fprintf(stdout, "purged %s\n", resp.UID)
	} else {
		fmt.Fprintf(stdout, "closed %s (status: %s, next_seq: %d)\n", resp.UID, resp.Status, resp.LastSeq)
	}
	return 0
}

func printMessage(w io.Writer, m client.Message) {
	ts := time.UnixMilli(m.CreatedAt).Local().Format("2006-01-02 15:04:05")
	statusPart := ""
	if m.Status != "" {
		statusPart = fmt.Sprintf(" [status=%s]", m.Status)
	}
	fmt.Fprintf(w, "#%d [%s] %s%s\n", m.Seq, m.Sender, ts, statusPart)
	if m.Body != "" {
		for _, line := range strings.Split(m.Body, "\n") {
			fmt.Fprintf(w, "  %s\n", line)
		}
	}
	for _, a := range m.Attachments {
		fmt.Fprintf(w, "  [attachment %s] %s (%d bytes)\n", a.ID, a.Filename, a.SizeBytes)
	}
}
