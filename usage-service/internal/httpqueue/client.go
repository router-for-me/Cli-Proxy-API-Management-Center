package httpqueue

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrUnsupported = errors.New("http usage queue is unsupported")

type StatusError struct {
	StatusCode int
	Status     string
	Body       string
}

func (e *StatusError) Error() string {
	if e.Body == "" {
		return "usage queue request failed: " + e.Status
	}
	return "usage queue request failed: " + e.Status + ": " + e.Body
}

type Client struct {
	BaseURL       string
	ManagementKey string
	HTTPClient    *http.Client
}

func New(baseURL string, managementKey string) *Client {
	return &Client{
		BaseURL:       strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		ManagementKey: strings.TrimSpace(managementKey),
		HTTPClient:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Pop(ctx context.Context, count int) ([]string, error) {
	if count <= 0 {
		count = 1
	}
	endpoint, err := c.endpoint(count)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if c.ManagementKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.ManagementKey)
	}

	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 1024))
		if isUnsupportedStatus(res.StatusCode) {
			return nil, fmt.Errorf("%w: %s", ErrUnsupported, res.Status)
		}
		return nil, &StatusError{
			StatusCode: res.StatusCode,
			Status:     res.Status,
			Body:       strings.TrimSpace(string(body)),
		}
	}

	var entries []json.RawMessage
	decoder := json.NewDecoder(res.Body)
	if err := decoder.Decode(&entries); err != nil {
		return nil, err
	}

	items := make([]string, 0, len(entries))
	for _, entry := range entries {
		trimmed := bytes.TrimSpace(entry)
		if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
			continue
		}
		if trimmed[0] == '"' {
			var text string
			if err := json.Unmarshal(trimmed, &text); err != nil {
				return nil, err
			}
			if strings.TrimSpace(text) != "" {
				items = append(items, text)
			}
			continue
		}
		if trimmed[0] != '{' {
			return nil, fmt.Errorf("unexpected usage queue item %s", string(trimmed))
		}
		items = append(items, string(trimmed))
	}
	return items, nil
}

func (c *Client) endpoint(count int) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if base == "" {
		return "", errors.New("upstream URL is empty")
	}
	if !strings.Contains(base, "://") {
		base = "http://" + base
	}
	parsed, err := url.Parse(base + "/v0/management/usage-queue")
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("count", strconv.Itoa(count))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func isUnsupportedStatus(status int) bool {
	return status == http.StatusNotFound ||
		status == http.StatusMethodNotAllowed ||
		status == http.StatusNotImplemented
}
