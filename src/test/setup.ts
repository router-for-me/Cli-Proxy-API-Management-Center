import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock react-i18next so component tests don't need translation files
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Mock Chart.js to avoid canvas dependency in component tests
vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  registerables: [],
  CategoryScale: vi.fn(),
  LinearScale: vi.fn(),
  PointElement: vi.fn(),
  LineElement: vi.fn(),
  BarElement: vi.fn(),
  Title: vi.fn(),
  Tooltip: vi.fn(),
  Legend: vi.fn(),
}));
