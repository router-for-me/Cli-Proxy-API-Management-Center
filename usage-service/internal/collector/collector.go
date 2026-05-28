package collector

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/seakee/cpa-manager/usage-service/internal/config"
	"github.com/seakee/cpa-manager/usage-service/internal/httpqueue"
	"github.com/seakee/cpa-manager/usage-service/internal/resp"
	"github.com/seakee/cpa-manager/usage-service/internal/store"
	"github.com/seakee/cpa-manager/usage-service/internal/usage"
)

type Status struct {
	Collector      string `json:"collector"`
	Upstream       string `json:"upstream"`
	Mode           string `json:"mode"`
	Transport      string `json:"transport"`
	Queue          string `json:"queue"`
	LastConsumedAt int64  `json:"lastConsumedAt"`
	LastInsertedAt int64  `json:"lastInsertedAt"`
	TotalInserted  int64  `json:"totalInserted"`
	TotalSkipped   int64  `json:"totalSkipped"`
	DeadLetters    int64  `json:"deadLetters"`
	LastError      string `json:"lastError,omitempty"`
}

type RuntimeConfig struct {
	CPAUpstreamURL string
	ManagementKey  string
	CollectorMode  string
	Queue          string
	PopSide        string
	BatchSize      int
	PollInterval   time.Duration
	TLSSkipVerify  bool
}

type Manager struct {
	base             config.Config
	store            *store.Store
	snapshotResolver *authSnapshotResolver
	mu               sync.Mutex
	cancel           context.CancelFunc
	status           Status
	runtimeCfg       RuntimeConfig
}

func NewManager(base config.Config, store *store.Store) *Manager {
	return &Manager{
		base:             base,
		store:            store,
		snapshotResolver: newAuthSnapshotResolver(),
		status: Status{
			Collector: "stopped",
			Mode:      collectorMode(base.CollectorMode),
			Queue:     base.Queue,
		},
	}
}

func (m *Manager) Start(ctx context.Context, cfg RuntimeConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.runtimeCfg = cfg
	m.status.Collector = "starting"
	m.status.Upstream = cfg.CPAUpstreamURL
	m.status.Mode = collectorMode(valueOr(cfg.CollectorMode, m.base.CollectorMode))
	m.status.Transport = ""
	m.status.Queue = valueOr(cfg.Queue, m.base.Queue)
	m.status.LastError = ""

	runCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	go m.run(runCtx, cfg)
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.status.Collector = "stopped"
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *Manager) setStatus(update func(*Status)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	update(&m.status)
}

func (m *Manager) run(ctx context.Context, cfg RuntimeConfig) {
	mode := collectorMode(valueOr(cfg.CollectorMode, m.base.CollectorMode))

	if mode == "subscribe" {
		m.runSubscribe(ctx, cfg, mode)
		return
	}
	if mode == "auto" && m.runSubscribe(ctx, cfg, mode) {
		return
	}
	if mode == "http" {
		m.runHTTP(ctx, cfg, mode)
		return
	}
	if mode == "auto" && m.runHTTP(ctx, cfg, mode) {
		return
	}
	m.runRESP(ctx, cfg)
}

