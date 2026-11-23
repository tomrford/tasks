package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Config struct {
	URL     string `json:"url"`
	Token   string `json:"token"`
	Machine string `json:"machine"`
}

func Path() (string, error) {
	if custom := strings.TrimSpace(os.Getenv("TASKS_CONFIG")); custom != "" {
		return custom, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "", err
		}
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "tasks", "config.json"), nil
}

var schemePrefix = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*://`)

// NormalizeURL defaults a scheme-less server URL to https://, trims trailing slashes, and
// rejects anything that is not an http(s) URL with a host. Blank input returns "".
func NormalizeURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if !schemePrefix.MatchString(s) {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return "", fmt.Errorf("invalid server URL %q (expected e.g. https://tasks.example.com)", raw)
	}
	return strings.TrimRight(s, "/"), nil
}

func originOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

func Load() (Config, error) {
	var cfg Config
	p, err := Path()
	if err == nil {
		if data, rerr := os.ReadFile(p); rerr == nil {
			if jerr := json.Unmarshal(data, &cfg); jerr != nil {
				return Config{}, jerr
			}
		} else if !errors.Is(rerr, os.ErrNotExist) {
			return Config{}, rerr
		}
	}

	savedURL, err := NormalizeURL(cfg.URL)
	if err != nil {
		return Config{}, fmt.Errorf("saved config: %w", err)
	}
	cfg.URL = savedURL
	envToken := strings.TrimSpace(os.Getenv("TASKS_TOKEN"))

	if rawEnvURL := strings.TrimSpace(os.Getenv("TASKS_URL")); rawEnvURL != "" {
		envURL, err := NormalizeURL(rawEnvURL)
		if err != nil {
			return Config{}, fmt.Errorf("TASKS_URL: %w", err)
		}
		if envToken == "" && originOf(envURL) != originOf(cfg.URL) {
			// Never send a token saved for another origin when TASKS_URL is overridden without TASKS_TOKEN
			cfg.Token = ""
		}
		cfg.URL = envURL
	}
	if envToken != "" {
		cfg.Token = envToken
	}
	if v := strings.TrimSpace(os.Getenv("TASKS_MACHINE")); v != "" {
		cfg.Machine = v
	}

	return cfg, nil
}

func Save(cfg Config) error {
	var err error
	if cfg.URL, err = NormalizeURL(cfg.URL); err != nil {
		return err
	}
	p, err := Path()
	if err != nil {
		return err
	}
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, p); err != nil {
		return err
	}
	cleanup = false
	return nil
}
