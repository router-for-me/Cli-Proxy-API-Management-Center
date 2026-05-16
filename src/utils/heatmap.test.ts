import { describe, it, expect } from 'vitest';
import { buildHeatmapMatrix, getHeatLevel } from './heatmap';
import type { HeatmapMatrix } from './heatmap';

describe('buildHeatmapMatrix', () => {
  it('returns empty matrix for empty input', () => {
    const result = buildHeatmapMatrix([], 'tokens');
    expect(result.rows).toHaveLength(0);
    expect(result.models).toHaveLength(0);
    expect(result).toEqual<HeatmapMatrix>({ rows: [], models: [] });
  });

  it('aggregates single entry correctly', () => {
    const details = [
      {
        source: 'sk-01',
        __modelName: 'gpt-4',
        tokens: { total_tokens: 100 },
        failed: false,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ];

    const result = buildHeatmapMatrix(details, 'tokens');
    expect(result.models).toEqual(['gpt-4']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source).toBe('sk-01');
    expect(result.rows[0].totalTokens).toBe(100);
    expect(result.rows[0].totalRequests).toBe(1);

    const cell = result.rows[0].cells['gpt-4'];
    expect(cell.value).toBe(100);
    expect(cell.totalRequests).toBe(1);
    expect(cell.successCount).toBe(1);
    expect(cell.failureCount).toBe(0);
    expect(cell.isEmpty).toBe(false);
  });

  it('aggregates by request count when metric is "requests"', () => {
    const details = [
      {
        source: 'sk-01',
        __modelName: 'gpt-4',
        tokens: { total_tokens: 500 },
        failed: false,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ];

    const result = buildHeatmapMatrix(details, 'requests');
    expect(result.rows[0].totalTokens).toBe(1); // increment = 1 per request
    expect(result.rows[0].cells['gpt-4'].value).toBe(1);
  });

  it('groups entries by source and model', () => {
    const details = [
      { source: 'sk-01', __modelName: 'gpt-4', tokens: { total_tokens: 100 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
      { source: 'sk-01', __modelName: 'gpt-4', tokens: { total_tokens: 200 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
      { source: 'sk-01', __modelName: 'claude-3', tokens: { total_tokens: 300 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
      { source: 'sk-02', __modelName: 'gpt-4', tokens: { total_tokens: 400 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
    ];

    const result = buildHeatmapMatrix(details, 'tokens');
    expect(result.models).toHaveLength(2);
    expect(result.rows).toHaveLength(2);

    // Row for sk-01: tokens = 100 + 200 = 300 (gpt-4) + 300 (claude-3) = 600
    const row1 = result.rows.find((r) => r.source === 'sk-01')!;
    expect(row1.totalTokens).toBe(600);
    expect(row1.totalRequests).toBe(3);
    expect(row1.cells['gpt-4'].value).toBe(300);

    const row2 = result.rows.find((r) => r.source === 'sk-02')!;
    expect(row2.totalTokens).toBe(400);
    expect(row2.totalRequests).toBe(1);
  });

  it('creates empty cells for missing model-source combinations', () => {
    const details = [
      { source: 'sk-01', __modelName: 'gpt-4', tokens: { total_tokens: 100 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
      { source: 'sk-02', __modelName: 'claude-3', tokens: { total_tokens: 200 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
    ];

    const result = buildHeatmapMatrix(details, 'tokens');
    // Each row gets a cell for every model
    expect(result.models).toHaveLength(2);
    for (const row of result.rows) {
      const modelKeys = Object.keys(row.cells);
      expect(modelKeys).toHaveLength(result.models.length);
      for (const model of result.models) {
        expect(row.cells[model]).toBeDefined();
      }
    }

    // sk-01 has gpt-4 data, claude-3 should be empty
    const row1 = result.rows.find((r) => r.source === 'sk-01')!;
    expect(row1.cells['claude-3'].isEmpty).toBe(true);
    expect(row1.cells['gpt-4'].isEmpty).toBe(false);
  });

  it('tracks failure and success counts correctly', () => {
    const details = [
      { source: 'sk-01', __modelName: 'gpt-4', tokens: { total_tokens: 100 }, failed: true, timestamp: '2025-01-01T00:00:00Z' },
      { source: 'sk-01', __modelName: 'gpt-4', tokens: { total_tokens: 100 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
      { source: 'sk-01', __modelName: 'gpt-4', tokens: { total_tokens: 100 }, failed: false, timestamp: '2025-01-01T00:00:00Z' },
    ];

    const result = buildHeatmapMatrix(details, 'tokens');
    const cell = result.rows[0].cells['gpt-4'];
    expect(cell.successCount).toBe(2);
    expect(cell.failureCount).toBe(1);
    expect(cell.totalRequests).toBe(3);
  });

  it('handles missing optional fields', () => {
    const details = [
      {
        source: '',
        tokens: { total_tokens: 100 },
        failed: false,
        timestamp: '',
      },
    ];

    // Should not throw, source defaults to 'unknown', modelName defaults to 'Unknown'
    expect(() => buildHeatmapMatrix(details)).not.toThrow();
    const result = buildHeatmapMatrix(details);
    expect(result.rows[0].source).toBe('unknown');
    expect(result.rows[0].cells['Unknown'].isEmpty).toBe(false);
  });
});

describe('getHeatLevel', () => {
  it('returns 0 when max is 0 or negative', () => {
    expect(getHeatLevel(100, 0, 0)).toBe(0);
    expect(getHeatLevel(100, 0, -1)).toBe(0);
  });

  it('returns 0 when value is 0 or negative', () => {
    expect(getHeatLevel(0, 0, 100)).toBe(0);
    expect(getHeatLevel(-5, 0, 100)).toBe(0);
  });

  it('returns 5 for max value', () => {
    expect(getHeatLevel(100, 0, 100)).toBe(5);
  });

  it('returns increasing levels for larger values', () => {
    const level1 = getHeatLevel(1, 0, 1000);
    const level2 = getHeatLevel(10, 0, 1000);
    const level3 = getHeatLevel(100, 0, 1000);
    const levelMax = getHeatLevel(1000, 0, 1000);

    // Levels should be non-decreasing as value increases
    expect(level1).toBeLessThanOrEqual(level2);
    expect(level2).toBeLessThanOrEqual(level3);
    expect(level3).toBeLessThanOrEqual(levelMax);
    expect(levelMax).toBe(5);
  });
});
