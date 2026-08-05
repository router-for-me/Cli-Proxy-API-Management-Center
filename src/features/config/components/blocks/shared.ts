// 载荷/规则编辑器共享的纯工具（从旧 VisualConfigEditorBlocks 原样迁出，
// 独立成文件以规避组件文件导出非组件的 react-refresh 限制）。

import type { useTranslation } from 'react-i18next';
import type {
  PayloadModelEntry,
  PayloadParamValidationErrorCode,
  VisualConfigValidationErrorCode,
} from '@/types/visualConfig';
import { VISUAL_CONFIG_PROTOCOL_OPTIONS } from '@/hooks/useVisualConfig';

export function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

export function buildProtocolOptions(
  t: ReturnType<typeof useTranslation>['t'],
  rules: Array<{ models: PayloadModelEntry[] }>
) {
  const options: Array<{ value: string; label: string }> = VISUAL_CONFIG_PROTOCOL_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
    })
  );
  const seen = new Set<string>(options.map((option) => option.value));

  for (const rule of rules) {
    for (const model of rule.models) {
      const protocol = model.protocol;
      if (!protocol || !protocol.trim() || seen.has(protocol)) continue;
      seen.add(protocol);
      options.push({ value: protocol, label: protocol });
    }
  }

  return options;
}
