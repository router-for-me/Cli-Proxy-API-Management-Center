package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/seakee/cpa-manager/usage-service/internal/usage"
)

type Setup struct {
	CPAUpstreamURL string `json:"cpaBaseUrl"`
	ManagementKey  string `json:"managementKey,omitempty"`
	Queue          string `json:"queue,omitempty"`
	PopSide        string `json:"popSide,omitempty"`
}

type ManagerConfig struct {
	CPAConnection        ManagerCPAConnectionConfig        `json:"cpaConnection"`
	Collector            ManagerCollectorConfig            `json:"collector"`
	ExternalUsageService ManagerExternalUsageServiceConfig `json:"externalUsageService"`
	UpdatedAtMS          int64                             `json:"updatedAtMs,omitempty"`
}

type ManagerCPAConnectionConfig struct {
	CPABaseURL    string `json:"cpaBaseUrl"`
	ManagementKey string `json:"managementKey,omitempty"`
}

type ManagerCollectorConfig struct {
	Enabled        *bool  `json:"enabled,omitempty"`
	CollectorMode  string `json:"collectorMode,omitempty"`
	Queue          string `json:"queue,omitempty"`
	PopSide        string `json:"popSide,omitempty"`
	BatchSize      int    `json:"batchSize,omitempty"`
	PollIntervalMS int    `json:"pollIntervalMs,omitempty"`
	QueryLimit     int    `json:"queryLimit,omitempty"`
	TLSSkipVerify  bool   `json:"tlsSkipVerify,omitempty"`
}

type ManagerExternalUsageServiceConfig struct {
	Enabled     bool   `json:"enabled"`
	ServiceBase string `json:"serviceBase,omitempty"`
}

type InsertResult struct {
	Inserted int `json:"inserted"`
	Skipped  int `json:"skipped"`
}

type ModelPrice struct {
	Prompt        float64 `json:"prompt"`
	Completion    float64 `json:"completion"`
	Cache         float64 `json:"cache"`
	Source        string  `json:"source,omitempty"`
	SourceModelID string  `json:"sourceModelId,omitempty"`
	RawJSON       string  `json:"rawJson,omitempty"`
	UpdatedAtMS   int64   `json:"updatedAtMs,omitempty"`
	SyncedAtMS    *int64  `json:"syncedAtMs,omitempty"`
}

type ModelPriceSyncResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

type APIKeyAlias struct {
	APIKeyHash  string `json:"apiKeyHash"`
	Alias       string `json:"alias"`
	UpdatedAtMS int64  `json:"updatedAtMs"`
}

type Store struct {
	db *sql.DB
}

