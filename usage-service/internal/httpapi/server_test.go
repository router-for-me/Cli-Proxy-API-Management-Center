package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seakee/cpa-manager/usage-service/internal/collector"
	"github.com/seakee/cpa-manager/usage-service/internal/config"
	"github.com/seakee/cpa-manager/usage-service/internal/store"
)

type observedRequest struct {
	path  string
	query string
	auth  string
}

func newTestHandler(t *testing.T, upstreamURL string, saveSetup bool) http.Handler {
	t.Helper()

	cfg := config.Config{
		DBPath:      filepath.Join(t.TempDir(), "usage.sqlite"),
		Queue:       "usage",
		PopSide:     "right",
		CORSOrigins: []string{"*"},
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	if saveSetup {
		err := db.SaveSetup(context.Background(), store.Setup{
			CPAUpstreamURL: upstreamURL,
			ManagementKey:  "management-key",
			Queue:          "usage",
			PopSide:        "right",
		})
		if err != nil {
			t.Fatalf("save setup: %v", err)
		}
	}

	manager := collector.NewManager(cfg, db)
	return New(cfg, db, manager).Handler()
}

func newTestHandlerWithConfig(t *testing.T, cfg config.Config) http.Handler {
	t.Helper()

	if cfg.DBPath == "" {
		cfg.DBPath = filepath.Join(t.TempDir(), "usage.sqlite")
	}
	if len(cfg.CORSOrigins) == 0 {
		cfg.CORSOrigins = []string{"*"}
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	manager := collector.NewManager(cfg, db)
	return New(cfg, db, manager).Handler()
}

func TestModelListProxyPreservesAuthorization(t *testing.T) {
	for _, path := range []string{"/v1/models", "/models"} {
		t.Run(path, func(t *testing.T) {
			observed := make(chan observedRequest, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				observed <- observedRequest{
					path:  r.URL.Path,
					query: r.URL.RawQuery,
					auth:  r.Header.Get("Authorization"),
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"}]}`))
			}))
			t.Cleanup(upstream.Close)

			handler := newTestHandler(t, upstream.URL, true)
			req := httptest.NewRequest(http.MethodGet, path+"?limit=20", nil)
			req.Header.Set("Authorization", "Bearer upstream-key")
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "gpt-4o") {
				t.Fatalf("response body = %s", rr.Body.String())
			}

			var got observedRequest
			select {
			case got = <-observed:
			default:
				t.Fatal("upstream was not called")
			}
			if got.path != path {
				t.Fatalf("proxied path = %q, want %q", got.path, path)
			}
			if got.query != "limit=20" {
				t.Fatalf("proxied query = %q, want limit=20", got.query)
			}
			if got.auth != "Bearer upstream-key" {
				t.Fatalf("proxied authorization = %q", got.auth)
			}
		})
	}
}

func TestUsageImportAcceptsLegacyExportAndSkipsDuplicates(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	payload := `{
	  "version": 1,
	  "exported_at": "2026-01-02T03:04:05Z",
	  "usage": {
	    "apis": {
	      "POST /v1/chat/completions": {
	        "models": {
	          "gpt-4o": {
	            "details": [
	              {
	                "timestamp": "2026-01-02T03:04:05Z",
	                "source": "alice@example.com",
	                "auth_index": "auth-1",
	                "tokens": {
	                  "input_tokens": 10,
	                  "output_tokens": 20,
	                  "total_tokens": 30
	                },
	                "failed": false
	              }
	            ]
	          }
	        }
	      }
	    }
	  }
	}`

	first := postUsageImport(t, handler, payload)
	if first.Format != "legacy_usage_export" || first.Added != 1 || first.Skipped != 0 || first.Total != 1 {
		t.Fatalf("first import = %#v", first)
	}
	if len(first.Warnings) == 0 {
		t.Fatalf("expected legacy warnings: %#v", first)
	}

	second := postUsageImport(t, handler, payload)
	if second.Format != "legacy_usage_export" || second.Added != 0 || second.Skipped != 1 || second.Total != 1 {
		t.Fatalf("second import = %#v", second)
	}
}