// runSubscribe 走 Redis Pub/Sub 订阅模式（CPA v7.0.7+）。返回值含义：
//   - true：ctx 已取消或永久退出，调用方无需降级
//   - false：协议不支持，且 mode=auto 时应降级到 HTTP/RESP
//
// mode=auto 时仅"首次探测"失败才降级；一旦订阅成功后再次断连则坚持订阅模式重连。
func (m *Manager) runSubscribe(ctx context.Context, cfg RuntimeConfig, mode string) bool {
	channel := valueOr(cfg.Queue, m.base.Queue)
	backoff := time.Second
	subscribed := false

	fallback := func() bool {
		m.setStatus(func(status *Status) {
			status.Collector = "starting"
			status.Transport = "http"
			status.LastError = ""
		})
		return false
	}

	for {
		if ctx.Err() != nil {
			return true
		}
		client, err := resp.Dial(cfg.CPAUpstreamURL, cfg.TLSSkipVerify)
		if err != nil {
			if mode == "auto" && !subscribed {
				return fallback()
			}
			m.markError("connect", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
			continue
		}
		if err := client.Auth(cfg.ManagementKey); err != nil {
			_ = client.Close()
			if mode == "auto" && !subscribed {
				return fallback()
			}
			m.markError("auth", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
			continue
		}
		if err := client.Subscribe(channel); err != nil {
			_ = client.Close()
			if mode == "auto" && !subscribed {
				return fallback()
			}
			m.markError("subscribe", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
			continue
		}
		subscribed = true
		backoff = time.Second
		m.setStatus(func(status *Status) {
			status.Collector = "running"
			status.Transport = "subscribe"
			status.LastError = ""
		})

		err = m.consumeSubscribe(ctx, cfg, client)
		_ = client.Close()
		if ctx.Err() != nil {
			return true
		}
		if err != nil {
			m.markError("subscribe", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
		}
	}
}

func (m *Manager) consumeSubscribe(ctx context.Context, cfg RuntimeConfig, client *resp.Client) error {
	const pingInterval = 30 * time.Second
	const readWindow = pingInterval + 10*time.Second

	// 通过后台 goroutine 监听 ctx，触发读超时让阻塞中的 ReadMessage 立即返回。
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = client.SetReadDeadline(time.Now())
		case <-done:
		}
	}()

	lastPing := time.Now()
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := client.SetReadDeadline(time.Now().Add(readWindow)); err != nil {
			return err
		}
		_, payload, err := client.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				if time.Since(lastPing) >= pingInterval {
					if perr := client.SendSubscribePing(); perr != nil {
						return perr
					}
					lastPing = time.Now()
				}
				continue
			}
			return err
		}
		if strings.TrimSpace(payload) == "" {
			continue
		}
		if err := m.processItems(ctx, cfg, []string{payload}); err != nil {
			return err
		}
	}
}

func (m *Manager) runHTTP(ctx context.Context, cfg RuntimeConfig, mode string) bool {
	client := httpqueue.New(cfg.CPAUpstreamURL, cfg.ManagementKey)
	backoff := time.Second

	for {
		if ctx.Err() != nil {
			return true
		}
		err := m.consumeHTTP(ctx, cfg, client)
		if ctx.Err() != nil {
			return true
		}
		if errors.Is(err, httpqueue.ErrUnsupported) && mode == "auto" {
			m.setStatus(func(status *Status) {
				status.Collector = "starting"
				status.Transport = "resp"
				status.LastError = ""
			})
			return false
		}
		if err != nil {
			m.markError("http", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
		}
	}
}

func (m *Manager) runRESP(ctx context.Context, cfg RuntimeConfig) {
	queue := valueOr(cfg.Queue, m.base.Queue)
	popSide := valueOr(cfg.PopSide, m.base.PopSide)
	backoff := time.Second

	for {
		if ctx.Err() != nil {
			return
		}
		client, err := resp.Dial(cfg.CPAUpstreamURL, cfg.TLSSkipVerify)
		if err != nil {
			m.markError("connect", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
			continue
		}
		if err := client.Auth(cfg.ManagementKey); err != nil {
			_ = client.Close()
			m.markError("auth", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
			continue
		}
		backoff = time.Second
		m.setStatus(func(status *Status) {
			status.Collector = "running"
			status.Transport = "resp"
			status.LastError = ""
		})

		err = m.consumeRESP(ctx, cfg, client, queue, popSide)
		_ = client.Close()
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			m.markError("consume", err)
			sleep(ctx, backoff)
			backoff = nextBackoff(backoff)
		}
	}
}

func (m *Manager) consumeHTTP(ctx context.Context, cfg RuntimeConfig, client *httpqueue.Client) error {
	ticker := time.NewTicker(m.pollInterval(cfg))
	defer ticker.Stop()

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		m.setStatus(func(status *Status) {
			status.Collector = "running"
			status.Transport = "http"
			status.LastError = ""
		})
		items, err := client.Pop(ctx, m.batchSize(cfg))
		if err != nil {
			return err
		}
		if len(items) == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-ticker.C:
				continue
			}
		}
		if err := m.processItems(ctx, cfg, items); err != nil {
			return err
		}
	}
}

