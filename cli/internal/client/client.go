package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

var ErrWaitTimeout = errors.New("wait timed out")

const wsCloseRevoked websocket.StatusCode = 4001

type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("server returned %d: %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("server returned %d", e.StatusCode)
}

type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

type Machine struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"created_at"`
	LastSeenAt *int64 `json:"last_seen_at,omitempty"`
}

type Attachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
	Sender      string `json:"sender"`
	CreatedAt   int64  `json:"created_at"`
}

type Message struct {
	Seq         int          `json:"seq"`
	Sender      string       `json:"sender"`
	Body        string       `json:"body"`
	Status      string       `json:"status,omitempty"`
	Attachments []Attachment `json:"attachments"`
	CreatedAt   int64        `json:"created_at"`
}

type RoomSnapshot struct {
	UID         string       `json:"uid"`
	Title       string       `json:"title"`
	Status      string       `json:"status"`
	CreatedBy   string       `json:"created_by"`
	CreatedAt   int64        `json:"created_at"`
	UpdatedAt   int64        `json:"updated_at"`
	ExpiresAt   int64        `json:"expires_at"`
	TTLMs       int64        `json:"ttl_ms,omitempty"`
	Rev         int          `json:"rev,omitempty"`
	LastSeq     int          `json:"last_seq"`
	Messages    []Message    `json:"messages"`
	Attachments []Attachment `json:"attachments"`
}

type PostMessageResponse struct {
	Seq          int     `json:"seq"`
	Message      Message `json:"message"`
	Status       string  `json:"status"`
	LastSeq      int     `json:"last_seq"`
	ExpiresAt    int64   `json:"expires_at"`
	Rev          int     `json:"rev,omitempty"`
	MessageCount int     `json:"message_count"`
}

type WaitEvent struct {
	Type     string    `json:"type"`
	Changed  bool      `json:"changed"`
	Purged   bool      `json:"purged,omitempty"`
	Status   string    `json:"status"`
	LastSeq  int       `json:"last_seq"`
	Messages []Message `json:"messages"`
}

type CloseResponse struct {
	UID     string `json:"uid"`
	Status  string `json:"status"`
	Purged  bool   `json:"purged"`
	LastSeq int    `json:"last_seq,omitempty"`
}

type DeviceStartResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_url"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

type DevicePollResponse struct {
	Status  string   `json:"status"`
	Token   string   `json:"token,omitempty"`
	Machine *Machine `json:"machine,omitempty"`
	Error   string   `json:"error,omitempty"`
}

func (c *Client) doJSON(ctx context.Context, method, path string, reqBody any, out any, auth bool) error {
	var bodyReader io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bodyReader)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth && c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode >= 400 {
		var errBody struct {
			Error  string `json:"error"`
			Status string `json:"status"`
		}
		_ = json.Unmarshal(data, &errBody)
		msg := errBody.Error
		if msg == "" {
			msg = strings.TrimSpace(string(data))
		}
		return &APIError{StatusCode: resp.StatusCode, Message: msg}
	}

	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

func (c *Client) DeviceStart(ctx context.Context, machineName string) (*DeviceStartResponse, error) {
	var out DeviceStartResponse
	err := c.doJSON(ctx, http.MethodPost, "/api/device/start", map[string]string{
		"machine_name": machineName,
	}, &out, false)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DevicePoll(ctx context.Context, deviceCode string) (*DevicePollResponse, error) {
	b, _ := json.Marshal(map[string]string{"device_code": deviceCode})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/device/poll", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var out DevicePollResponse
	if err := json.Unmarshal(data, &out); err != nil {
		if resp.StatusCode >= 400 {
			return nil, &APIError{StatusCode: resp.StatusCode, Message: strings.TrimSpace(string(data))}
		}
		return nil, err
	}
	return &out, nil
}

func (c *Client) WhoAmI(ctx context.Context) (*Machine, error) {
	var out struct {
		Machine Machine `json:"machine"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/api/whoami", nil, &out, true); err != nil {
		return nil, err
	}
	return &out.Machine, nil
}

