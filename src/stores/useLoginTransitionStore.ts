/**
 * 登录 → 主界面的跨路由过渡状态。
 *
 * 编排（"开灯"）：
 * 1. 登录成功：按钮就地确认（✓ 已连接），停留 SUCCESS_HOLD；
 * 2. 退场：登录页整体淡入纯黑，EXIT；
 * 3. 在纯黑中切换路由，全局黑幕（LoginRevealVeil）接管画面；
 * 4. 揭幕：黑幕淡出、模糊退焦，主界面外壳与内容依次落位，REVEAL。
 *
 * 黑幕挂在路由之外，因此能跨越登录页卸载与主界面挂载的那一帧，不闪白。
 */

import { create } from 'zustand';

export type LoginTransitionPhase = 'idle' | 'revealing';

export interface LoginTransitionTimings {
  /** 成功确认的停留时间 */
  successHold: number;
  /** 登录页淡入纯黑 */
  exit: number;
  /** 主界面揭幕 */
  reveal: number;
}

export const LOGIN_TRANSITION_TIMINGS: LoginTransitionTimings = {
  successHold: 260,
  exit: 320,
  reveal: 640,
};

/** 减少动效：保留"已连接"的状态确认与短淡入淡出，去掉位移与模糊 */
export const LOGIN_TRANSITION_TIMINGS_REDUCED: LoginTransitionTimings = {
  successHold: 260,
  exit: 150,
  reveal: 200,
};

export const getLoginTransitionTimings = (reducedMotion: boolean): LoginTransitionTimings =>
  reducedMotion ? LOGIN_TRANSITION_TIMINGS_REDUCED : LOGIN_TRANSITION_TIMINGS;

interface LoginTransitionState {
  phase: LoginTransitionPhase;
  /** 每次揭幕自增，供黑幕区分不同轮次 */
  revealId: number;
  startReveal: () => void;
  finishReveal: () => void;
}

export const useLoginTransitionStore = create<LoginTransitionState>((set) => ({
  phase: 'idle',
  revealId: 0,
  startReveal: () => set((state) => ({ phase: 'revealing', revealId: state.revealId + 1 })),
  finishReveal: () => set({ phase: 'idle' }),
}));

/** 主界面挂载时读取一次：是否由登录过渡带入，用于播放外壳入场 */
export const isArrivingFromLogin = () => useLoginTransitionStore.getState().phase === 'revealing';