func postUsageImport(t *testing.T, handler http.Handler, payload string) struct {
	Format      string   `json:"format"`
	Added       int      `json:"added"`
	Skipped     int      `json:"skipped"`
	Total       int      `json:"total"`
	Failed      int      `json:"failed"`
	Unsupported int      `json:"unsupported"`
	Warnings    []string `json:"warnings"`
} {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v0/management/usage/import", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("import status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Format      string   `json:"format"`
		Added       int      `json:"added"`
		Skipped     int      `json:"skipped"`
		Total       int      `json:"total"`
		Failed      int      `json:"failed"`
		Unsupported int      `json:"unsupported"`
		Warnings    []string `json:"warnings"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return response
}

func TestModelListProxyRequiresSetup(t *testing.T) {
	handler := newTestHandler(t, "", false)
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "usage service is not configured") {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestSetupRejectsDifferentUpstreamWithoutExistingAuthorization(t *testing.T) {
	currentUpstream := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(currentUpstream.Close)

	nextValidationCalled := make(chan struct{}, 1)
	nextUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case nextValidationCalled <- struct{}{}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(nextUpstream.Close)

	handler := newTestHandler(t, currentUpstream.URL, true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/setup",
		bytes.NewBufferString(`{"cpaBaseUrl":"`+nextUpstream.URL+`","managementKey":"rotated-key"}`),
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	select {
	case <-nextValidationCalled:
		t.Fatal("new upstream should not be validated without existing setup authorization")
	default:
	}
}

func TestSetupAllowsKeyRotationForSameUpstreamWithValidNewKey(t *testing.T) {
	observed := make(chan observedRequest, 10)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" {
			observed <- observedRequest{
				path: r.URL.Path,
				auth: r.Header.Get("Authorization"),
			}
		}
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer rotated-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
			return
		}
		if r.URL.Path == "/v0/management/usage-statistics-enabled" &&
			r.Method == http.MethodPut &&
			r.Header.Get("Authorization") == "Bearer rotated-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/setup",
		bytes.NewBufferString(`{"cpaBaseUrl":"`+upstream.URL+`","managementKey":"rotated-key"}`),
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	got := <-observed
	if got.path != "/v0/management/config" {
		t.Fatalf("validation path = %q", got.path)
	}
	if got.auth != "Bearer rotated-key" {
		t.Fatalf("validation authorization = %q", got.auth)
	}

	req = httptest.NewRequest(http.MethodGet, "/status", nil)
	req.Header.Set("Authorization", "Bearer rotated-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status after rotation = %d, body = %s", rr.Code, rr.Body.String())
	}
}

func TestSetupRejectsKeyRotationWhenSetupIsEnvironmentManaged(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer rotated-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandlerWithConfig(t, config.Config{
		CPAUpstreamURL: upstream.URL,
		ManagementKey:  "env-key",
		Queue:          "usage",
		PopSide:        "right",
	})
	req := httptest.NewRequest(
		http.MethodPost,
		"/setup",
		bytes.NewBufferString(`{"cpaBaseUrl":"`+upstream.URL+`","managementKey":"rotated-key"}`),
	)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "environment") {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestManagerConfigRejectsPollIntervalAboveRetention(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":true,"redis-usage-queue-retention-seconds":1}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	body := bytes.NewBufferString(`{"config":{"cpaConnection":{"cpaBaseUrl":"` + upstream.URL + `","managementKey":"management-key"},"collector":{"collectorMode":"auto","queue":"usage","popSide":"right","batchSize":100,"pollIntervalMs":2000,"queryLimit":50000},"externalUsageService":{"enabled":true,"serviceBase":"http://usage.test"}}}`)
	req := httptest.NewRequest(http.MethodPut, "/usage-service/config", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "pollIntervalMs") {
		t.Fatalf("response body = %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"code":"poll_interval_exceeds_retention"`) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestManagerConfigReadsLegacySetup(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, true)
	req := httptest.NewRequest(http.MethodGet, "/usage-service/config", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("config status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"source":"db"`) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), upstream.URL) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"enabled":true`) {
		t.Fatalf("response body = %s", rr.Body.String())
	}
}

func TestSetupCanDisableRequestMonitoring(t *testing.T) {
	configCalls := 0
	enableCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/config" && r.Header.Get("Authorization") == "Bearer management-key" {
			configCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"usage-statistics-enabled":false,"redis-usage-queue-retention-seconds":1}`))
			return
		}
		if r.URL.Path == "/v0/management/usage-statistics-enabled" {
			enableCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestHandler(t, upstream.URL, false)
	body := bytes.NewBufferString(`{"cpaBaseUrl":"` + upstream.URL + `","managementKey":"management-key","requestMonitoringEnabled":false,"ensureUsageStatisticsEnabled":false}`)
	req := httptest.NewRequest(http.MethodPost, "/setup", body)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("setup status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if configCalls != 1 {
		t.Fatalf("config calls = %d, want 1", configCalls)
	}
	if enableCalls != 0 {
		t.Fatalf("enable calls = %d, want 0", enableCalls)
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/status", nil)
	statusReq.Header.Set("Authorization", "Bearer management-key")
	statusRR := httptest.NewRecorder()
	handler.ServeHTTP(statusRR, statusReq)

	if statusRR.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", statusRR.Code, statusRR.Body.String())
	}
	if !strings.Contains(statusRR.Body.String(), `"collector":"stopped"`) {
		t.Fatalf("status body = %s", statusRR.Body.String())
	}

	configReq := httptest.NewRequest(http.MethodGet, "/usage-service/config", nil)
	configReq.Header.Set("Authorization", "Bearer management-key")
	configRR := httptest.NewRecorder()
	handler.ServeHTTP(configRR, configReq)

	if configRR.Code != http.StatusOK {
		t.Fatalf("config status = %d, body = %s", configRR.Code, configRR.Body.String())
	}
	if !strings.Contains(configRR.Body.String(), `"enabled":false`) {
		t.Fatalf("config body = %s", configRR.Body.String())
	}
}

func TestModelPricesSaveAndLoad(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	body := bytes.NewBufferString(`{"prices":{"gpt-test":{"prompt":1.25,"completion":2.5,"cache":0.1}}}`)
	req := httptest.NewRequest(http.MethodPut, "/v0/management/model-prices", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v0/management/model-prices", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("load status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Prices map[string]struct {
			Prompt     float64 `json:"prompt"`
			Completion float64 `json:"completion"`
			Cache      float64 `json:"cache"`
		} `json:"prices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	price, ok := response.Prices["gpt-test"]
	if !ok {
		t.Fatalf("missing saved price: %#v", response.Prices)
	}
	if price.Prompt != 1.25 || price.Completion != 2.5 || price.Cache != 0.1 {
		t.Fatalf("price = %#v", price)
	}
}

