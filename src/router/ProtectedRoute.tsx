import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [restoring, setRestoring] = useState(!isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) return;
    void restoreSession().finally(() => setRestoring(false));
  }, [isAuthenticated, restoreSession]);

  if (isAuthenticated) return children;
  if (restoring) return null;
  return <Navigate to="/login" replace state={{ from: location }} />;
}