func (c *Client) CreateTask(ctx context.Context, title, note, as string, ttlDays int) (*RoomSnapshot, error) {
	payload := map[string]any{}
	if title != "" {
		payload["title"] = title
	}
	if note != "" {
		payload["note"] = note
	}
	if as != "" {
		payload["as"] = as
	}
	if ttlDays > 0 {
		payload["ttl_days"] = ttlDays
	}
	var out RoomSnapshot
	if err := c.doJSON(ctx, http.MethodPost, "/api/tasks", payload, &out, true); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetTask(ctx context.Context, uid string, since int) (*RoomSnapshot, error) {
	path := fmt.Sprintf("/api/tasks/%s?since=%d", url.PathEscape(uid), since)
	var out RoomSnapshot
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &out, true); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) PostMessage(ctx context.Context, uid, body, as, status string, attachmentIDs []string) (*PostMessageResponse, error) {
	payload := map[string]any{
		"body": body,
	}
	if as != "" {
		payload["as"] = as
	}
	if status != "" {
		payload["status"] = status
	}
	if len(attachmentIDs) > 0 {
		payload["attachment_ids"] = attachmentIDs
	}
	var out PostMessageResponse
	path := fmt.Sprintf("/api/tasks/%s/messages", url.PathEscape(uid))
	if err := c.doJSON(ctx, http.MethodPost, path, payload, &out, true); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UploadAttachment(ctx context.Context, uid, filePath, as string) (*Attachment, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	filename := filepath.Base(filePath)
	contentType := mime.TypeByExtension(filepath.Ext(filename))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}

	endpoint := fmt.Sprintf("%s/api/tasks/%s/attachments", c.BaseURL, url.PathEscape(uid))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Filename", filename)
	if as != "" {
		req.Header.Set("X-As", as)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		var errBody struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respBytes, &errBody)
		msg := errBody.Error
		if msg == "" {
			msg = strings.TrimSpace(string(respBytes))
		}
		return nil, &APIError{StatusCode: resp.StatusCode, Message: msg}
	}

	var out Attachment
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DownloadAttachment streams the attachment into a temp file, verifies its SHA-256
// if provided by the server, and publishes it safely (no-clobber and no symlink
// following unless force=true, which still replaces atomically via rename).
func (c *Client) DownloadAttachment(ctx context.Context, uid, attachmentID, destPath string, force bool) (string, int64, error) {
	endpoint := fmt.Sprintf("%s/api/tasks/%s/attachments/%s", c.BaseURL, url.PathEscape(uid), url.PathEscape(attachmentID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		var errBody struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &errBody)
		msg := errBody.Error
		if msg == "" {
			msg = strings.TrimSpace(string(body))
		}
		return "", 0, &APIError{StatusCode: resp.StatusCode, Message: msg}
	}

	outPath := destPath
	if outPath == "" {
		filename := attachmentID
		if cd := resp.Header.Get("Content-Disposition"); cd != "" {
			if _, params, err := mime.ParseMediaType(cd); err == nil && params["filename"] != "" {
				candidate := filepath.Base(params["filename"])
				if candidate != "" && candidate != "." && candidate != ".." {
					filename = candidate
				}
			}
		}
		outPath = filename
	}

	dir := filepath.Dir(outPath)
	if dir == "" {
		dir = "."
	}
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", 0, err
		}
	}

	// Fast-fail before writing if destination already exists and --force wasn't passed
	if !force {
		if _, err := os.Lstat(outPath); err == nil {
			return "", 0, fmt.Errorf("destination %q already exists (use --force to overwrite or -o to choose another path)", outPath)
		}
	}

	tmp, err := os.CreateTemp(dir, ".tasks-dl-*")
	if err != nil {
		return "", 0, err
	}
	tmpPath := tmp.Name()
	cleanupTmp := true
	defer func() {
		if cleanupTmp {
			_ = os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, hasher), resp.Body)
	if err != nil {
		_ = tmp.Close()
		return "", 0, err
	}
	if err := tmp.Close(); err != nil {
		return "", 0, err
	}

	if expectedHash := strings.TrimSpace(resp.Header.Get("X-Attachment-Sha256")); expectedHash != "" {
		actualHash := hex.EncodeToString(hasher.Sum(nil))
		if !strings.EqualFold(actualHash, expectedHash) {
			return "", 0, fmt.Errorf("attachment checksum mismatch: expected %s, got %s", expectedHash, actualHash)
		}
	}

	if force {
		if err := os.Rename(tmpPath, outPath); err != nil {
			return "", 0, err
		}
		cleanupTmp = false
		return outPath, n, nil
	}

	// Atomic no-clobber publish via hard link (does not follow symlinks or overwrite existing files)
	if err := os.Link(tmpPath, outPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			return "", 0, fmt.Errorf("destination %q already exists (use --force to overwrite or -o to choose another path)", outPath)
		}
		return "", 0, err
	}
	_ = os.Remove(tmpPath)
	cleanupTmp = false
	return outPath, n, nil
}

func (c *Client) CloseTask(ctx context.Context, uid, note, as string, purge bool) (*CloseResponse, error) {
	payload := map[string]any{
		"purge": purge,
	}
	if note != "" {
		payload["note"] = note
	}
	if as != "" {
		payload["as"] = as
	}
	var out CloseResponse
	path := fmt.Sprintf("/api/tasks/%s/close", url.PathEscape(uid))
	if err := c.doJSON(ctx, http.MethodPost, path, payload, &out, true); err != nil {
		return nil, err
	}
	return &out, nil
}

type WaitOptions struct {
	Since     int
	Mention   string
	Timeout   time.Duration
	ForcePoll bool
}

