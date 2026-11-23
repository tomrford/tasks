package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeURL(t *testing.T) {
	ok := map[string]string{
		"":                                       "",
		"tasks.example.com":                      "https://tasks.example.com",
		" tasks.example.com/ ":                   "https://tasks.example.com",
		"https://tasks.example.com/":             "https://tasks.example.com",
		"HTTPS://tasks.example.com":              "HTTPS://tasks.example.com",
		"http://localhost:5173":                  "http://localhost:5173",
		"localhost:5173":                         "https://localhost:5173",
		"tasks.example.com/proxy/http://up.test": "https://tasks.example.com/proxy/http://up.test",
	}
	for in, want := range ok {
		got, err := NormalizeURL(in)
		if err != nil || got != want {
			t.Errorf("NormalizeURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"/", "https://", "ftp://tasks.example.com", "https:///path"} {
		if got, err := NormalizeURL(in); err == nil {
			t.Errorf("NormalizeURL(%q) = %q; want error", in, got)
		}
	}
}

// writeRaw bypasses Save so a fixture can hold a URL that Save would have normalized.
func writeRaw(t *testing.T, body string) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TASKS_CONFIG", p)
	t.Setenv("TASKS_TOKEN", "")
}

func TestLoadEnvOverrideTokenOrigin(t *testing.T) {
	cases := []struct {
		envURL    string
		wantToken string
	}{
		{"other.example.com", ""},
		{"https://other.example.com", ""},
		{"http://tasks.example.com", ""},
		{"tasks.example.com", "tsk_saved"},
		{"https://TASKS.example.com/", "tsk_saved"},
	}
	for _, tc := range cases {
		writeRaw(t, `{"url":"tasks.example.com","token":"tsk_saved"}`)
		t.Setenv("TASKS_URL", tc.envURL)
		cfg, err := Load()
		if err != nil {
			t.Fatalf("TASKS_URL=%q: load failed: %v", tc.envURL, err)
		}
		if cfg.Token != tc.wantToken {
			t.Errorf("TASKS_URL=%q: token = %q, want %q", tc.envURL, cfg.Token, tc.wantToken)
		}
	}
}

func TestLoadRejectsMalformedEnvURL(t *testing.T) {
	writeRaw(t, `{"url":"https://tasks.example.com","token":"tsk_saved"}`)
	t.Setenv("TASKS_URL", "/")
	if cfg, err := Load(); err == nil {
		t.Fatalf("expected error for malformed TASKS_URL, got %+v", cfg)
	}
}
