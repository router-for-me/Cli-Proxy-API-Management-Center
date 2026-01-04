import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { VisualConfigValues } from '../types';

export type VisualSectionProps = {
  t: TFunction;
  values: VisualConfigValues;
  setValues: Dispatch<SetStateAction<VisualConfigValues>>;
  disabled: boolean;
};

