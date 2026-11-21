package cli

import (
	"bytes"
	"encoding/json"
	"flag"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tomrford/tasks/cli/internal/client"
	"github.com/tomrford/tasks/cli/internal/config"
)

func TestNormalizeArgs(t *testing.T) {
	fs := flag.NewFlagSet("post", flag.ContinueOnError)
	status := fs.String("status", "", "")
	asJSON := fs.Bool("json", false, "")
	var files stringSlice
	fs.Var(&files, "file", "")

	raw := []string{"amber-falcon-drift", "- bullet item", "--file", "a.log", "--json", "--status", "waiting", "--file=b.diff"}
	if err := fs.Parse(normalizeArgs(fs, raw)); err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if *status != "waiting" || !*asJSON {
		t.Fatalf("flags not parsed: status=%q json=%v", *status, *asJSON)
	}
	if len(files) != 2 || files[0] != "a.log" || files[1] != "b.diff" {
		t.Fatalf("unexpected files: %v", files)
	}
	if fs.NArg() != 2 || fs.Arg(0) != "amber-falcon-drift" || fs.Arg(1) != "- bullet item" {
		t.Fatalf("unexpected positionals: %v", fs.Args())
	}

	// Leading-dash title after explicit `--`
	fsNew := flag.NewFlagSet("new", flag.ContinueOnError)
	fsNew.String("note", "", "")
	if err := fsNew.Parse(normalizeArgs(fsNew, []string{"--note", "hi", "--", "--leading-dash"})); err != nil {
		t.Fatalf("parse after -- failed: %v", err)
	}
	if fsNew.NArg() != 1 || fsNew.Arg(0) != "--leading-dash" {
		t.Fatalf("unexpected args after --: %v", fsNew.Args())
	}
}

func TestConfigOriginOverrideClearsSavedToken(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("TASKS_CONFIG", cfgPath)
	if err := config.Save(config.Config{
		URL:     "https://tasks.example.com",
		Token:   "tsk_secret",
		Machine: "macbook",
	}); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	t.Setenv("TASKS_URL", "https://other.example.com")
	t.Setenv("TASKS_TOKEN", "")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if cfg.Token != "" {
		t.Fatalf("expected saved token to be cleared on origin change, got %q", cfg.Token)
	}
}

func TestCLISkillAndPostFlow(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"skill"}, "test", strings.NewReader(""), &stdout, &stderr); code != 0 {
		t.Fatalf("skill failed: %d %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "tasks wait") {
		t.Fatalf("expected skill output to mention tasks wait")
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/tasks":
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(client.RoomSnapshot{
				UID:     "amber-falcon-drift",
				Title:   "sync deploy",
				Status:  "open",
				LastSeq: 1,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/tasks/amber-falcon-drift/messages":
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(client.PostMessageResponse{
				Seq:     2,
				Status:  "waiting",
				LastSeq: 2,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	t.Setenv("TASKS_URL", srv.URL)
	t.Setenv("TASKS_TOKEN", "tsk_test")

	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"new", "sync deploy", "--note", "starting"}, "test", strings.NewReader(""), &stdout, &stderr); code != 0 {
		t.Fatalf("new failed: %d %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "uid: amber-falcon-drift") {
		t.Fatalf("unexpected new output: %s", stdout.String())
	}

	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"post", "amber-falcon-drift", "- bullet message", "--status", "waiting"}, "test", strings.NewReader(""), &stdout, &stderr); code != 0 {
		t.Fatalf("post failed: %d %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "next_seq: 2") {
		t.Fatalf("unexpected post output: %s", stdout.String())
	}
}
