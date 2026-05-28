package usage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	ImportFormatJSONL         = "usage_service_jsonl"
	ImportFormatLegacyExport  = "legacy_usage_export"
	ImportFormatLegacyPayload = "legacy_usage_payload"
)

var (
	ErrUnsupportedImportFormat = errors.New("unsupported usage import format")
	ErrLegacyUsageNoDetails    = errors.New("legacy usage export does not contain request details")
)

type ImportParseResult struct {
	Format      string
	Events      []Event
	Failed      int
	Unsupported int
	Warnings    []string
}

func ParseImportPayload(data []byte) (ImportParseResult, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return ImportParseResult{}, errors.New("empty usage import payload")
	}

	switch trimmed[0] {
	case '{':
		result, err := parseJSONObjectImport(trimmed)
		if err != nil && bytes.Contains(trimmed, []byte{'\n'}) && !errors.Is(err, ErrLegacyUsageNoDetails) {
			return parseJSONLImport(trimmed)
		}
		return result, err
	case '[':
		return parseJSONArrayImport(trimmed)
	default:
		return parseJSONLImport(trimmed)
	}
}

func parseJSONObjectImport(data []byte) (ImportParseResult, error) {
	var record map[string]any
	if err := decodeJSON(data, &record); err != nil {
		return ImportParseResult{}, err
	}

	if usageRaw, ok := record["usage"]; ok {
		usageRecord, ok := usageRaw.(map[string]any)
		if !ok {
			return ImportParseResult{}, ErrLegacyUsageNoDetails
		}
		if hasUsageAPIs(usageRecord) {
			result, err := eventsFromLegacyUsage(usageRecord, ImportFormatLegacyExport)
			if err != nil {
				return result, err
			}
			return result, nil
		}
		return ImportParseResult{
			Format:      ImportFormatLegacyExport,
			Unsupported: 1,
		}, ErrLegacyUsageNoDetails
	}

	if hasUsageAPIs(record) {
		return eventsFromLegacyUsage(record, ImportFormatLegacyPayload)
	}

	if event, ok, err := eventFromExportedRecord(record); ok || err != nil {
		if err != nil {
			return ImportParseResult{Format: ImportFormatJSONL, Failed: 1}, err
		}
		return ImportParseResult{Format: ImportFormatJSONL, Events: []Event{event}}, nil
	}

	if looksLikeLegacyUsageSummary(record) {
		return ImportParseResult{
			Format:      ImportFormatLegacyPayload,
			Unsupported: 1,
		}, ErrLegacyUsageNoDetails
	}

	event, err := NormalizeRaw(data)
	if err != nil {
		return ImportParseResult{Format: ImportFormatJSONL, Failed: 1}, err
	}
	return ImportParseResult{Format: ImportFormatJSONL, Events: []Event{event}}, nil
}

func parseJSONArrayImport(data []byte) (ImportParseResult, error) {
	var items []json.RawMessage
	if err := decodeJSON(data, &items); err != nil {
		return ImportParseResult{}, err
	}

	result := ImportParseResult{Format: ImportFormatJSONL}
	for _, item := range items {
		event, err := eventFromJSONRecord(item)
		if err != nil {
			result.Failed++
			continue
		}
		result.Events = append(result.Events, event)
	}
	return result, nil
}

func parseJSONLImport(data []byte) (ImportParseResult, error) {
	result := ImportParseResult{Format: ImportFormatJSONL}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		event, err := eventFromJSONRecord([]byte(line))
		if err != nil {
			result.Failed++
			continue
		}
		result.Events = append(result.Events, event)
	}
	if err := scanner.Err(); err != nil {
		return result, err
	}
	return result, nil
}

func eventFromJSONRecord(data []byte) (Event, error) {
	var record map[string]any
	if err := decodeJSON(data, &record); err != nil {
		return Event{}, err
	}
	if event, ok, err := eventFromExportedRecord(record); ok || err != nil {
		return event, err
	}
	return NormalizeRaw(data)
}

