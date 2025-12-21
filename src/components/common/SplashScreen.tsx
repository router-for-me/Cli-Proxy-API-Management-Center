import { useEffect, useState } from 'react';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import './SplashScreen.scss';

interface SplashScreenProps {
  onFinish: () => void;
  duration?: number;
}

export function SplashScreen({ onFinish, duration = 1500 }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, duration - 400);

    const finishTimer = setTimeout(() => {
      onFinish();
    }, duration);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [duration, onFinish]);

  return (
    <div className={`splash-screen ${fadeOut ? 'fade-out' : ''}`}>
      <div className="splash-content">
        <img src={INLINE_LOGO_JPEG} alt="CPAMC" className="splash-logo" />
        <h1 className="splash-title">CLI Proxy API</h1>
        <p className="splash-subtitle">Management Center</p>
        <div className="splash-loader">
          <div className="splash-loader-bar" />
        </div>
      </div>
    </div>
  );
}
