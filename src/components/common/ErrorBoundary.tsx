import { Component, type ErrorInfo, type ReactNode } from 'react';
import { withTranslation } from 'react-i18next';
import type { WithTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import styles from './ErrorBoundary.module.scss';

interface ErrorBoundaryProps extends WithTranslation {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryBase extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { t } = this.props;
      const isDev = import.meta.env.DEV;
      const error = this.state.error;

      return (
        <div className={styles.overlay}>
          <div className={styles.card}>
            <div className={styles.iconWrapper}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>

            <h1 className={styles.title}>{t('common.error_boundary_title')}</h1>
            <p className={styles.description}>{t('common.error_boundary_description')}</p>

            {isDev && error && (
              <details className={styles.details}>
                <summary>{error.message}</summary>
                <pre className={styles.stackTrace}>{error.stack}</pre>
              </details>
            )}

            <div className={styles.retryButton}>
              <Button variant="primary" onClick={this.handleRetry}>
                {t('common.retry')}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryBase);