func TestAPIKeyAliasesSaveLoadAndDelete(t *testing.T) {
	handler := newTestHandler(t, "http://example.test", true)
	const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	body := bytes.NewBufferString(`{"items":[{"apiKeyHash":"` + hash + `","alias":"Team A"}]}`)
	req := httptest.NewRequest(http.MethodPut, "/v0/management/api-key-aliases", body)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v0/management/api-key-aliases", nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("load status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Items []struct {
			APIKeyHash  string `json:"apiKeyHash"`
			Alias       string `json:"alias"`
			UpdatedAtMS int64  `json:"updatedAtMs"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Items) != 1 {
		t.Fatalf("items = %#v", response.Items)
	}
	if response.Items[0].APIKeyHash != hash || response.Items[0].Alias != "Team A" || response.Items[0].UpdatedAtMS <= 0 {
		t.Fatalf("alias = %#v", response.Items[0])
	}

	const otherHash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	req = httptest.NewRequest(
		http.MethodPut,
		"/v0/management/api-key-aliases",
		bytes.NewBufferString(`{"items":[{"apiKeyHash":"`+otherHash+`","alias":" team a "}]}`),
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("duplicate status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"code":"api_key_alias_duplicate"`) {
		t.Fatalf("duplicate body = %s", rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/v0/management/api-key-aliases/"+hash, nil)
	req.Header.Set("Authorization", "Bearer management-key")
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body = %s", rr.Code, rr.Body.String())
	}
}

func TestModelPricesSyncFromLiteLLMFormat(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"sample_spec": {},
			"gpt-test": {
				"input_cost_per_token": 0.00000125,
				"output_cost_per_token": 0.0000025,
				"cache_read_input_token_cost": 0.0000001,
				"mode": "chat"
			},
			"image-only": {
				"output_cost_per_image": 0.04,
				"mode": "image_generation"
			}
		}`))
	}))
	t.Cleanup(source.Close)
	oldURL := modelPriceSyncURL
	modelPriceSyncURL = source.URL
	t.Cleanup(func() {
		modelPriceSyncURL = oldURL
	})

	handler := newTestHandler(t, "http://example.test", true)
	req := httptest.NewRequest(
		http.MethodPost,
		"/v0/management/model-prices/sync",
		bytes.NewBufferString(`{"models":["gpt-test"]}`),
	)
	req.Header.Set("Authorization", "Bearer management-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("sync status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var response struct {
		Source   string `json:"source"`
		Imported int    `json:"imported"`
		Skipped  int    `json:"skipped"`
		Prices   map[string]struct {
			Prompt        float64 `json:"prompt"`
			Completion    float64 `json:"completion"`
			Cache         float64 `json:"cache"`
			Source        string  `json:"source"`
			SourceModelID string  `json:"sourceModelId"`
		} `json:"prices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Source != "litellm" || response.Imported != 1 || response.Skipped != 2 {
		t.Fatalf("sync summary = %#v", response)
	}
	price, ok := response.Prices["gpt-test"]
	if !ok {
		t.Fatalf("missing synced price: %#v", response.Prices)
	}
	if !closeFloat(price.Prompt, 1.25) || !closeFloat(price.Completion, 2.5) || !closeFloat(price.Cache, 0.1) {
		t.Fatalf("price = %#v", price)
	}
	if price.Source != "litellm" || price.SourceModelID != "gpt-test" {
		t.Fatalf("source metadata = %#v", price)
	}
}

func closeFloat(left float64, right float64) bool {
	return math.Abs(left-right) < 0.0000001
}
