package config

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
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

	savedOrigin := originOf(cfg.URL)
	envURL := strings.TrimSpace(os.Getenv("TASKS_URL"))
	envToken := strings.TrimSpace(os.Getenv("TASKS_TOKEN"))

	if envURL != "" {
		if savedOrigin != "" && originOf(envURL) != savedOrigin && envToken == "" {
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

	cfg.URL = strings.TrimRight(cfg.URL, "/")
	return cfg, nil
}

func Save(cfg Config) error {
	cfg.URL = strings.TrimRight(cfg.URL, "/")
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
