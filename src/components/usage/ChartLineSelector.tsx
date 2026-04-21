import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { MAX_USAGE_CHART_LINES } from './hooks/useUsageViewState';
import styles from './UsageCharts.module.scss';

export interface ChartLineSelectorProps {
  chartLines: string[];
  modelNames: string[];
  maxLines?: number;
  onChange: (lines: string[]) => void;
}

export const ChartLineSelector = memo(function ChartLineSelector({
  chartLines,
  modelNames,
  maxLines = MAX_USAGE_CHART_LINES,
  onChange,
}: ChartLineSelectorProps) {
  const { t } = useTranslation();
  const hasUnusedModel = modelNames.some((model) => !chartLines.includes(model));
  const canAddLine =
    chartLines.length < maxLines && (hasUnusedModel || !chartLines.includes('all'));

  const handleAdd = () => {
    if (!canAddLine) return;
    const unusedModel = modelNames.find((m) => !chartLines.includes(m));
    if (unusedModel) {
      onChange([...chartLines, unusedModel]);
    } else if (!chartLines.includes('all')) {
      onChange([...chartLines, 'all']);
    }
  };

  const handleRemove = (index: number) => {
    if (chartLines.length <= 1) return;
    const newLines = [...chartLines];
    newLines.splice(index, 1);
    onChange(newLines);
  };

  const handleChange = (index: number, value: string) => {
    const newLines = [...chartLines];
    newLines[index] = value;
    onChange(newLines);
  };

  const options = useMemo(
    () => [
      { value: 'all', label: t('usage_stats.chart_line_all') },
      ...modelNames.map((name) => ({ value: name, label: name })),
    ],
    [modelNames, t]
  );

  return (
    <Card
      className={styles.chartLineCard}
      title={t('usage_stats.chart_line_actions_label')}
      extra={
        <div className={styles.chartLineHeader}>
          <span className={styles.chartLineCount}>
            {chartLines.length}/{maxLines}
          </span>
          <Button variant="secondary" size="sm" onClick={handleAdd} disabled={!canAddLine}>
            {t('usage_stats.chart_line_add')}
          </Button>
        </div>
      }
    >
      <div className={styles.chartLineList}>
        {chartLines.map((line, index) => (
          <div key={index} className={styles.chartLineItem}>
            <span className={styles.chartLineLabel}>
              {t(`usage_stats.chart_line_label_${index + 1}`)}
            </span>
            <Select
              value={line}
              options={options}
              onChange={(value) => handleChange(index, value)}
            />
            {chartLines.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className={styles.chartLineRemoveButton}
                onClick={() => handleRemove(index)}
              >
                {t('usage_stats.chart_line_delete')}
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className={styles.chartLineHint}>
        {t('usage_stats.chart_line_hint', { count: maxLines })}
      </p>
    </Card>
  );
});

ChartLineSelector.displayName = 'ChartLineSelector';
