package client_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tomrford/tasks/cli/internal/client"
)

func TestWaitWebSocketAndLongPoll(t *testing.T) {
	t.Run("websocket receives event", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer tok_123" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close(websocket.StatusNormalClosure, "ok")

			ev := client.WaitEvent{
				Type:    "events",
				Changed: true,
				Status:  "open",
				LastSeq: 3,
				Messages: []client.Message{
					{Seq: 3, Sender: "macmini", Body: "build green", CreatedAt: time.Now().UnixMilli()},
				},
			}
			b, _ := json.Marshal(ev)
			_ = conn.Write(r.Context(), websocket.MessageText, b)
		}))
		defer srv.Close()

		c := client.New(srv.URL, "tok_123")
		ev, err := c.Wait(context.Background(), "amber-falcon-drift", client.WaitOptions{
			Since:   2,
			Timeout: 5 * time.Second,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ev.LastSeq != 3 || len(ev.Messages) != 1 || ev.Messages[0].Body != "build green" {
			t.Fatalf("unexpected event: %+v", ev)
		}
	})

	t.Run("websocket revoked close returns 401 immediately", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			_ = conn.Close(4001, "machine revoked")
		}))
		defer srv.Close()

		c := client.New(srv.URL, "tok_123")
		_, err := c.Wait(context.Background(), "amber-falcon-drift", client.WaitOptions{
			Since:   2,
			Timeout: 5 * time.Second,
		})
		var apiErr *client.APIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 APIError, got %v", err)
		}
	})

	t.Run("falls back to long poll when websocket upgrade fails", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Upgrade") != "" {
				http.Error(w, "ws blocked by proxy", http.StatusBadGateway)
				return
			}
			_ = json.NewEncoder(w).Encode(client.WaitEvent{
				Type:    "events",
				Changed: true,
				Status:  "waiting",
				LastSeq: 4,
				Messages: []client.Message{
					{Seq: 4, Sender: "work-laptop", Body: "need review", CreatedAt: time.Now().UnixMilli()},
				},
			})
		}))
		defer srv.Close()

		c := client.New(srv.URL, "tok_123")
		ev, err := c.Wait(context.Background(), "amber-falcon-drift", client.WaitOptions{
			Since:   3,
			Timeout: 5 * time.Second,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ev.LastSeq != 4 || len(ev.Messages) != 1 {
			t.Fatalf("unexpected event: %+v", ev)
		}
	})

	t.Run("subsecond forced poll still queries server", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(client.WaitEvent{
				Type:    "events",
				Changed: true,
				Status:  "open",
				LastSeq: 2,
				Messages: []client.Message{
					{Seq: 2, Sender: "macbook", Body: "already here", CreatedAt: time.Now().UnixMilli()},
				},
			})
		}))
		defer srv.Close()

		c := client.New(srv.URL, "tok_123")
		ev, err := c.Wait(context.Background(), "amber-falcon-drift", client.WaitOptions{
			Since:     1,
			Timeout:   500 * time.Millisecond,
			ForcePoll: true,
		})
		if err != nil {
			t.Fatalf("expected immediate event on 500ms poll, got error: %v", err)
		}
		if ev.LastSeq != 2 {
			t.Fatalf("unexpected event: %+v", ev)
		}
	})

	t.Run("upload and safe no-clobber download with sha256 verification", func(t *testing.T) {
		payload := []byte("diff --git a/x b/x\n")
		sum := sha256.Sum256(payload)
		validHash := hex.EncodeToString(sum[:])
		serveBadHash := false

		var saved []byte
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodPost:
				b := make([]byte, r.ContentLength)
				_, _ = r.Body.Read(b)
				saved = b
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(client.Attachment{
					ID:        "att_1",
					Filename:  r.Header.Get("X-Filename"),
					SizeBytes: int64(len(b)),
					SHA256:    validHash,
				})
			case http.MethodGet:
				w.Header().Set("Content-Disposition", `attachment; filename="patch.diff"`)
				if serveBadHash {
					w.Header().Set("X-Attachment-Sha256", "0000000000000000000000000000000000000000000000000000000000000000")
				} else {
					w.Header().Set("X-Attachment-Sha256", validHash)
				}
				_, _ = w.Write(saved)
			}
		}))
		defer srv.Close()

		tmp := t.TempDir()
		src := filepath.Join(tmp, "patch.diff")
		if err := os.WriteFile(src, payload, 0o644); err != nil {
			t.Fatal(err)
		}

		c := client.New(srv.URL, "tok_123")
		att, err := c.UploadAttachment(context.Background(), "amber-falcon-drift", src, "dev")
		if err != nil {
			t.Fatalf("upload failed: %v", err)
		}
		if att.ID != "att_1" || att.Filename != "patch.diff" {
			t.Fatalf("unexpected attachment: %+v", att)
		}

		dest := filepath.Join(tmp, "out.diff")
		written, n, err := c.DownloadAttachment(context.Background(), "amber-falcon-drift", "att_1", dest, false)
		if err != nil {
			t.Fatalf("download failed: %v", err)
		}
		if written != dest || n != int64(len(payload)) {
			t.Fatalf("unexpected download: %s (%d bytes)", written, n)
		}

		// Second download without --force must fail with no-clobber
		if _, _, err := c.DownloadAttachment(context.Background(), "amber-falcon-drift", "att_1", dest, false); err == nil {
			t.Fatalf("expected no-clobber error on existing destination")
		}

		// With --force it must succeed
		if _, _, err := c.DownloadAttachment(context.Background(), "amber-falcon-drift", "att_1", dest, true); err != nil {
			t.Fatalf("expected --force overwrite to succeed: %v", err)
		}

		// Checksum mismatch must fail and leave no destination file
		serveBadHash = true
		badDest := filepath.Join(tmp, "bad.diff")
		if _, _, err := c.DownloadAttachment(context.Background(), "amber-falcon-drift", "att_1", badDest, false); err == nil {
			t.Fatalf("expected checksum mismatch error")
		}
		if _, err := os.Stat(badDest); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("expected failed download not to create %s", badDest)
		}
	})
}
