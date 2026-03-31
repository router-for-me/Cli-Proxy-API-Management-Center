import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [checking, setChecking] = useState(!isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      setChecking(false);
      return;
    }

    let mounted = true;
    const tryRestore = async () => {
      setChecking(true);
      try {
        await restoreSession();
      } finally {
        if (mounted) {
          setChecking(false);
        }
      }
    };

    void tryRestore();

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, restoreSession]);

  if (checking) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