const managerConfigKey = "manager_config_v1"

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) init() error {
	statements := []string{
		`pragma journal_mode = WAL`,
		`pragma synchronous = FULL`,
		`pragma busy_timeout = 5000`,
		`pragma foreign_keys = ON`,
		`create table if not exists usage_events (
			id integer primary key autoincrement,
			request_id text,
			event_hash text not null unique,
			timestamp_ms integer not null,
			timestamp text not null,
			provider text,
			model text not null,
			endpoint text,
			method text,
			path text,
			auth_type text,
			auth_index text,
			source text,
			source_hash text,
			api_key_hash text,
			account_snapshot text,
			auth_label_snapshot text,
			auth_file_snapshot text,
			auth_provider_snapshot text,
			auth_snapshot_at_ms integer,
			input_tokens integer not null default 0,
			output_tokens integer not null default 0,
			reasoning_tokens integer not null default 0,
			cached_tokens integer not null default 0,
			cache_tokens integer not null default 0,
			total_tokens integer not null default 0,
			latency_ms integer,
			failed integer not null default 0,
			raw_json text,
			created_at_ms integer not null
		)`,
		`create index if not exists idx_usage_events_timestamp on usage_events(timestamp_ms)`,
		`create index if not exists idx_usage_events_request_id on usage_events(request_id)`,
		`create index if not exists idx_usage_events_model on usage_events(model)`,
		`create index if not exists idx_usage_events_auth_index on usage_events(auth_index)`,
		`create index if not exists idx_usage_events_endpoint on usage_events(endpoint)`,
		`create table if not exists dead_letter_events (
			id integer primary key autoincrement,
			payload text not null,
			error text not null,
			created_at_ms integer not null
		)`,
		`create table if not exists settings (
			key text primary key,
			value text not null,
			updated_at_ms integer not null
		)`,
		`create table if not exists model_prices (
			model text primary key,
			prompt_per_1m real not null,
			completion_per_1m real not null,
			cache_per_1m real not null,
			source text,
			source_model_id text,
			raw_json text,
			updated_at_ms integer not null,
			synced_at_ms integer
		)`,
		`create table if not exists api_key_aliases (
			api_key_hash text primary key,
			alias text not null,
			updated_at_ms integer not null
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	if err := s.ensureUsageEventSnapshotColumns(); err != nil {
		return err
	}
	if err := s.ensureUsageSearchIndex(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureUsageEventSnapshotColumns() error {
	rows, err := s.db.Query(`pragma table_info(usage_events)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	existing := map[string]struct{}{}
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		existing[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	columns := []struct {
		name       string
		definition string
	}{
		{name: "account_snapshot", definition: "text"},
		{name: "auth_label_snapshot", definition: "text"},
		{name: "auth_file_snapshot", definition: "text"},
		{name: "auth_provider_snapshot", definition: "text"},
		{name: "auth_project_id_snapshot", definition: "text"},
		{name: "auth_snapshot_at_ms", definition: "integer"},
		{name: "requested_model", definition: "text"},
		{name: "resolved_model", definition: "text"},
	}
	for _, column := range columns {
		if _, ok := existing[column.name]; ok {
			continue
		}
		if _, err := s.db.Exec(fmt.Sprintf(
			`alter table usage_events add column %s %s`,
			column.name,
			column.definition,
		)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ensureUsageSearchIndex() error {
	statements := []string{
		`create virtual table if not exists usage_events_fts using fts5(
			event_id unindexed,
			account_snapshot,
			auth_label_snapshot,
			auth_file_snapshot,
			auth_provider_snapshot,
			auth_project_id_snapshot,
			auth_index,
			source,
			api_key_hash,
			provider,
			model,
			requested_model,
			resolved_model,
			endpoint,
			method,
			path,
			tokenize='unicode61',
			prefix='2 3 4'
		)`,
		`create virtual table if not exists api_key_aliases_fts using fts5(
			api_key_hash unindexed,
			alias,
			tokenize='unicode61',
			prefix='2 3 4'
		)`,
		// usage_events is currently append-only. Add matching FTS update/delete triggers before
		// introducing retention cleanup or mutation paths for existing usage rows.
		`create trigger if not exists usage_events_fts_ai after insert on usage_events begin
			insert into usage_events_fts (
				event_id, account_snapshot, auth_label_snapshot, auth_file_snapshot,
				auth_provider_snapshot, auth_project_id_snapshot, auth_index, source,
				api_key_hash, provider, model, requested_model, resolved_model, endpoint,
				method, path
			) values (
				new.id, new.account_snapshot, new.auth_label_snapshot, new.auth_file_snapshot,
				new.auth_provider_snapshot, new.auth_project_id_snapshot, new.auth_index, new.source,
				new.api_key_hash, new.provider, new.model, new.requested_model, new.resolved_model,
				new.endpoint, new.method, new.path
			);
		end`,
		`create trigger if not exists api_key_aliases_fts_ai after insert on api_key_aliases begin
			insert into api_key_aliases_fts (api_key_hash, alias)
			values (new.api_key_hash, new.alias);
		end`,
		`create trigger if not exists api_key_aliases_fts_au after update on api_key_aliases begin
			delete from api_key_aliases_fts where api_key_hash = old.api_key_hash;
			insert into api_key_aliases_fts (api_key_hash, alias)
			values (new.api_key_hash, new.alias);
		end`,
		`create trigger if not exists api_key_aliases_fts_ad after delete on api_key_aliases begin
			delete from api_key_aliases_fts where api_key_hash = old.api_key_hash;
		end`,
		`insert into api_key_aliases_fts (api_key_hash, alias)
		select api_key_hash, alias from api_key_aliases
		where not exists (
			select 1 from api_key_aliases_fts where api_key_aliases_fts.api_key_hash = api_key_aliases.api_key_hash
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	return s.backfillUsageEventsFTS()
}

func (s *Store) backfillUsageEventsFTS() error {
	var eventCount, ftsCount int64
	if err := s.db.QueryRow(`select count(*) from usage_events`).Scan(&eventCount); err != nil {
		return err
	}
	if err := s.db.QueryRow(`select count(*) from usage_events_fts`).Scan(&ftsCount); err != nil {
		return err
	}
	if ftsCount >= eventCount {
		return nil
	}

	statements := []string{
		`create temporary table if not exists usage_events_fts_existing_ids (
			event_id integer primary key
		)`,
		`delete from usage_events_fts_existing_ids`,
		`insert or ignore into usage_events_fts_existing_ids (event_id)
			select event_id from usage_events_fts`,
		`insert into usage_events_fts (
			event_id, account_snapshot, auth_label_snapshot, auth_file_snapshot,
			auth_provider_snapshot, auth_project_id_snapshot, auth_index, source,
			api_key_hash, provider, model, requested_model, resolved_model, endpoint,
			method, path
		)
		select
			usage_events.id, usage_events.account_snapshot, usage_events.auth_label_snapshot,
			usage_events.auth_file_snapshot, usage_events.auth_provider_snapshot,
			usage_events.auth_project_id_snapshot, usage_events.auth_index, usage_events.source,
			usage_events.api_key_hash, usage_events.provider, usage_events.model,
			usage_events.requested_model, usage_events.resolved_model, usage_events.endpoint,
			usage_events.method, usage_events.path
		from usage_events
		left join usage_events_fts_existing_ids on usage_events_fts_existing_ids.event_id = usage_events.id
		where usage_events_fts_existing_ids.event_id is null`,
		`delete from usage_events_fts_existing_ids`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) SaveSetup(ctx context.Context, setup Setup) error {
	if setup.CPAUpstreamURL == "" || setup.ManagementKey == "" {
		return errors.New("cpaBaseUrl and managementKey are required")
	}
	data, err := json.Marshal(setup)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(
		ctx,
		`insert into settings(key, value, updated_at_ms)
		 values('setup', ?, ?)
		 on conflict(key) do update set value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
		string(data),
		time.Now().UnixMilli(),
	)
	return err
}

func (s *Store) LoadSetup(ctx context.Context) (Setup, bool, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `select value from settings where key = 'setup'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Setup{}, false, nil
	}
	if err != nil {
		return Setup{}, false, err
	}
	var setup Setup
	if err := json.Unmarshal([]byte(raw), &setup); err != nil {
		return Setup{}, false, err
	}
	return setup, true, nil
}

func (s *Store) SaveManagerConfig(ctx context.Context, cfg ManagerConfig) error {
	cfg.UpdatedAtMS = time.Now().UnixMilli()
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(
		ctx,
		`insert into settings(key, value, updated_at_ms)
		 values(?, ?, ?)
		 on conflict(key) do update set value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
		managerConfigKey,
		string(data),
		cfg.UpdatedAtMS,
	)
	return err
}

func (s *Store) LoadManagerConfig(ctx context.Context) (ManagerConfig, bool, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `select value from settings where key = ?`, managerConfigKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return ManagerConfig{}, false, nil
	}
	if err != nil {
		return ManagerConfig{}, false, err
	}
	var cfg ManagerConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return ManagerConfig{}, false, err
	}
	return cfg, true, nil
}

func (s *Store) LoadModelPrices(ctx context.Context) (map[string]ModelPrice, error) {
	rows, err := s.db.QueryContext(ctx, `select
		model, prompt_per_1m, completion_per_1m, cache_per_1m, source, source_model_id, raw_json,
		updated_at_ms, synced_at_ms
		from model_prices order by model`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	prices := map[string]ModelPrice{}
	for rows.Next() {
		var model string
		var price ModelPrice
		var source, sourceModelID, rawJSON sql.NullString
		var syncedAt sql.NullInt64
		if err := rows.Scan(
			&model,
			&price.Prompt,
			&price.Completion,
			&price.Cache,
			&source,
			&sourceModelID,
			&rawJSON,
			&price.UpdatedAtMS,
			&syncedAt,
		); err != nil {
			return nil, err
		}
		price.Source = source.String
		price.SourceModelID = sourceModelID.String
		price.RawJSON = rawJSON.String
		if syncedAt.Valid {
			value := syncedAt.Int64
			price.SyncedAtMS = &value
		}
		prices[model] = price
	}
	return prices, rows.Err()
}

func (s *Store) SaveModelPrices(ctx context.Context, prices map[string]ModelPrice) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, `delete from model_prices`); err != nil {
		return err
	}
	if len(prices) == 0 {
		return tx.Commit()
	}

	stmt, err := tx.PrepareContext(ctx, `insert into model_prices (
		model, prompt_per_1m, completion_per_1m, cache_per_1m, source, source_model_id,
		raw_json, updated_at_ms, synced_at_ms
	) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UnixMilli()
	for model, price := range prices {
		if err := validateModelPrice(model, price); err != nil {
			return err
		}
		if _, err := stmt.ExecContext(
			ctx,
			model,
			price.Prompt,
			price.Completion,
			price.Cache,
			nullString(price.Source),
			nullString(price.SourceModelID),
			nullString(price.RawJSON),
			now,
			nullInt(price.SyncedAtMS),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) UpsertSyncedModelPrices(ctx context.Context, prices map[string]ModelPrice) (ModelPriceSyncResult, error) {
	if len(prices) == 0 {
		return ModelPriceSyncResult{}, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ModelPriceSyncResult{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `insert into model_prices (
		model, prompt_per_1m, completion_per_1m, cache_per_1m, source, source_model_id,
		raw_json, updated_at_ms, synced_at_ms
	) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
	on conflict(model) do update set
		prompt_per_1m = excluded.prompt_per_1m,
		completion_per_1m = excluded.completion_per_1m,
		cache_per_1m = excluded.cache_per_1m,
		source = excluded.source,
		source_model_id = excluded.source_model_id,
		raw_json = excluded.raw_json,
		updated_at_ms = excluded.updated_at_ms,
		synced_at_ms = excluded.synced_at_ms`)
	if err != nil {
		return ModelPriceSyncResult{}, err
	}
	defer stmt.Close()

	now := time.Now().UnixMilli()
	result := ModelPriceSyncResult{}
	for model, price := range prices {
		if err := validateModelPrice(model, price); err != nil {
			result.Skipped++
			continue
		}
		if price.Source == "" {
			price.Source = "sync"
		}
		if price.SourceModelID == "" {
			price.SourceModelID = model
		}
		price.UpdatedAtMS = now
		price.SyncedAtMS = &now
		if _, err := stmt.ExecContext(
			ctx,
			model,
			price.Prompt,
			price.Completion,
			price.Cache,
			nullString(price.Source),
			nullString(price.SourceModelID),
			nullString(price.RawJSON),
			now,
			now,
		); err != nil {
			return ModelPriceSyncResult{}, err
		}
		result.Imported++
	}
	if err := tx.Commit(); err != nil {
		return ModelPriceSyncResult{}, err
	}
	return result, nil
}

func (s *Store) LoadAPIKeyAliases(ctx context.Context) ([]APIKeyAlias, error) {
	rows, err := s.db.QueryContext(ctx, `select api_key_hash, alias, updated_at_ms
		from api_key_aliases
		order by alias collate nocase, api_key_hash`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	aliases := []APIKeyAlias{}
	for rows.Next() {
		var alias APIKeyAlias
		if err := rows.Scan(&alias.APIKeyHash, &alias.Alias, &alias.UpdatedAtMS); err != nil {
			return nil, err
		}
		aliases = append(aliases, alias)
	}
	return aliases, rows.Err()
}

// UpsertAPIKeyAliases 写入 / 更新 API Key 别名映射。
//
// activeHashes 表示当前配置中仍在使用的 API Key hash 集合：
//   - 非空时：别名唯一性校验只在「活跃集合 ∪ items 中的 hash」内做；若冲突方
//     是不在活跃集合中的孤儿 hash（例如删除 / 编辑密钥后的历史残留），会自动
//     清理该孤儿映射并把别名让渡给新的 hash。
//   - 为空 (nil) 时：保留旧行为，所有现有映射都视为活跃，遇到同名直接拒绝。
func (s *Store) UpsertAPIKeyAliases(ctx context.Context, aliases []APIKeyAlias, activeHashes []string) error {
	if len(aliases) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	normalizedAliases := make([]APIKeyAlias, 0, len(aliases))
	seenAliases := map[string]string{}
	for _, alias := range aliases {
		normalized, err := normalizeAPIKeyAlias(alias, now)
		if err != nil {
			return err
		}
		aliasKey := normalizeAPIKeyAliasUniqueKey(normalized.Alias)
		if existingHash, ok := seenAliases[aliasKey]; ok && existingHash != normalized.APIKeyHash {
			return errors.New("api key alias already exists")
		}
		seenAliases[aliasKey] = normalized.APIKeyHash
		normalizedAliases = append(normalizedAliases, normalized)
	}

	var activeSet map[string]struct{}
	if len(activeHashes) > 0 {
		activeSet = make(map[string]struct{}, len(activeHashes)+len(normalizedAliases))
		for _, h := range activeHashes {
			hash := strings.ToLower(strings.TrimSpace(h))
			if validAPIKeyHash(hash) {
				activeSet[hash] = struct{}{}
			}
		}
		for _, normalized := range normalizedAliases {
			activeSet[normalized.APIKeyHash] = struct{}{}
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `insert into api_key_aliases (
		api_key_hash, alias, updated_at_ms
	) values (?, ?, ?)
	on conflict(api_key_hash) do update set
		alias = excluded.alias,
		updated_at_ms = excluded.updated_at_ms`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	deleteStmt, err := tx.PrepareContext(ctx, `delete from api_key_aliases where api_key_hash = ?`)
	if err != nil {
		return err
	}
	defer deleteStmt.Close()

	existingRows, err := tx.QueryContext(ctx, `select api_key_hash, alias from api_key_aliases`)
	if err != nil {
		return err
	}
	existingAliases := map[string]string{}
	for existingRows.Next() {
		var apiKeyHash string
		var alias string
		if err := existingRows.Scan(&apiKeyHash, &alias); err != nil {
			_ = existingRows.Close()
			return err
		}
		existingAliases[normalizeAPIKeyAliasUniqueKey(alias)] = apiKeyHash
	}
	if err := existingRows.Close(); err != nil {
		return err
	}
	if err := existingRows.Err(); err != nil {
		return err
	}

	for _, normalized := range normalizedAliases {
		aliasKey := normalizeAPIKeyAliasUniqueKey(normalized.Alias)
		if existingHash, ok := existingAliases[aliasKey]; ok && existingHash != normalized.APIKeyHash {
			if activeSet == nil {
				return errors.New("api key alias already exists")
			}
			if _, isActive := activeSet[existingHash]; isActive {
				return errors.New("api key alias already exists")
			}
			// 孤儿 hash 上的同名别名：先删除残留映射，再让渡给新 hash。
			if _, err := deleteStmt.ExecContext(ctx, existingHash); err != nil {
				return err
			}
			delete(existingAliases, aliasKey)
		}
		if _, err := stmt.ExecContext(
			ctx,
			normalized.APIKeyHash,
			normalized.Alias,
			normalized.UpdatedAtMS,
		); err != nil {
			return err
		}
		existingAliases[aliasKey] = normalized.APIKeyHash
	}
	return tx.Commit()
}

func (s *Store) DeleteAPIKeyAlias(ctx context.Context, apiKeyHash string) error {
	hash := strings.ToLower(strings.TrimSpace(apiKeyHash))
	if !validAPIKeyHash(hash) {
		return errors.New("valid apiKeyHash is required")
	}
	_, err := s.db.ExecContext(ctx, `delete from api_key_aliases where api_key_hash = ?`, hash)
	return err
}

func normalizeAPIKeyAlias(alias APIKeyAlias, now int64) (APIKeyAlias, error) {
	hash := strings.ToLower(strings.TrimSpace(alias.APIKeyHash))
	if !validAPIKeyHash(hash) {
		return APIKeyAlias{}, errors.New("valid apiKeyHash is required")
	}
	label := strings.TrimSpace(alias.Alias)
	if label == "" {
		return APIKeyAlias{}, errors.New("alias is required")
	}
	if len([]rune(label)) > 120 {
		return APIKeyAlias{}, errors.New("alias must be 120 characters or less")
	}
	if alias.UpdatedAtMS <= 0 {
		alias.UpdatedAtMS = now
	}
	alias.APIKeyHash = hash
	alias.Alias = label
	return alias, nil
}

func normalizeAPIKeyAliasUniqueKey(alias string) string {
	return strings.ToLower(strings.TrimSpace(alias))
}

func validAPIKeyHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}

func validateModelPrice(model string, price ModelPrice) error {
	if model == "" {
		return errors.New("model is required")
	}
	if !validPriceValue(price.Prompt) || !validPriceValue(price.Completion) || !validPriceValue(price.Cache) {
		return fmt.Errorf("invalid model price for %s", model)
	}
	return nil
}

func validPriceValue(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func (s *Store) InsertEvents(ctx context.Context, events []usage.Event) (InsertResult, error) {
	if len(events) == 0 {
		return InsertResult{}, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InsertResult{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `insert or ignore into usage_events (
		request_id, event_hash, timestamp_ms, timestamp, provider, model, endpoint, method, path,
		auth_type, auth_index, source, source_hash, api_key_hash,
		account_snapshot, auth_label_snapshot, auth_file_snapshot, auth_provider_snapshot, auth_project_id_snapshot, auth_snapshot_at_ms,
		requested_model, resolved_model,
		input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_tokens, total_tokens,
		latency_ms, failed, raw_json, created_at_ms
	) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return InsertResult{}, err
	}
	defer stmt.Close()

	result := InsertResult{}
	for _, event := range events {
		failed := 0
		if event.Failed {
			failed = 1
		}
		res, err := stmt.ExecContext(
			ctx,
			nullString(event.RequestID),
			event.EventHash,
			event.TimestampMS,
			event.Timestamp,
			nullString(event.Provider),
			event.Model,
			nullString(event.Endpoint),
			nullString(event.Method),
			nullString(event.Path),
			nullString(event.AuthType),
			nullString(event.AuthIndex),
			nullString(event.Source),
			nullString(event.SourceHash),
			nullString(event.APIKeyHash),
			nullString(event.AccountSnapshot),
			nullString(event.AuthLabelSnapshot),
			nullString(event.AuthFileSnapshot),
			nullString(event.AuthProviderSnapshot),
			nullString(event.AuthProjectIDSnapshot),
			nullPositiveInt64(event.AuthSnapshotAtMS),
			nullString(event.RequestedModel),
			nullString(event.ResolvedModel),
			event.InputTokens,
			event.OutputTokens,
			event.ReasoningTokens,
			event.CachedTokens,
			event.CacheTokens,
			event.TotalTokens,
			nullInt(event.LatencyMS),
			failed,
			nullString(event.RawJSON),
			event.CreatedAtMS,
		)
		if err != nil {
			return InsertResult{}, err
		}
		affected, _ := res.RowsAffected()
		if affected > 0 {
			result.Inserted++
		} else {
			result.Skipped++
		}
	}
	if err := tx.Commit(); err != nil {
		return InsertResult{}, err
	}
	return result, nil
}

func (s *Store) AddDeadLetter(ctx context.Context, payload string, parseErr error) error {
	_, err := s.db.ExecContext(
		ctx,
		`insert into dead_letter_events(payload, error, created_at_ms) values(?, ?, ?)`,
		payload,
		parseErr.Error(),
		time.Now().UnixMilli(),
	)
	return err
}

type UsageSummaryFilter struct {
	StartMS          *int64
	EndMS            *int64
	Account          string
	Provider         string
	Model            string
	Channel          string
	APIKeyHash       string
	Status           string
	Search           string
	SearchAPIKeyHash string
}

type UsageBreakdownKind string

const (
	UsageBreakdownAccounts UsageBreakdownKind = "accounts"
	UsageBreakdownAPIKeys  UsageBreakdownKind = "api-keys"
	UsageBreakdownRealtime UsageBreakdownKind = "realtime"
	UsageBreakdownModels   UsageBreakdownKind = "models"
)

const MaxUsagePageSize = 500

const defaultUsageSortKey = "lastSeenAt"
const usageTokensPerPriceUnit = 1_000_000

var usageModelDateSuffixRegex = regexp.MustCompile(`-\d{6,8}$`)

var usageSortKeys = map[string]struct{}{
	"totalCalls":   {},
	"successCalls": {},
	"failureCalls": {},
	"successRate":  {},
	"totalTokens":  {},
	"totalCost":    {},
	"inputTokens":  {},
	"outputTokens": {},
	"cachedTokens": {},
	"lastSeenAt":   {},
}

type UsagePageFilter struct {
	Page          int
	PageSize      int
	SortKey       string
	SortDirection string
}

type UsagePage struct {
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	TotalItems int64         `json:"total_items"`
	Usage      usage.Payload `json:"usage"`
	Items      any           `json:"items,omitempty"`
}

type usageBreakdownDetail struct {
	Endpoint    string
	Model       string
	TimestampMS int64
	Detail      usage.Detail
}

type usageBreakdownGroup struct {
	Key             string
	Details         []usageBreakdownDetail
	TotalCalls      int64
	SuccessCalls    int64
	FailureCalls    int64
	InputTokens     int64
	OutputTokens    int64
	CachedTokens    int64
	TotalTokens     int64
	TotalCost       float64
	LatestTimestamp int64
}

type usageModelPriceIndex struct {
	exact        map[string]string
	base         map[string]string
	dateStripped map[string]string
}

type UsageBreakdownPageItem struct {
	ID              string                    `json:"id"`
	Key             string                    `json:"key"`
	Account         string                    `json:"account,omitempty"`
	AccountLabel    string                    `json:"account_label,omitempty"`
	APIKeyHash      string                    `json:"api_key_hash,omitempty"`
	APIKeyLabel     string                    `json:"api_key_label,omitempty"`
	IsUnknown       bool                      `json:"is_unknown,omitempty"`
	AuthLabels      []string                  `json:"auth_labels,omitempty"`
	AuthIndices     []string                  `json:"auth_indices,omitempty"`
	SourceLabels    []string                  `json:"source_labels,omitempty"`
	Channels        []string                  `json:"channels,omitempty"`
	TotalRequests   int64                     `json:"total_requests"`
	SuccessCount    int64                     `json:"success_count"`
	FailureCount    int64                     `json:"failure_count"`
	InputTokens     int64                     `json:"input_tokens"`
	OutputTokens    int64                     `json:"output_tokens"`
	ReasoningTokens int64                     `json:"reasoning_tokens"`
	CachedTokens    int64                     `json:"cached_tokens"`
	TotalTokens     int64                     `json:"total_tokens"`
	LatencySumMS    int64                     `json:"latency_sum_ms,omitempty"`
	LatencyCount    int64                     `json:"latency_count,omitempty"`
	LatencyMS       *int64                    `json:"latency_ms,omitempty"`
	LastSeenAtMS    int64                     `json:"last_seen_at_ms"`
	RecentPattern   []bool                    `json:"recent_pattern,omitempty"`
	Models          []UsageBreakdownModelItem `json:"models,omitempty"`
}

type UsageBreakdownModelItem struct {
	Model           string `json:"model"`
	ResolvedModel   string `json:"resolved_model,omitempty"`
	TotalRequests   int64  `json:"total_requests"`
	SuccessCount    int64  `json:"success_count"`
	FailureCount    int64  `json:"failure_count"`
	InputTokens     int64  `json:"input_tokens"`
	OutputTokens    int64  `json:"output_tokens"`
	ReasoningTokens int64  `json:"reasoning_tokens"`
	CachedTokens    int64  `json:"cached_tokens"`
	TotalTokens     int64  `json:"total_tokens"`
	LastSeenAtMS    int64  `json:"last_seen_at_ms"`
}

func (filter UsageSummaryFilter) whereClause() (string, []any) {
	clauses := make([]string, 0, 10)
	args := make([]any, 0, 16)
	if filter.StartMS != nil {
		clauses = append(clauses, "timestamp_ms >= ?")
		args = append(args, *filter.StartMS)
	}
	if filter.EndMS != nil {
		clauses = append(clauses, "timestamp_ms <= ?")
		args = append(args, *filter.EndMS)
	}
	if filter.Model != "" {
		clauses = append(clauses, "model = ?")
		args = append(args, filter.Model)
	}
	if filter.APIKeyHash != "" {
		clauses = append(clauses, "lower(coalesce(api_key_hash, '')) = ?")
		args = append(args, strings.ToLower(filter.APIKeyHash))
	}
	if filter.Status == "success" {
		clauses = append(clauses, "failed = 0")
	}
	if filter.Status == "failed" {
		clauses = append(clauses, "failed != 0")
	}
	if filter.Account != "" {
		value := strings.ToLower(filter.Account)
		clauses = append(clauses, `(lower(coalesce(account_snapshot, '')) = ? or lower(coalesce(auth_label_snapshot, '')) = ? or lower(coalesce(source, '')) = ? or lower(coalesce(auth_index, '')) = ?)`)
		args = append(args, value, value, value, value)
	}
	if filter.Provider != "" {
		value := strings.ToLower(filter.Provider)
		clauses = append(clauses, `(lower(coalesce(provider, '')) = ? or lower(coalesce(auth_provider_snapshot, '')) = ?)`)
		args = append(args, value, value)
	}
	if filter.Channel != "" {
		value := strings.ToLower(filter.Channel)
		clauses = append(clauses, `(lower(coalesce(auth_provider_snapshot, '')) = ? or lower(coalesce(provider, '')) = ? or lower(coalesce(source, '')) = ?)`)
		args = append(args, value, value, value)
	}
	searchClause, searchArgs := filter.searchClause()
	if searchClause != "" {
		clauses = append(clauses, searchClause)
		args = append(args, searchArgs...)
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " where " + strings.Join(clauses, " and "), args
}

func (filter UsageSummaryFilter) facetFilter() UsageSummaryFilter {
	return UsageSummaryFilter{
		StartMS:          filter.StartMS,
		EndMS:            filter.EndMS,
		Search:           filter.Search,
		SearchAPIKeyHash: filter.SearchAPIKeyHash,
	}
}

func (filter UsageSummaryFilter) searchClause() (string, []any) {
	searchQuery := buildFTSQuery(filter.Search)
	apiKeyHash := strings.ToLower(strings.TrimSpace(filter.SearchAPIKeyHash))
	clauses := make([]string, 0, 3)
	args := make([]any, 0, 3)
	if searchQuery != "" {
		clauses = append(clauses, `id in (
			select event_id from usage_events_fts where usage_events_fts match ?
		)`)
		args = append(args, searchQuery)
		clauses = append(clauses, `api_key_hash in (
			select api_key_hash from api_key_aliases_fts where api_key_aliases_fts match ?
		)`)
		args = append(args, searchQuery)
	}
	if apiKeyHash != "" {
		clauses = append(clauses, "lower(coalesce(api_key_hash, '')) = ?")
		args = append(args, apiKeyHash)
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return "(" + strings.Join(clauses, " or ") + ")", args
}

func buildFTSQuery(search string) string {
	terms := strings.Fields(search)
	if len(terms) == 0 {
		return ""
	}
	prefixTerms := make([]string, 0, len(terms))
	for _, term := range terms {
		term = strings.Trim(strings.TrimSpace(term), `"*`)
		if term == "" {
			continue
		}
		prefixTerms = append(prefixTerms, `"`+strings.ReplaceAll(term, `"`, `""`)+`"*`)
	}
	return strings.Join(prefixTerms, " AND ")
}

func (s *Store) UsageSummary(ctx context.Context, filter UsageSummaryFilter) (usage.Payload, error) {
	return s.usageSummary(ctx, filter, false)
}

func (s *Store) usageSummary(ctx context.Context, filter UsageSummaryFilter, includeDetails bool) (usage.Payload, error) {
	summary := usage.Payload{APIs: map[string]*usage.APIAggregate{}}
	whereClause, args := filter.whereClause()
	err := s.db.QueryRowContext(ctx, `select
		count(*),
		coalesce(sum(case when failed = 0 then 1 else 0 end), 0),
		coalesce(sum(case when failed != 0 then 1 else 0 end), 0),
		coalesce(sum(input_tokens), 0),
		coalesce(sum(output_tokens), 0),
		coalesce(sum(reasoning_tokens), 0),
		coalesce(sum(cached_tokens), 0),
		coalesce(sum(cache_tokens), 0),
		coalesce(sum(total_tokens), 0),
		coalesce(sum(latency_ms), 0),
		count(latency_ms)
		from usage_events`+whereClause, args...).Scan(
		&summary.TotalRequests,
		&summary.SuccessCount,
		&summary.FailureCount,
		&summary.Tokens.InputTokens,
		&summary.Tokens.OutputTokens,
		&summary.Tokens.ReasoningTokens,
		&summary.Tokens.CachedTokens,
		&summary.Tokens.CacheTokens,
		&summary.TotalTokens,
		&summary.LatencySumMS,
		&summary.LatencyCount,
	)
	if err != nil {
		return usage.Payload{}, err
	}
	summary.Tokens.TotalTokens = summary.TotalTokens
	if summary.LatencyCount > 0 {
		averageLatency := summary.LatencySumMS / summary.LatencyCount
		summary.LatencyMS = &averageLatency
	}
	if !includeDetails {
		facetWhereClause, facetArgs := filter.facetFilter().whereClause()
		facets, err := s.usageFacets(ctx, facetWhereClause, facetArgs)
		if err != nil {
			return usage.Payload{}, err
		}
		summary.Facets = facets
		return summary, nil
	}

	rows, err := s.db.QueryContext(ctx, `select
		coalesce(nullif(endpoint, ''), '-'),
		coalesce(nullif(model, ''), '-'),
		coalesce(source, ''),
		coalesce(auth_index, ''),
		coalesce(api_key_hash, ''),
		coalesce(account_snapshot, ''),
		coalesce(auth_label_snapshot, ''),
		coalesce(auth_file_snapshot, ''),
		coalesce(auth_provider_snapshot, ''),
		coalesce(auth_project_id_snapshot, ''),
		coalesce(resolved_model, ''),
		failed,
		max(timestamp_ms),
		coalesce(max(auth_snapshot_at_ms), 0),
		count(*),
		coalesce(sum(case when failed = 0 then 1 else 0 end), 0),
		coalesce(sum(case when failed != 0 then 1 else 0 end), 0),
		coalesce(sum(input_tokens), 0),
		coalesce(sum(output_tokens), 0),
		coalesce(sum(reasoning_tokens), 0),
		coalesce(sum(cached_tokens), 0),
		coalesce(sum(cache_tokens), 0),
		coalesce(sum(total_tokens), 0),
		coalesce(sum(latency_ms), 0),
		count(latency_ms)
		from usage_events`+whereClause+`
		group by coalesce(nullif(endpoint, ''), '-'), coalesce(nullif(model, ''), '-'),
			coalesce(source, ''), coalesce(auth_index, ''), coalesce(api_key_hash, ''),
			coalesce(account_snapshot, ''), coalesce(auth_label_snapshot, ''),
			coalesce(auth_file_snapshot, ''), coalesce(auth_provider_snapshot, ''),
			coalesce(auth_project_id_snapshot, ''), coalesce(resolved_model, ''), failed
		order by max(timestamp_ms) desc`, args...)
	if err != nil {
		return usage.Payload{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var endpoint, model, source, authIndex, apiKeyHash, accountSnapshot, authLabelSnapshot, authFileSnapshot, authProviderSnapshot, authProjectIDSnapshot, resolvedModel string
		var failed int
		var latestTimestampMS, authSnapshotAtMS int64
		var latencySumMS, latencyCount int64
		detail := usage.Detail{}
		if err := rows.Scan(
			&endpoint,
			&model,
			&source,
			&authIndex,
			&apiKeyHash,
			&accountSnapshot,
			&authLabelSnapshot,
			&authFileSnapshot,
			&authProviderSnapshot,
			&authProjectIDSnapshot,
			&resolvedModel,
			&failed,
			&latestTimestampMS,
			&authSnapshotAtMS,
			&detail.RequestCount,
			&detail.SuccessCount,
			&detail.FailureCount,
			&detail.Tokens.InputTokens,
			&detail.Tokens.OutputTokens,
			&detail.Tokens.ReasoningTokens,
			&detail.Tokens.CachedTokens,
			&detail.Tokens.CacheTokens,
			&detail.Tokens.TotalTokens,
			&latencySumMS,
			&latencyCount,
		); err != nil {
			return usage.Payload{}, err
		}
		detail.Timestamp = time.UnixMilli(latestTimestampMS).UTC().Format(time.RFC3339Nano)
		detail.Source = source
		detail.AuthIndex = authIndex
		detail.APIKeyHash = apiKeyHash
		detail.AccountSnapshot = accountSnapshot
		detail.AuthLabelSnapshot = authLabelSnapshot
		detail.AuthFileSnapshot = authFileSnapshot
		detail.AuthProviderSnapshot = authProviderSnapshot
		detail.AuthProjectIDSnapshot = authProjectIDSnapshot
		detail.AuthSnapshotAtMS = authSnapshotAtMS
		detail.ResolvedModel = resolvedModel
		detail.Failed = failed != 0
		detail.LatencySumMS = latencySumMS
		detail.LatencyCount = latencyCount
		if latencyCount > 0 {
			averageLatency := latencySumMS / latencyCount
			detail.LatencyMS = &averageLatency
		}
		apiSummary := summary.APIs[endpoint]
		if apiSummary == nil {
			apiSummary = &usage.APIAggregate{Models: map[string]*usage.ModelAggregate{}}
			summary.APIs[endpoint] = apiSummary
		}
		modelSummary := apiSummary.Models[model]
		if modelSummary == nil {
			modelSummary = &usage.ModelAggregate{}
			apiSummary.Models[model] = modelSummary
		}
		modelSummary.Details = append(modelSummary.Details, detail)
	}
	if err := rows.Err(); err != nil {
		return usage.Payload{}, err
	}
	return summary, nil
}

func (s *Store) usageFacets(ctx context.Context, whereClause string, args []any) (usage.Facets, error) {
	providers, err := s.usageStringFacet(ctx, `coalesce(nullif(auth_provider_snapshot, ''), nullif(provider, ''))`, whereClause, args)
	if err != nil {
		return usage.Facets{}, err
	}
	models, err := s.usageStringFacet(ctx, `coalesce(nullif(resolved_model, ''), nullif(model, ''))`, whereClause, args)
	if err != nil {
		return usage.Facets{}, err
	}
	channels, err := s.usageStringFacet(ctx, `coalesce(nullif(auth_provider_snapshot, ''), nullif(provider, ''), nullif(source, ''))`, whereClause, args)
	if err != nil {
		return usage.Facets{}, err
	}
	accounts, err := s.usageAccountFacet(ctx, whereClause, args)
	if err != nil {
		return usage.Facets{}, err
	}
	apiKeys, err := s.usageAPIKeyFacet(ctx, whereClause, args)
	if err != nil {
		return usage.Facets{}, err
	}
	return usage.Facets{
		Providers: providers,
		Accounts:  accounts,
		Models:    models,
		Channels:  channels,
		APIKeys:   apiKeys,
	}, nil
}

func (s *Store) usageStringFacet(ctx context.Context, expression string, whereClause string, args []any) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `select value from (
			select distinct `+expression+` as value from usage_events`+whereClause+`
		)
		where value is not null and trim(value) != ''
		order by lower(value)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	values := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func (s *Store) usageAccountFacet(ctx context.Context, whereClause string, args []any) ([]usage.FacetOption, error) {
	rows, err := s.db.QueryContext(ctx, `select
		value,
		coalesce(nullif(account_snapshot, ''), nullif(auth_label_snapshot, ''), value) as label
		from (
			select distinct
				coalesce(nullif(account_snapshot, ''), nullif(auth_label_snapshot, ''), nullif(source, ''), nullif(auth_index, '')) as value,
				account_snapshot,
				auth_label_snapshot
			from usage_events`+whereClause+`
		)
		where value is not null and trim(value) != ''
		order by lower(label), lower(value)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	options := []usage.FacetOption{}
	seen := map[string]struct{}{}
	for rows.Next() {
		var option usage.FacetOption
		if err := rows.Scan(&option.Value, &option.Label); err != nil {
			return nil, err
		}
		key := strings.ToLower(option.Value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		options = append(options, option)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return options, nil
}

func (s *Store) usageAPIKeyFacet(ctx context.Context, whereClause string, args []any) ([]usage.FacetOption, error) {
	rows, err := s.db.QueryContext(ctx, `select
		keys.api_key_hash,
		coalesce(nullif(api_key_aliases.alias, ''), keys.api_key_hash) as label
		from (
			select distinct lower(api_key_hash) as api_key_hash
			from usage_events`+whereClause+`
		) keys
		left join api_key_aliases on lower(api_key_aliases.api_key_hash) = keys.api_key_hash
		where keys.api_key_hash is not null and trim(keys.api_key_hash) != ''
		order by lower(label), keys.api_key_hash`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	options := []usage.FacetOption{}
	for rows.Next() {
		var option usage.FacetOption
		if err := rows.Scan(&option.Value, &option.Label); err != nil {
			return nil, err
		}
		options = append(options, option)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return options, nil
}

func (s *Store) UsageBreakdownPage(ctx context.Context, kind UsageBreakdownKind, filter UsageSummaryFilter, pageFilter UsagePageFilter) (UsagePage, error) {
	page, pageSize := normalizeUsagePageFilter(pageFilter)
	switch kind {
	case UsageBreakdownRealtime:
		return s.usageRealtimePage(ctx, filter, page, pageSize)
	case UsageBreakdownModels:
		return s.usageModelPage(ctx, filter, page, pageSize)
	}

	summary, err := s.usageSummary(ctx, filter, true)
	if err != nil {
		return UsagePage{}, err
	}

	details := flattenUsagePayload(summary)
	var prices map[string]ModelPrice
	var priceIndex *usageModelPriceIndex
	if normalizeUsageSortKey(pageFilter.SortKey) == "totalCost" {
		prices, err = s.LoadModelPrices(ctx)
		if err != nil {
			return UsagePage{}, err
		}
		priceIndex = buildUsageModelPriceIndex(prices)
	}
	switch kind {
	case UsageBreakdownAccounts:
		return buildGroupedUsagePage(kind, details, page, pageSize, pageFilter, accountBreakdownKey, prices, priceIndex), nil
	case UsageBreakdownAPIKeys:
		return buildGroupedUsagePage(kind, details, page, pageSize, pageFilter, apiKeyBreakdownKey, prices, priceIndex), nil
	default:
		return UsagePage{}, fmt.Errorf("unknown usage breakdown kind %q", kind)
	}
}

func (s *Store) usageModelPage(ctx context.Context, filter UsageSummaryFilter, page int, pageSize int) (UsagePage, error) {
	whereClause, args := filter.whereClause()
	var totalItems int64
	if err := s.db.QueryRowContext(ctx, `select count(*) from (
		select 1 from usage_events`+whereClause+`
		group by coalesce(nullif(endpoint, ''), '-'), coalesce(nullif(model, ''), '-'),
			coalesce(resolved_model, ''), failed
	)`, args...).Scan(&totalItems); err != nil {
		return UsagePage{}, err
	}
	rows, err := s.db.QueryContext(ctx, `select
		coalesce(nullif(endpoint, ''), '-'),
		coalesce(nullif(model, ''), '-'),
		coalesce(resolved_model, ''),
		failed,
		max(timestamp_ms),
		count(*),
		coalesce(sum(case when failed = 0 then 1 else 0 end), 0),
		coalesce(sum(case when failed != 0 then 1 else 0 end), 0),
		coalesce(sum(input_tokens), 0),
		coalesce(sum(output_tokens), 0),
		coalesce(sum(reasoning_tokens), 0),
		coalesce(sum(cached_tokens), 0),
		coalesce(sum(cache_tokens), 0),
		coalesce(sum(total_tokens), 0),
		coalesce(sum(latency_ms), 0),
		count(latency_ms)
		from usage_events`+whereClause+`
		group by coalesce(nullif(endpoint, ''), '-'), coalesce(nullif(model, ''), '-'),
			coalesce(resolved_model, ''), failed
		order by max(timestamp_ms) desc
		limit ? offset ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return UsagePage{}, err
	}
	defer rows.Close()

	details := make([]usageBreakdownDetail, 0)
	for rows.Next() {
		var endpoint, model, resolvedModel string
		var failed int
		var latestTimestampMS int64
		var latencySumMS, latencyCount int64
		detail := usage.Detail{}
		if err := rows.Scan(
			&endpoint,
			&model,
			&resolvedModel,
			&failed,
			&latestTimestampMS,
			&detail.RequestCount,
			&detail.SuccessCount,
			&detail.FailureCount,
			&detail.Tokens.InputTokens,
			&detail.Tokens.OutputTokens,
			&detail.Tokens.ReasoningTokens,
			&detail.Tokens.CachedTokens,
			&detail.Tokens.CacheTokens,
			&detail.Tokens.TotalTokens,
			&latencySumMS,
			&latencyCount,
		); err != nil {
			return UsagePage{}, err
		}
		detail.Timestamp = time.UnixMilli(latestTimestampMS).UTC().Format(time.RFC3339Nano)
		detail.ResolvedModel = resolvedModel
		detail.Failed = failed != 0
		detail.LatencySumMS = latencySumMS
		detail.LatencyCount = latencyCount
		if latencyCount > 0 {
			averageLatency := latencySumMS / latencyCount
			detail.LatencyMS = &averageLatency
		}
		details = append(details, usageBreakdownDetail{
			Endpoint:    endpoint,
			Model:       model,
			TimestampMS: latestTimestampMS,
			Detail:      detail,
		})
	}
	if err := rows.Err(); err != nil {
		return UsagePage{}, err
	}
	return UsagePage{
		Page:       page,
		PageSize:   pageSize,
		TotalItems: totalItems,
		Usage:      payloadFromBreakdownDetails(details),
	}, nil
}

func (s *Store) usageRealtimePage(ctx context.Context, filter UsageSummaryFilter, page int, pageSize int) (UsagePage, error) {
	whereClause, args := filter.whereClause()
	var totalItems int64
	if err := s.db.QueryRowContext(ctx, `select count(*) from usage_events`+whereClause, args...).Scan(&totalItems); err != nil {
		return UsagePage{}, err
	}
	events, err := s.queryEvents(ctx, whereClause, args, pageSize, (page-1)*pageSize)
	if err != nil {
		return UsagePage{}, err
	}
	return UsagePage{
		Page:       page,
		PageSize:   pageSize,
		TotalItems: totalItems,
		Usage:      payloadSummaryFromEvents(events),
		Items:      events,
	}, nil
}

func normalizeUsagePageFilter(filter UsagePageFilter) (int, int) {
	page := filter.Page
	if page <= 0 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > MaxUsagePageSize {
		pageSize = MaxUsagePageSize
	}
	return page, pageSize
}

func IsUsageSortKey(sortKey string) bool {
	_, ok := usageSortKeys[strings.TrimSpace(sortKey)]
	return ok
}

func flattenUsagePayload(payload usage.Payload) []usageBreakdownDetail {
	details := make([]usageBreakdownDetail, 0)
	for endpoint, api := range payload.APIs {
		if api == nil {
			continue
		}
		for model, aggregate := range api.Models {
			if aggregate == nil {
				continue
			}
			for _, detail := range aggregate.Details {
				details = append(details, usageBreakdownDetail{
					Endpoint:    endpoint,
					Model:       model,
					TimestampMS: usageDetailTimestampMS(detail),
					Detail:      detail,
				})
			}
		}
	}
	return details
}

func usageDetailTimestampMS(detail usage.Detail) int64 {
	if detail.Timestamp == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339Nano, detail.Timestamp)
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

func buildGroupedUsagePage(
	kind UsageBreakdownKind,
	details []usageBreakdownDetail,
	page int,
	pageSize int,
	pageFilter UsagePageFilter,
	keyFunc func(usage.Detail) string,
	prices map[string]ModelPrice,
	priceIndex *usageModelPriceIndex,
) UsagePage {
	groupMap := make(map[string]*usageBreakdownGroup)
	for _, item := range details {
		key := keyFunc(item.Detail)
		group := groupMap[key]
		if group == nil {
			group = &usageBreakdownGroup{Key: key}
			groupMap[key] = group
		}
		group.Details = append(group.Details, item)
		group.TotalCalls += item.Detail.RequestCount
		group.SuccessCalls += item.Detail.SuccessCount
		group.FailureCalls += item.Detail.FailureCount
		group.InputTokens += item.Detail.Tokens.InputTokens
		group.OutputTokens += item.Detail.Tokens.OutputTokens
		group.CachedTokens += maxInt64(item.Detail.Tokens.CachedTokens, item.Detail.Tokens.CacheTokens)
		group.TotalTokens += item.Detail.Tokens.TotalTokens
		group.TotalCost += usageDetailCost(item, prices, priceIndex)
		if item.TimestampMS > group.LatestTimestamp {
			group.LatestTimestamp = item.TimestampMS
		}
	}

	groups := make([]*usageBreakdownGroup, 0, len(groupMap))
	for _, group := range groupMap {
		sortBreakdownDetails(group.Details)
		groups = append(groups, group)
	}
	sortBreakdownGroups(groups, pageFilter)

	start, end := pageBounds(len(groups), page, pageSize)
	pageDetails := make([]usageBreakdownDetail, 0)
	pageGroups := groups[start:end]
	for _, group := range pageGroups {
		pageDetails = append(pageDetails, group.Details...)
	}

	return UsagePage{
		Page:       page,
		PageSize:   pageSize,
		TotalItems: int64(len(groups)),
		Usage:      payloadSummaryFromBreakdownDetails(pageDetails),
		Items:      buildBreakdownPageItems(kind, pageGroups),
	}
}

func buildBreakdownPageItems(kind UsageBreakdownKind, groups []*usageBreakdownGroup) []UsageBreakdownPageItem {
	items := make([]UsageBreakdownPageItem, 0, len(groups))
	for _, group := range groups {
		item := UsageBreakdownPageItem{
			ID:            group.Key,
			Key:           group.Key,
			TotalRequests: group.TotalCalls,
			SuccessCount:  group.SuccessCalls,
			FailureCount:  group.FailureCalls,
			InputTokens:   group.InputTokens,
			OutputTokens:  group.OutputTokens,
			CachedTokens:  group.CachedTokens,
			TotalTokens:   group.TotalTokens,
			LastSeenAtMS:  group.LatestTimestamp,
			RecentPattern: buildBreakdownRecentPattern(group.Details, 10),
			Models:        buildBreakdownModelItems(group.Details),
		}

		for _, detail := range group.Details {
			item.ReasoningTokens += detail.Detail.Tokens.ReasoningTokens
			item.LatencySumMS += detail.Detail.LatencySumMS
			item.LatencyCount += detail.Detail.LatencyCount
			appendUniqueString(&item.AuthLabels, firstNonEmpty(detail.Detail.AuthLabelSnapshot, detail.Detail.AccountSnapshot))
			appendUniqueString(&item.AuthIndices, detail.Detail.AuthIndex)
			appendUniqueString(&item.Channels, firstNonEmpty(detail.Detail.AuthProviderSnapshot, detail.Detail.Source))
			switch kind {
			case UsageBreakdownAccounts:
				if item.Account == "" {
					item.Account = firstNonEmpty(detail.Detail.AccountSnapshot, detail.Detail.AuthLabelSnapshot, detail.Detail.Source, detail.Detail.AuthIndex, group.Key)
					item.AccountLabel = firstNonEmpty(detail.Detail.AccountSnapshot, detail.Detail.AuthLabelSnapshot, item.Account)
				}
			case UsageBreakdownAPIKeys:
				if item.APIKeyHash == "" && detail.Detail.APIKeyHash != "" {
					item.APIKeyHash = strings.ToLower(detail.Detail.APIKeyHash)
				}
				appendUniqueString(&item.SourceLabels, firstNonEmpty(detail.Detail.AccountSnapshot, detail.Detail.AuthLabelSnapshot, detail.Detail.Source, detail.Detail.AuthIndex))
			}
		}
		if item.Account == "" && kind == UsageBreakdownAccounts {
			item.Account = group.Key
			item.AccountLabel = group.Key
		}
		if kind == UsageBreakdownAPIKeys {
			if item.APIKeyHash == "" {
				item.APIKeyHash = group.Key
				item.IsUnknown = true
			}
			item.APIKeyLabel = item.APIKeyHash
			item.ID = item.APIKeyHash
		}
		if item.LatencyCount > 0 {
			averageLatency := item.LatencySumMS / item.LatencyCount
			item.LatencyMS = &averageLatency
		}
		sort.Strings(item.AuthLabels)
		sort.Strings(item.AuthIndices)
		sort.Strings(item.Channels)
		sort.Strings(item.SourceLabels)
		items = append(items, item)
	}
	return items
}

func buildBreakdownModelItems(details []usageBreakdownDetail) []UsageBreakdownModelItem {
	models := map[string]*UsageBreakdownModelItem{}
	for _, detail := range details {
		key := detail.Model + "\x00" + detail.Detail.ResolvedModel
		item := models[key]
		if item == nil {
			item = &UsageBreakdownModelItem{Model: detail.Model, ResolvedModel: detail.Detail.ResolvedModel}
			models[key] = item
		}
		item.TotalRequests += detail.Detail.RequestCount
		item.SuccessCount += detail.Detail.SuccessCount
		item.FailureCount += detail.Detail.FailureCount
		item.InputTokens += detail.Detail.Tokens.InputTokens
		item.OutputTokens += detail.Detail.Tokens.OutputTokens
		item.ReasoningTokens += detail.Detail.Tokens.ReasoningTokens
		item.CachedTokens += maxInt64(detail.Detail.Tokens.CachedTokens, detail.Detail.Tokens.CacheTokens)
		item.TotalTokens += detail.Detail.Tokens.TotalTokens
		if detail.TimestampMS > item.LastSeenAtMS {
			item.LastSeenAtMS = detail.TimestampMS
		}
	}
	items := make([]UsageBreakdownModelItem, 0, len(models))
	for _, item := range models {
		items = append(items, *item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].LastSeenAtMS != items[j].LastSeenAtMS {
			return items[i].LastSeenAtMS > items[j].LastSeenAtMS
		}
		if items[i].Model != items[j].Model {
			return items[i].Model < items[j].Model
		}
		return items[i].ResolvedModel < items[j].ResolvedModel
	})
	return items
}

func buildBreakdownRecentPattern(details []usageBreakdownDetail, limit int) []bool {
	sorted := append([]usageBreakdownDetail(nil), details...)
	sortBreakdownDetails(sorted)
	if len(sorted) > limit {
		sorted = sorted[:limit]
	}
	pattern := make([]bool, 0, len(sorted))
	for i := len(sorted) - 1; i >= 0; i-- {
		pattern = append(pattern, !sorted[i].Detail.Failed)
	}
	return pattern
}

func appendUniqueString(values *[]string, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	for _, existing := range *values {
		if existing == value {
			return
		}
	}
	*values = append(*values, value)
}

func accountBreakdownKey(detail usage.Detail) string {
	return firstNonEmpty(detail.AccountSnapshot, detail.AuthLabelSnapshot, detail.Source, detail.AuthIndex, "-")
}

func apiKeyBreakdownKey(detail usage.Detail) string {
	if detail.APIKeyHash != "" {
		return strings.ToLower(detail.APIKeyHash)
	}
	return "unknown:" + strings.Join([]string{detail.Source, detail.AuthIndex, detail.AuthProviderSnapshot}, ":")
}

func sortBreakdownDetails(details []usageBreakdownDetail) {
	sort.SliceStable(details, func(i, j int) bool {
		if details[i].TimestampMS != details[j].TimestampMS {
			return details[i].TimestampMS > details[j].TimestampMS
		}
		if details[i].Endpoint != details[j].Endpoint {
			return details[i].Endpoint < details[j].Endpoint
		}
		return details[i].Model < details[j].Model
	})
}

func sortBreakdownGroups(groups []*usageBreakdownGroup, filter UsagePageFilter) {
	direction := strings.ToLower(strings.TrimSpace(filter.SortDirection))
	ascending := direction == "asc"
	sortKey := normalizeUsageSortKey(filter.SortKey)

	sort.SliceStable(groups, func(i, j int) bool {
		left := groups[i]
		right := groups[j]
		compare := compareBreakdownGroup(left, right, sortKey)
		if compare == 0 {
			compare = compareBreakdownGroup(left, right, defaultUsageSortKey)
		}
		if compare == 0 {
			compare = strings.Compare(left.Key, right.Key)
		}
		if ascending {
			return compare < 0
		}
		return compare > 0
	})
}

func normalizeUsageSortKey(sortKey string) string {
	sortKey = strings.TrimSpace(sortKey)
	if IsUsageSortKey(sortKey) {
		return sortKey
	}
	return defaultUsageSortKey
}

func compareBreakdownGroup(left *usageBreakdownGroup, right *usageBreakdownGroup, sortKey string) int {
	switch sortKey {
	case "totalCalls":
		return compareInt64(left.TotalCalls, right.TotalCalls)
	case "successCalls":
		return compareInt64(left.SuccessCalls, right.SuccessCalls)
	case "failureCalls":
		return compareInt64(left.FailureCalls, right.FailureCalls)
	case "successRate":
		return compareFloat64(successRate(left), successRate(right))
	case "totalTokens":
		return compareInt64(left.TotalTokens, right.TotalTokens)
	case "totalCost":
		return compareFloat64(left.TotalCost, right.TotalCost)
	case "inputTokens":
		return compareInt64(left.InputTokens, right.InputTokens)
	case "outputTokens":
		return compareInt64(left.OutputTokens, right.OutputTokens)
	case "cachedTokens":
		return compareInt64(left.CachedTokens, right.CachedTokens)
	case "lastSeenAt":
		return compareInt64(left.LatestTimestamp, right.LatestTimestamp)
	default:
		return compareInt64(left.LatestTimestamp, right.LatestTimestamp)
	}
}

func usageDetailCost(item usageBreakdownDetail, prices map[string]ModelPrice, priceIndex *usageModelPriceIndex) float64 {
	if len(prices) == 0 || priceIndex == nil {
		return 0
	}
	price, ok := lookupUsageModelPrice(priceIndex, prices, item.Detail.ResolvedModel)
	if !ok {
		price, ok = lookupUsageModelPrice(priceIndex, prices, item.Model)
	}
	if !ok {
		return 0
	}
	inputTokens := maxInt64(item.Detail.Tokens.InputTokens, 0)
	cachedTokens := maxInt64(item.Detail.Tokens.CachedTokens, item.Detail.Tokens.CacheTokens)
	cachedTokens = maxInt64(cachedTokens, 0)
	promptTokens := maxInt64(inputTokens-cachedTokens, 0)
	outputTokens := maxInt64(item.Detail.Tokens.OutputTokens, 0)
	total := (float64(promptTokens) / usageTokensPerPriceUnit * price.Prompt) +
		(float64(cachedTokens) / usageTokensPerPriceUnit * price.Cache) +
		(float64(outputTokens) / usageTokensPerPriceUnit * price.Completion)
	if math.IsNaN(total) || math.IsInf(total, 0) || total <= 0 {
		return 0
	}
	return total
}

func buildUsageModelPriceIndex(prices map[string]ModelPrice) *usageModelPriceIndex {
	idx := &usageModelPriceIndex{
		exact:        make(map[string]string, len(prices)),
		base:         make(map[string]string),
		dateStripped: make(map[string]string),
	}
	for key := range prices {
		lower := strings.ToLower(key)
		setShortestUsageModelPriceKey(idx.exact, lower, key)
		baseName := usageLastPathSegment(lower)
		setShortestUsageModelPriceKey(idx.base, baseName, key)
		stripped := usageStripModelDateSuffix(baseName)
		if stripped != baseName {
			setShortestUsageModelPriceKey(idx.dateStripped, stripped, key)
		}
	}
	return idx
}

func lookupUsageModelPrice(idx *usageModelPriceIndex, prices map[string]ModelPrice, model string) (ModelPrice, bool) {
	if price, ok := prices[model]; ok {
		return price, true
	}
	lower := strings.ToLower(strings.TrimSpace(model))
	if lower == "" {
		return ModelPrice{}, false
	}
	if key, ok := idx.exact[lower]; ok {
		if price, ok := prices[key]; ok {
			return price, true
		}
	}
	baseName := usageLastPathSegment(lower)
	if key, ok := idx.base[baseName]; ok {
		if price, ok := prices[key]; ok {
			return price, true
		}
	}
	stripped := usageStripModelDateSuffix(baseName)
	if stripped != baseName {
		if key, ok := idx.base[stripped]; ok {
			if price, ok := prices[key]; ok {
				return price, true
			}
		}
		if key, ok := idx.dateStripped[stripped]; ok {
			if price, ok := prices[key]; ok {
				return price, true
			}
		}
	}
	if key, ok := idx.dateStripped[baseName]; ok {
		if price, ok := prices[key]; ok {
			return price, true
		}
	}
	return ModelPrice{}, false
}

func setShortestUsageModelPriceKey(target map[string]string, key string, candidate string) {
	if existing, ok := target[key]; !ok || len(candidate) < len(existing) {
		target[key] = candidate
	}
}

func usageLastPathSegment(value string) string {
	idx := strings.LastIndex(value, "/")
	if idx < 0 {
		return value
	}
	return value[idx+1:]
}

func usageStripModelDateSuffix(value string) string {
	return usageModelDateSuffixRegex.ReplaceAllString(value, "")
}

func successRate(group *usageBreakdownGroup) float64 {
	if group.TotalCalls <= 0 {
		return 1
	}
	return float64(group.SuccessCalls) / float64(group.TotalCalls)
}

func compareInt64(left int64, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareFloat64(left float64, right float64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func pageBounds(length int, page int, pageSize int) (int, int) {
	start := (page - 1) * pageSize
	if start > length {
		start = length
	}
	end := start + pageSize
	if end > length {
		end = length
	}
	return start, end
}

func payloadFromBreakdownDetails(details []usageBreakdownDetail) usage.Payload {
	payload := usage.Payload{APIs: map[string]*usage.APIAggregate{}}
	for _, item := range details {
		detail := item.Detail
		payload.TotalRequests += detail.RequestCount
		payload.SuccessCount += detail.SuccessCount
		payload.FailureCount += detail.FailureCount
		payload.Tokens.InputTokens += detail.Tokens.InputTokens
		payload.Tokens.OutputTokens += detail.Tokens.OutputTokens
		payload.Tokens.ReasoningTokens += detail.Tokens.ReasoningTokens
		payload.Tokens.CachedTokens += detail.Tokens.CachedTokens
		payload.Tokens.CacheTokens += detail.Tokens.CacheTokens
		payload.Tokens.TotalTokens += detail.Tokens.TotalTokens
		payload.TotalTokens += detail.Tokens.TotalTokens
		payload.LatencySumMS += detail.LatencySumMS
		payload.LatencyCount += detail.LatencyCount

		apiSummary := payload.APIs[item.Endpoint]
		if apiSummary == nil {
			apiSummary = &usage.APIAggregate{Models: map[string]*usage.ModelAggregate{}}
			payload.APIs[item.Endpoint] = apiSummary
		}
		modelSummary := apiSummary.Models[item.Model]
		if modelSummary == nil {
			modelSummary = &usage.ModelAggregate{}
			apiSummary.Models[item.Model] = modelSummary
		}
		modelSummary.Details = append(modelSummary.Details, detail)
	}
	if payload.LatencyCount > 0 {
		averageLatency := payload.LatencySumMS / payload.LatencyCount
		payload.LatencyMS = &averageLatency
	}
	return payload
}

func payloadSummaryFromBreakdownDetails(details []usageBreakdownDetail) usage.Payload {
	payload := usage.Payload{APIs: map[string]*usage.APIAggregate{}}
	for _, item := range details {
		detail := item.Detail
		payload.TotalRequests += detail.RequestCount
		payload.SuccessCount += detail.SuccessCount
		payload.FailureCount += detail.FailureCount
		payload.Tokens.InputTokens += detail.Tokens.InputTokens
		payload.Tokens.OutputTokens += detail.Tokens.OutputTokens
		payload.Tokens.ReasoningTokens += detail.Tokens.ReasoningTokens
		payload.Tokens.CachedTokens += detail.Tokens.CachedTokens
		payload.Tokens.CacheTokens += detail.Tokens.CacheTokens
		payload.Tokens.TotalTokens += detail.Tokens.TotalTokens
		payload.TotalTokens += detail.Tokens.TotalTokens
		payload.LatencySumMS += detail.LatencySumMS
		payload.LatencyCount += detail.LatencyCount
	}
	if payload.LatencyCount > 0 {
		averageLatency := payload.LatencySumMS / payload.LatencyCount
		payload.LatencyMS = &averageLatency
	}
	return payload
}

func payloadSummaryFromEvents(events []usage.Event) usage.Payload {
	payload := usage.Payload{APIs: map[string]*usage.APIAggregate{}}
	for _, event := range events {
		payload.TotalRequests++
		if event.Failed {
			payload.FailureCount++
		} else {
			payload.SuccessCount++
		}
		payload.TotalTokens += event.TotalTokens
		payload.Tokens.InputTokens += event.InputTokens
		payload.Tokens.OutputTokens += event.OutputTokens
		payload.Tokens.ReasoningTokens += event.ReasoningTokens
		payload.Tokens.CachedTokens += event.CachedTokens
		payload.Tokens.CacheTokens += event.CacheTokens
		payload.Tokens.TotalTokens += event.TotalTokens
		if event.LatencyMS != nil {
			payload.LatencySumMS += *event.LatencyMS
			payload.LatencyCount++
		}
	}
	if payload.LatencyCount > 0 {
		averageLatency := payload.LatencySumMS / payload.LatencyCount
		payload.LatencyMS = &averageLatency
	}
	return payload
}

func (s *Store) RecentEvents(ctx context.Context, limit int) ([]usage.Event, error) {
	if limit <= 0 {
		limit = 50000
	}
	return s.queryEvents(ctx, "", nil, limit, 0)
}

func (s *Store) queryEvents(ctx context.Context, whereClause string, args []any, limit int, offset int) ([]usage.Event, error) {
	rows, err := s.db.QueryContext(ctx, `select
		request_id, event_hash, timestamp_ms, timestamp, provider, model, endpoint, method, path,
		auth_type, auth_index, source, source_hash, api_key_hash,
		account_snapshot, auth_label_snapshot, auth_file_snapshot, auth_provider_snapshot, auth_project_id_snapshot, auth_snapshot_at_ms,
		requested_model, resolved_model,
		input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_tokens, total_tokens,
		latency_ms, failed, raw_json, created_at_ms
		from usage_events`+whereClause+`
		order by timestamp_ms desc, id desc
		limit ? offset ?`, append(args, limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]usage.Event, 0)
	for rows.Next() {
		var event usage.Event
		var requestID, provider, endpoint, method, path, authType, authIndex, source, sourceHash, apiKeyHash, accountSnapshot, authLabelSnapshot, authFileSnapshot, authProviderSnapshot, authProjectIDSnapshot, requestedModel, resolvedModel, rawJSON sql.NullString
		var authSnapshotAt sql.NullInt64
		var latency sql.NullInt64
		var failed int
		if err := rows.Scan(
			&requestID,
			&event.EventHash,
			&event.TimestampMS,
			&event.Timestamp,
			&provider,
			&event.Model,
			&endpoint,
			&method,
			&path,
			&authType,
			&authIndex,
			&source,
			&sourceHash,
			&apiKeyHash,
			&accountSnapshot,
			&authLabelSnapshot,
			&authFileSnapshot,
			&authProviderSnapshot,
			&authProjectIDSnapshot,
			&authSnapshotAt,
			&requestedModel,
			&resolvedModel,
			&event.InputTokens,
			&event.OutputTokens,
			&event.ReasoningTokens,
			&event.CachedTokens,
			&event.CacheTokens,
			&event.TotalTokens,
			&latency,
			&failed,
			&rawJSON,
			&event.CreatedAtMS,
		); err != nil {
			return nil, err
		}
		event.RequestID = requestID.String
		event.Provider = provider.String
		event.Endpoint = endpoint.String
		event.Method = method.String
		event.Path = path.String
		event.AuthType = authType.String
		event.AuthIndex = authIndex.String
		event.Source = source.String
		event.SourceHash = sourceHash.String
		event.APIKeyHash = apiKeyHash.String
		event.AccountSnapshot = accountSnapshot.String
		event.AuthLabelSnapshot = authLabelSnapshot.String
		event.AuthFileSnapshot = authFileSnapshot.String
		event.AuthProviderSnapshot = authProviderSnapshot.String
		event.AuthProjectIDSnapshot = authProjectIDSnapshot.String
		event.RequestedModel = requestedModel.String
		event.ResolvedModel = resolvedModel.String
		if authSnapshotAt.Valid {
			event.AuthSnapshotAtMS = authSnapshotAt.Int64
		}
		event.RawJSON = rawJSON.String
		event.Failed = failed != 0
		if latency.Valid {
			value := latency.Int64
			event.LatencyMS = &value
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) Counts(ctx context.Context) (events int64, deadLetters int64, err error) {
	if err = s.db.QueryRowContext(ctx, `select count(*) from usage_events`).Scan(&events); err != nil {
		return 0, 0, err
	}
	if err = s.db.QueryRowContext(ctx, `select count(*) from dead_letter_events`).Scan(&deadLetters); err != nil {
		return 0, 0, err
	}
	return events, deadLetters, nil
}

func (s *Store) ExportJSONL(ctx context.Context) ([]byte, error) {
	events, err := s.RecentEvents(ctx, 0)
	if err != nil {
		return nil, err
	}
	output := make([]byte, 0)
	for i := len(events) - 1; i >= 0; i-- {
		line, err := json.Marshal(events[i])
		if err != nil {
			return nil, err
		}
		output = append(output, line...)
		output = append(output, '\n')
	}
	return output, nil
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullInt(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullPositiveInt64(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func (s Setup) String() string {
	return fmt.Sprintf("upstream=%s queue=%s popSide=%s", s.CPAUpstreamURL, s.Queue, s.PopSide)
}