// Wait blocks until matching events arrive after opts.Since, or opts.Timeout elapses.
// Uses WebSocket with 20s heartbeat pings and automatic reconnect, seamlessly falling
// back to HTTP long-polling if WebSocket upgrades fail consecutively.
func (c *Client) Wait(ctx context.Context, uid string, opts WaitOptions) (*WaitEvent, error) {
	if opts.Timeout <= 0 {
		opts.Timeout = time.Hour
	}
	waitCtx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	usePoll := opts.ForcePoll
	wsFailures := 0

	for {
		if waitCtx.Err() != nil {
			if errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
				return nil, ErrWaitTimeout
			}
			return nil, waitCtx.Err()
		}

		if !usePoll {
			ev, connected, err := c.waitWebSocketOnce(waitCtx, uid, opts.Since, opts.Mention)
			if connected {
				wsFailures = 0
			}
			if err == nil && ev != nil {
				return ev, nil
			}
			if waitCtx.Err() != nil {
				if errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
					return nil, ErrWaitTimeout
				}
				return nil, waitCtx.Err()
			}
			var apiErr *APIError
			if errors.As(err, &apiErr) && (apiErr.StatusCode == 401 || apiErr.StatusCode == 403 || apiErr.StatusCode == 404) {
				return nil, apiErr
			}
			if !connected {
				wsFailures++
				if wsFailures >= 2 {
					usePoll = true
					continue
				}
			}
			select {
			case <-waitCtx.Done():
				return nil, ErrWaitTimeout
			case <-time.After(time.Second):
			}
			continue
		}

		ev, err := c.waitLongPollOnce(waitCtx, uid, opts.Since, opts.Mention)
		if err != nil {
			if waitCtx.Err() != nil {
				if errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
					return nil, ErrWaitTimeout
				}
				return nil, waitCtx.Err()
			}
			var apiErr *APIError
			if errors.As(err, &apiErr) && (apiErr.StatusCode == 401 || apiErr.StatusCode == 403 || apiErr.StatusCode == 404) {
				return nil, apiErr
			}
			select {
			case <-waitCtx.Done():
				return nil, ErrWaitTimeout
			case <-time.After(2 * time.Second):
			}
			continue
		}
		if ev != nil && ev.Changed {
			return ev, nil
		}
	}
}

func (c *Client) waitWebSocketOnce(ctx context.Context, uid string, since int, mention string) (*WaitEvent, bool, error) {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return nil, false, err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + fmt.Sprintf("/api/tasks/%s/wait", url.PathEscape(uid))
	q := u.Query()
	q.Set("since", strconv.Itoa(since))
	if mention != "" {
		q.Set("mention", mention)
	}
	u.RawQuery = q.Encode()

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+c.Token)

	conn, resp, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{
		HTTPClient: c.HTTPClient,
		HTTPHeader: headers,
	})
	if err != nil {
		if resp != nil && resp.StatusCode >= 400 {
			return nil, false, &APIError{StatusCode: resp.StatusCode, Message: err.Error()}
		}
		return nil, false, err
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")
	conn.SetReadLimit(4 * 1024 * 1024)

	pingDone := make(chan struct{})
	defer close(pingDone)
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pingDone:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
				_ = conn.Write(wctx, websocket.MessageText, []byte("ping"))
				wcancel()
			}
		}
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == wsCloseRevoked {
				return nil, true, &APIError{StatusCode: http.StatusUnauthorized, Message: "invalid or revoked token"}
			}
			return nil, true, err
		}
		if string(data) == "pong" {
			continue
		}
		var ev WaitEvent
		if err := json.Unmarshal(data, &ev); err != nil {
			return nil, true, err
		}
		if ev.Type == "revoked" {
			return nil, true, &APIError{StatusCode: http.StatusUnauthorized, Message: "invalid or revoked token"}
		}
		if ev.Changed {
			return &ev, true, nil
		}
	}
}

func (c *Client) waitLongPollOnce(ctx context.Context, uid string, since int, mention string) (*WaitEvent, error) {
	timeoutSec := 25
	if deadline, ok := ctx.Deadline(); ok {
		rem := time.Until(deadline)
		if rem <= 0 {
			return nil, ErrWaitTimeout
		}
		// Round up so subsecond deadlines still issue the poll while ctx enforces the exact cutoff
		sec := int(math.Ceil(rem.Seconds()))
		if sec < 1 {
			sec = 1
		}
		if sec < timeoutSec {
			timeoutSec = sec
		}
	}

	q := url.Values{}
	q.Set("since", strconv.Itoa(since))
	q.Set("timeout", strconv.Itoa(timeoutSec))
	if mention != "" {
		q.Set("mention", mention)
	}
	path := fmt.Sprintf("/api/tasks/%s/wait?%s", url.PathEscape(uid), q.Encode())

	var ev WaitEvent
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &ev, true); err != nil {
		return nil, err
	}
	return &ev, nil
}