func eventFromExportedRecord(record map[string]any) (Event, bool, error) {
	eventHash := readString(record, "event_hash", "eventHash")
	if eventHash == "" {
		return Event{}, false, nil
	}

	timestampMS := readInt(record, "timestamp_ms", "timestampMs")
	timestamp := readString(record, "timestamp")
	if timestampMS <= 0 || timestamp == "" {
		parsedMS, parsedTimestamp := readTimestamp(record)
		if timestampMS <= 0 {
			timestampMS = parsedMS
		}
		if timestamp == "" {
			timestamp = parsedTimestamp
		}
	}

	inputTokens, outputTokens, reasoningTokens, cachedTokens, cacheTokens, totalTokens := readTokenFields(record)
	if totalTokens <= 0 {
		totalTokens = inputTokens + outputTokens + reasoningTokens + maxInt64(cachedTokens, cacheTokens)
	}

	event := Event{
		RequestID:             readString(record, "request_id", "requestId"),
		EventHash:             eventHash,
		TimestampMS:           timestampMS,
		Timestamp:             timestamp,
		Provider:              readString(record, "provider"),
		Model:                 readString(record, "model"),
		Endpoint:              readString(record, "endpoint"),
		Method:                readString(record, "method"),
		Path:                  readString(record, "path"),
		AuthType:              readString(record, "auth_type", "authType"),
		AuthIndex:             readString(record, "auth_index", "authIndex", "AuthIndex"),
		Source:                readString(record, "source"),
		SourceHash:            readString(record, "source_hash", "sourceHash"),
		APIKeyHash:            readString(record, "api_key_hash", "apiKeyHash"),
		AccountSnapshot:       readString(record, "account_snapshot", "accountSnapshot"),
		AuthLabelSnapshot:     readString(record, "auth_label_snapshot", "authLabelSnapshot"),
		AuthFileSnapshot:      readString(record, "auth_file_snapshot", "authFileSnapshot"),
		AuthProviderSnapshot:  readString(record, "auth_provider_snapshot", "authProviderSnapshot"),
		AuthProjectIDSnapshot: readString(record, "auth_project_id_snapshot", "authProjectIdSnapshot"),
		AuthSnapshotAtMS:      readInt(record, "auth_snapshot_at_ms", "authSnapshotAtMs"),
		InputTokens:           inputTokens,
		OutputTokens:          outputTokens,
		ReasoningTokens:       reasoningTokens,
		CachedTokens:          cachedTokens,
		CacheTokens:           cacheTokens,
		TotalTokens:           totalTokens,
		LatencyMS:             readOptionalInt(record, "latency_ms", "latencyMs"),
		Failed:                readBool(record, "failed", "is_failed", "isFailed"),
		RawJSON:               readString(record, "raw_json", "rawJson"),
		CreatedAtMS:           readInt(record, "created_at_ms", "createdAtMs"),
	}
	if event.Model == "" {
		event.Model = "-"
	}
	if event.Endpoint == "" {
		event.Endpoint = "-"
	}
	if event.CreatedAtMS <= 0 {
		event.CreatedAtMS = time.Now().UnixMilli()
	}
	return event, true, nil
}

func eventsFromLegacyUsage(usageRecord map[string]any, format string) (ImportParseResult, error) {
	apisRaw, ok := usageRecord["apis"].(map[string]any)
	if !ok {
		return ImportParseResult{Format: format, Unsupported: 1}, ErrLegacyUsageNoDetails
	}

	result := ImportParseResult{
		Format: format,
		Warnings: []string{
			"legacy_usage_metadata_is_partial",
			"legacy_usage_source_matching_may_be_approximate",
		},
	}
	now := time.Now().UnixMilli()
	endpointIndex := 0
	for _, endpoint := range sortedKeys(apisRaw) {
		apiRaw := apisRaw[endpoint]
		endpointIndex++
		apiEntry, ok := apiRaw.(map[string]any)
		if !ok {
			result.Failed++
			continue
		}
		modelsRaw, ok := apiEntry["models"].(map[string]any)
		if !ok {
			result.Failed++
			continue
		}

		method, path := parseEndpoint(endpoint)
		modelIndex := 0
		for _, model := range sortedKeys(modelsRaw) {
			modelRaw := modelsRaw[model]
			modelIndex++
			modelEntry, ok := modelRaw.(map[string]any)
			if !ok {
				result.Failed++
				continue
			}
			detailsRaw, ok := modelEntry["details"].([]any)
			if !ok || len(detailsRaw) == 0 {
				result.Unsupported++
				continue
			}
			for detailIndex, detailRaw := range detailsRaw {
				detail, ok := detailRaw.(map[string]any)
				if !ok {
					result.Failed++
					continue
				}
				event, err := eventFromLegacyDetail(
					endpoint,
					method,
					path,
					model,
					detail,
					endpointIndex,
					modelIndex,
					detailIndex,
					now,
				)
				if err != nil {
					result.Failed++
					continue
				}
				result.Events = append(result.Events, event)
			}
		}
	}

	if len(result.Events) == 0 {
		return result, ErrLegacyUsageNoDetails
	}
	return result, nil
}

