/**
 * 数字格式化工具
 * 支持智能单位选择、中文单位、英文单位等多种格式
 */

export type NumberUnitSystem = 'auto' | 'chinese' | 'english' | 'si' | 'full';

export interface NumberFormatOptions {
  unitSystem?: NumberUnitSystem;
  decimals?: number;
  showFullOnHover?: boolean;
  context?: 'token' | 'request' | 'rate' | 'cost' | 'default';
}

export interface FormattedNumber {
  display: string;
  full: string;
  unit: string;
  tooltip?: string;
}

/**
 * 检测用户语言环境是否为中国
 */
function isChineseLocale(): boolean {
  if (typeof navigator === 'undefined') return false;
  const lang = navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || '';
  return lang.toLowerCase().startsWith('zh');
}

/**
 * 中文单位格式化
 */
export function formatChineseUnit(value: number, decimals?: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

  const abs = Math.abs(num);
  const d = decimals ?? (abs >= 1e8 ? 2 : abs >= 1e4 ? 2 : 0);

  if (abs >= 1e12) return `${(num / 1e12).toFixed(d)}万亿`;
  if (abs >= 1e8) return `${(num / 1e8).toFixed(d)}亿`;
  if (abs >= 1e4) return `${(num / 1e4).toFixed(d)}万`;
  return num.toLocaleString();
}

/**
 * 英文单位格式化
 */
export function formatEnglishUnit(value: number, decimals?: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

  const abs = Math.abs(num);
  const d = decimals ?? 1;

  if (abs >= 1e12) return `${(num / 1e12).toFixed(d)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(d)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(d)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(d)}K`;
  return num.toLocaleString();
}

/**
 * SI单位格式化
 */
export function formatSiUnit(value: number, decimals?: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

  const abs = Math.abs(num);
  const d = decimals ?? 1;

  if (abs >= 1e12) return `${(num / 1e12).toFixed(d)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(d)}G`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(d)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(d)}k`;
  return num.toLocaleString();
}

/**
 * 完整数字格式化（带千分位）
 */
export function formatFullNumber(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString();
}

/**
 * Token专用格式化
 * Token数通常较大，使用更紧凑的格式
 */
export function formatTokenNumber(value: number, unitSystem: NumberUnitSystem = 'auto'): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

  const abs = Math.abs(num);

  // Token数通常较大，使用更紧凑的格式
  if (unitSystem === 'chinese' || (unitSystem === 'auto' && isChineseLocale())) {
    if (abs >= 1e8) return `${(num / 1e8).toFixed(2)}亿`;
    if (abs >= 1e4) return `${(num / 1e4).toFixed(2)}万`;
    return num.toLocaleString();
  }

  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

/**
 * 成本专用格式化
 */
export function formatCostNumber(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '$0.00';

  const abs = Math.abs(num);

  // 小额显示更多精度
  if (abs < 0.01 && abs > 0) {
    return `$${num.toFixed(6)}`;
  }
  if (abs < 1) {
    return `$${num.toFixed(4)}`;
  }

  const fixed = num.toFixed(2);
  const parts = Number(fixed).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${parts}`;
}

/**
 * 速率专用格式化 (RPM/TPM)
 */
export function formatRateNumber(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';

  const abs = Math.abs(num);
  if (abs >= 1000) {
    return Math.round(num).toLocaleString();
  }
  if (abs >= 100) {
    return num.toFixed(0);
  }
  if (abs >= 10) {
    return num.toFixed(1);
  }
  return num.toFixed(2);
}

/**
 * 智能数字格式化
 */
export function formatSmartNumber(value: number, options?: NumberFormatOptions): FormattedNumber {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { display: '0', full: '0', unit: '' };
  }

  const unitSystem = options?.unitSystem ?? 'auto';
  const context = options?.context ?? 'default';
  const decimals = options?.decimals;

  // 根据上下文选择默认小数位
  const effectiveDecimals = decimals ?? (context === 'rate' ? 2 : context === 'cost' ? 2 : 1);

  // 根据上下文选择格式化策略
  if (context === 'token') {
    const display = formatTokenNumber(num, unitSystem);
    return {
      display,
      full: num.toLocaleString(),
      unit: '',
      tooltip: num.toLocaleString(),
    };
  }

  if (context === 'cost') {
    const display = formatCostNumber(num);
    return {
      display,
      full: `$${num.toFixed(6)}`,
      unit: '',
      tooltip: `$${num.toFixed(6)}`,
    };
  }

  if (context === 'rate') {
    const display = formatRateNumber(num);
    return {
      display,
      full: num.toFixed(2),
      unit: '',
      tooltip: num.toFixed(2),
    };
  }

  // 通用格式化
  let display: string;
  const unit = '';

  switch (unitSystem) {
    case 'chinese':
      display = formatChineseUnit(num, effectiveDecimals);
      break;
    case 'english':
      display = formatEnglishUnit(num, effectiveDecimals);
      break;
    case 'si':
      display = formatSiUnit(num, effectiveDecimals);
      break;
    case 'full':
      display = formatFullNumber(num);
      break;
    case 'auto':
    default:
      if (isChineseLocale()) {
        display = formatChineseUnit(num, effectiveDecimals);
      } else {
        display = formatEnglishUnit(num, effectiveDecimals);
      }
      break;
  }

  return {
    display,
    full: num.toLocaleString(),
    unit,
    tooltip: num.toLocaleString(),
  };
}

/**
 * 百分比格式化
 */
export function formatPercent(value: number, decimals = 1): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0%';
  return `${(num * 100).toFixed(decimals)}%`;
}

/**
 * 变化百分比格式化（带符号）
 */
export function formatChangePercent(value: number, decimals = 1): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0%';
  const sign = num > 0 ? '+' : '';
  return `${sign}${(num * 100).toFixed(decimals)}%`;
}
