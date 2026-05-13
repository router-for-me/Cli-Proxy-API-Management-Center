package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/seakee/cpa-manager/usage-service/internal/collector"
	"github.com/seakee/cpa-manager/usage-service/internal/config"
	"github.com/seakee/cpa-manager/usage-service/internal/httpapi"
	"github.com/seakee/cpa-manager/usage-service/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	manager := collector.NewManager(cfg, db)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.CPAUpstreamURL != "" && cfg.ManagementKey != "" {
		manager.Start(ctx, collector.RuntimeConfig{
			CPAUpstreamURL: cfg.CPAUpstreamURL,
			ManagementKey:  cfg.ManagementKey,
			CollectorMode:  cfg.CollectorMode,
			Queue:          cfg.Queue,
			PopSide:        cfg.PopSide,
			BatchSize:      cfg.BatchSize,
			PollInterval:   cfg.PollInterval,
			TLSSkipVerify:  cfg.TLSSkipVerify,
		})
	} else if managerCfg, ok, err := db.LoadManagerConfig(ctx); err == nil && ok &&
		managerCfg.CPAConnection.CPABaseURL != "" && managerCfg.CPAConnection.ManagementKey != "" {
		if managerCollectorEnabled(managerCfg) {
			manager.Start(ctx, runtimeConfigFromManagerConfig(managerCfg, cfg))
		}
	} else if setup, ok, err := db.LoadSetup(ctx); err == nil && ok {
		manager.Start(ctx, collector.RuntimeConfig{
			CPAUpstreamURL: setup.CPAUpstreamURL,
			ManagementKey:  setup.ManagementKey,
			CollectorMode:  cfg.CollectorMode,
			Queue:          setup.Queue,
			PopSide:        setup.PopSide,
			BatchSize:      cfg.BatchSize,
			PollInterval:   cfg.PollInterval,
			TLSSkipVerify:  cfg.TLSSkipVerify,
		})
	} else if err != nil {
		log.Printf("load setup: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.New(cfg, db, manager).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("cpa-manager listening on %s", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	manager.Stop()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func runtimeConfigFromManagerConfig(managerCfg store.ManagerConfig, base config.Config) collector.RuntimeConfig {
	pollInterval := time.Duration(managerCfg.Collector.PollIntervalMS) * time.Millisecond
	if pollInterval <= 0 {
		pollInterval = base.PollInterval
	}
	batchSize := managerCfg.Collector.BatchSize
	if batchSize <= 0 {
		batchSize = base.BatchSize
	}
	return collector.RuntimeConfig{
		CPAUpstreamURL: managerCfg.CPAConnection.CPABaseURL,
		ManagementKey:  managerCfg.CPAConnection.ManagementKey,
		CollectorMode:  valueOr(managerCfg.Collector.CollectorMode, base.CollectorMode),
		Queue:          valueOr(managerCfg.Collector.Queue, base.Queue),
		PopSide:        valueOr(managerCfg.Collector.PopSide, base.PopSide),
		BatchSize:      batchSize,
		PollInterval:   pollInterval,
		TLSSkipVerify:  managerCfg.Collector.TLSSkipVerify,
	}
}

func valueOr(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func managerCollectorEnabled(managerCfg store.ManagerConfig) bool {
	return managerCfg.Collector.Enabled == nil || *managerCfg.Collector.Enabled
}