func eventFromLegacyDetail(
	endpoint string,
	method string,
	path string,
	model string,
	detail map[string]any,
	endpointIndex int,
	modelIndex int,
	detailIndex int,
	now int64,
) (Event, error) {
	timestamp := readString(detail, "timestamp", "time", "created_at", "createdAt")
	if timestamp == "" {
		return Event{}, errors.New("legacy usage detail missing timestamp")
	}
	timestampMS, normalizedTimestamp := readTimestamp(detail)

	inputTokens, outputTokens, reasoningTokens, cachedTokens, cacheTokens, totalTokens := readTokenFields(detail)
	if totalTokens <= 0 {
		totalTokens = inputTokens + outputTokens + reasoningTokens + maxInt64(cachedTokens, cacheTokens)
	}

	sourceRaw := readString(detail, "source", "api_key", "apiKey", "key", "account", "email")
	apiKey := readString(detail, "api_key", "apiKey", "key")
	authIndex := readString(detail, "auth_index", "authIndex", "AuthIndex")
	rawJSON := legacyRawJSON(endpoint, model, detail)
	requestID := readString(detail, "request_id", "requestId", "id")
	if requestID == "" {
		requestID = legacyRequestID(endpoint, model, normalizedTimestamp, rawJSON, endpointIndex, modelIndex, detailIndex)
	}

	event := Event{
		RequestID:             requestID,
		TimestampMS:           timestampMS,
		Timestamp:             normalizedTimestamp,
		Provider:              readString(detail, "provider", "type", "auth_type", "authType"),
		Model:                 model,
		Endpoint:              endpoint,
		Method:                method,
		Path:                  path,
		AuthType:              readString(detail, "auth_type", "authType"),
		AuthIndex:             authIndex,
		Source:                maskSource(sourceRaw),
		SourceHash:            hashString(sourceRaw),
		APIKeyHash:            hashString(apiKey),
		AccountSnapshot:       readString(detail, "account_snapshot", "accountSnapshot"),
		AuthLabelSnapshot:     readString(detail, "auth_label_snapshot", "authLabelSnapshot"),
		AuthFileSnapshot:      readString(detail, "auth_file_snapshot", "authFileSnapshot"),
		AuthProviderSnapshot:  readString(detail, "auth_provider_snapshot", "authProviderSnapshot"),
		AuthProjectIDSnapshot: readString(detail, "auth_project_id_snapshot", "authProjectIdSnapshot"),
		AuthSnapshotAtMS:      readInt(detail, "auth_snapshot_at_ms", "authSnapshotAtMs"),
		InputTokens:           inputTokens,
		OutputTokens:          outputTokens,
		ReasoningTokens:       reasoningTokens,
		CachedTokens:          cachedTokens,
		CacheTokens:           cacheTokens,
		TotalTokens:           totalTokens,
		LatencyMS:             readOptionalInt(detail, "latency_ms", "latencyMs", "duration_ms", "durationMs", "elapsed_ms", "elapsedMs"),
		Failed:                readFailed(detail),
		RawJSON:               rawJSON,
		CreatedAtMS:           now,
	}
	if event.Model == "" {
		event.Model = "-"
	}
	if event.Endpoint == "" {
		event.Endpoint = "-"
	}
	event.EventHash = buildEventHash(event)
	return event, nil
}

func legacyRawJSON(endpoint string, model string, detail map[string]any) string {
	record := map[string]any{
		"format":   "legacy_usage_export",
		"endpoint": endpoint,
		"model":    model,
		"detail":   redactValue(detail),
	}
	raw, _ := json.Marshal(record)
	return string(raw)
}

func legacyRequestID(endpoint string, model string, timestamp string, rawJSON string, endpointIndex int, modelIndex int, detailIndex int) string {
	raw := strings.Join([]string{
		"legacy",
		strconv.Itoa(endpointIndex),
		strconv.Itoa(modelIndex),
		strconv.Itoa(detailIndex),
		endpoint,
		model,
		timestamp,
		rawJSON,
	}, "|")
	hash := hashString(raw)
	if len(hash) > 16 {
		hash = hash[:16]
	}
	return "legacy:" + hash
}

func parseEndpoint(endpoint string) (method string, path string) {
	if match := endpointPattern.FindStringSubmatch(endpoint); len(match) == 3 {
		return strings.ToUpper(match[1]), match[2]
	}
	return "", ""
}

func hasUsageAPIs(record map[string]any) bool {
	apis, ok := record["apis"].(map[string]any)
	return ok && len(apis) > 0
}

func sortedKeys(record map[string]any) []string {
	keys := make([]string, 0, len(record))
	for key := range record {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func looksLikeLegacyUsageSummary(record map[string]any) bool {
	_, hasTotal := record["total_requests"]
	_, hasSuccess := record["success_count"]
	_, hasFailure := record["failure_count"]
	return hasTotal || hasSuccess || hasFailure
}

func readBool(record map[string]any, keys ...string) bool {
	raw := first(record, keys...)
	switch value := raw.(type) {
	case bool:
		return value
	case json.Number:
		parsed, _ := value.Int64()
		return parsed != 0
	case float64:
		return value != 0
	case string:
		normalized := strings.ToLower(strings.TrimSpace(value))
		return normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
	default:
		return false
	}
}

func decodeJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("usage import payload contains multiple JSON values")
	}
	return nil
}