func (m *Manager) consumeRESP(ctx context.Context, cfg RuntimeConfig, client *resp.Client, queue string, popSide string) error {
	ticker := time.NewTicker(m.pollInterval(cfg))
	defer ticker.Stop()

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		items, err := client.Pop(queue, popSide, m.batchSize(cfg))
		if err != nil {
			return err
		}
		if len(items) == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-ticker.C:
				continue
			}
		}
		if err := m.processItems(ctx, cfg, items); err != nil {
			return err
		}
	}
}

func (m *Manager) processItems(ctx context.Context, cfg RuntimeConfig, items []string) error {
	if len(items) == 0 {
		return nil
	}
	m.setStatus(func(status *Status) {
		status.LastConsumedAt = time.Now().UnixMilli()
	})
	events := make([]usage.Event, 0, len(items))
	for _, item := range items {
		event, err := usage.NormalizeRaw([]byte(item))
		if err != nil {
			_ = m.store.AddDeadLetter(ctx, item, err)
			m.setStatus(func(status *Status) {
				status.DeadLetters++
			})
			continue
		}
		events = append(events, event)
	}
	m.enrichAccountSnapshots(ctx, cfg, events)
	result, err := m.store.InsertEvents(ctx, events)
	if err != nil {
		return err
	}
	if result.Inserted > 0 || result.Skipped > 0 {
		m.setStatus(func(status *Status) {
			status.LastInsertedAt = time.Now().UnixMilli()
			status.TotalInserted += int64(result.Inserted)
			status.TotalSkipped += int64(result.Skipped)
		})
	}
	return nil
}

func (m *Manager) enrichAccountSnapshots(ctx context.Context, cfg RuntimeConfig, events []usage.Event) {
	if len(events) == 0 || m.snapshotResolver == nil {
		return
	}
	authIndices := make(map[string]struct{})
	for i := range events {
		if events[i].AccountSnapshot != "" || events[i].AuthIndex == "" {
			continue
		}
		authIndices[events[i].AuthIndex] = struct{}{}
	}
	if len(authIndices) == 0 {
		return
	}
	snapshots := m.snapshotResolver.lookup(ctx, cfg, authIndices)
	if len(snapshots) == 0 {
		return
	}
	for i := range events {
		if events[i].AuthIndex == "" || events[i].AccountSnapshot != "" {
			continue
		}
		snapshot, ok := snapshots[events[i].AuthIndex]
		if !ok {
			continue
		}
		events[i].AccountSnapshot = snapshot.Account
		events[i].AuthLabelSnapshot = snapshot.Label
		events[i].AuthFileSnapshot = snapshot.FileName
		events[i].AuthProviderSnapshot = snapshot.Provider
		if events[i].AuthProjectIDSnapshot == "" {
			events[i].AuthProjectIDSnapshot = snapshot.ProjectID
		}
		events[i].AuthSnapshotAtMS = snapshot.CapturedAtMS
	}
}

func (m *Manager) markError(stage string, err error) {
	m.setStatus(func(status *Status) {
		status.Collector = "error"
		status.LastError = stage + ": " + err.Error()
	})
}

func sleep(ctx context.Context, duration time.Duration) {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > 30*time.Second {
		return 30 * time.Second
	}
	return next
}

func valueOr(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func collectorMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "http", "resp", "subscribe":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "auto"
	}
}

func (m *Manager) batchSize(cfg RuntimeConfig) int {
	if cfg.BatchSize > 0 {
		return cfg.BatchSize
	}
	if m.base.BatchSize <= 0 {
		return 100
	}
	return m.base.BatchSize
}

func (m *Manager) pollInterval(cfg RuntimeConfig) time.Duration {
	if cfg.PollInterval > 0 {
		return cfg.PollInterval
	}
	if m.base.PollInterval <= 0 {
		return 500 * time.Millisecond
	}
	return m.base.PollInterval
}
