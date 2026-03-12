import { useState, useCallback } from 'react';
import {
  formatSmartNumber,
  formatChineseUnit,
  formatEnglishUnit,
  formatFullNumber,
  type NumberUnitSystem,
} from '@/utils/numberFormat';
import styles from './SmartNumber.module.scss';

interface SmartNumberProps {
  value: number;
  context?: 'token' | 'request' | 'rate' | 'cost' | 'default';
  defaultFormat?: NumberUnitSystem;
  allowToggle?: boolean;
  className?: string;
  showTrend?: boolean;
  trendValue?: number;
}

const FORMAT_CYCLE: NumberUnitSystem[] = ['auto', 'chinese', 'english', 'full'];

export function SmartNumber({
  value,
  context = 'default',
  defaultFormat = 'auto',
  allowToggle = true,
  className = '',
  showTrend = false,
  trendValue,
}: SmartNumberProps) {
  const [format, setFormat] = useState<NumberUnitSystem>(defaultFormat);

  const cycleFormat = useCallback(() => {
    if (!allowToggle) return;
    const currentIndex = FORMAT_CYCLE.indexOf(format);
    const nextIndex = (currentIndex + 1) % FORMAT_CYCLE.length;
    setFormat(FORMAT_CYCLE[nextIndex]);
  }, [format, allowToggle]);

  const formatted = formatSmartNumber(value, { unitSystem: format, context });

  // 计算趋势
  const trend = showTrend && trendValue !== undefined ? trendValue : null;
  const trendPositive = trend !== null && trend > 0;
  const trendNegative = trend !== null && trend < 0;

  return (
    <span
      className={`${styles.smartNumber} ${allowToggle ? styles.clickable : ''} ${className}`}
      title={formatted.tooltip}
      onClick={cycleFormat}
    >
      <span className={styles.value}>{formatted.display}</span>
      {trend !== null && (
        <span
          className={`${styles.trend} ${
            trendPositive ? styles.trendUp : trendNegative ? styles.trendDown : ''
          }`}
        >
          {trendPositive ? '▲' : trendNegative ? '▼' : '—'}
          {Math.abs(trend * 100).toFixed(1)}%
        </span>
      )}
    </span>
  );
}

interface CompactNumberProps {
  value: number;
  unitSystem?: NumberUnitSystem;
  className?: string;
}

export function CompactNumber({ value, unitSystem = 'auto', className = '' }: CompactNumberProps) {
  let display: string;

  switch (unitSystem) {
    case 'chinese':
      display = formatChineseUnit(value);
      break;
    case 'english':
      display = formatEnglishUnit(value);
      break;
    case 'full':
      display = formatFullNumber(value);
      break;
    case 'auto':
    default:
      display = formatSmartNumber(value, { unitSystem: 'auto' }).display;
      break;
  }

  return (
    <span className={`${styles.compactNumber} ${className}`} title={value.toLocaleString()}>
      {display}
    </span>
  );
}

interface TokenNumberProps {
  value: number;
  className?: string;
}

export function TokenNumber({ value, className = '' }: TokenNumberProps) {
  const formatted = formatSmartNumber(value, { context: 'token' });

  return (
    <span className={`${styles.tokenNumber} ${className}`} title={formatted.full}>
      {formatted.display}
    </span>
  );
}

interface CostNumberProps {
  value: number;
  className?: string;
}

export function CostNumber({ value, className = '' }: CostNumberProps) {
  const formatted = formatSmartNumber(value, { context: 'cost' });

  return (
    <span className={`${styles.costNumber} ${className}`} title={formatted.full}>
      {formatted.display}
    </span>
  );
}

interface RateNumberProps {
  value: number;
  className?: string;
}

export function RateNumber({ value, className = '' }: RateNumberProps) {
  const formatted = formatSmartNumber(value, { context: 'rate' });

  return (
    <span className={`${styles.rateNumber} ${className}`} title={formatted.full}>
      {formatted.display}
    </span>
  );
}
