import React, { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, RenderOptions } from '@testing-library/react';

interface WrapperOptions {
  initialEntries?: string[];
}

/**
 * Renders a React element wrapped with test providers (MemoryRouter).
 * Extend this as the project adds more providers (i18next, zustand, etc.).
 */
export function renderWithProviders(
  ui: ReactElement,
  options: WrapperOptions & Omit<RenderOptions, 'wrapper'> = {}
) {
  const { initialEntries = ['/'], ...renderOptions } = options;

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export { render };
