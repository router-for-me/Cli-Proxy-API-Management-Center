import { useEffect } from 'react';
import { prefersReducedMotion } from '@/hooks/motion';
import {
  getLoginTransitionTimings,
  useLoginTransitionStore,
} from '@/stores/useLoginTransitionStore';
import './LoginRevealVeil.scss';

/**
 * 登录成功后覆盖全屏的纯黑幕：在登录页淡入纯黑后接管画面，
 * 主界面挂载后从黑暗中"亮起"。不拦截指针，揭幕途中即可操作。
 */
export function LoginRevealVeil() {
  const phase = useLoginTransitionStore((state) => state.phase);
  const revealId = useLoginTransitionStore((state) => state.revealId);
  const finishReveal = useLoginTransitionStore((state) => state.finishReveal);

  useEffect(() => {
    if (phase !== 'revealing') return;
    // 兜底：animationend 在后台标签页或被禁用动画时可能不触发
    const { reveal } = getLoginTransitionTimings(prefersReducedMotion());
    const timer = window.setTimeout(finishReveal, reveal + 120);
    return () => window.clearTimeout(timer);
  }, [phase, revealId, finishReveal]);

  if (phase !== 'revealing') return null;

  return <LoginRevealVeilLayer key={revealId} onDone={finishReveal} />;
}

/** 黑幕本体：纯展示，动画结束时回调 */
export function LoginRevealVeilLayer({ onDone }: { onDone: () => void }) {
  return (
    <div
      className="login-reveal-veil"
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    />
  );
}
