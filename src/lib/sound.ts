type SoundType = 'click' | 'success' | 'error' | 'toggle' | 'notify' | 'delete' | 'hover' | 'switch';

let audioCtx: AudioContext | null = null;
let muted = localStorage.getItem('cli-proxy-sound-muted') === 'true';

const getAudioContext = (): AudioContext => {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
};

export const isMuted = () => muted;

export const setMuted = (value: boolean) => {
  muted = value;
  localStorage.setItem('cli-proxy-sound-muted', String(value));
};

export const toggleMute = () => {
  setMuted(!muted);
  return muted;
};

const playTone = (
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.06,
  attack = 0.005
) => {
  if (muted) return;

  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  filter.type = 'lowpass';
  filter.frequency.value = 2000;

  oscillator.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
};

export const playSound = (sound: SoundType) => {
  if (muted) return;

  switch (sound) {
    case 'click':
      playTone(600, 0.03, 'triangle', 0.175, 0.002);
      break;
    case 'hover':
      playTone(1800, 0.02, 'sine', 0.1, 0.001);
      break;
    case 'success':
      playTone(1400, 0.08, 'sine', 0.15, 0.002);
      break;
    case 'error':
      playTone(300, 0.05, 'sine', 0.2, 0.002);
      break;
    case 'delete':
      playTone(600, 0.06, 'sine', 0.125, 0.001);
      break;
    case 'toggle':
      playTone(880, 0.05, 'sine', 0.15, 0.002);
      break;
    case 'switch':
      playTone(440, 0.015, 'square', 0.125, 0.001);
      setTimeout(() => playTone(880, 0.04, 'square', 0.1, 0.001), 20);
      break;
    case 'notify':
      playTone(1000, 0.1, 'sine', 0.15, 0.003);
      break;
  }
};

export const sounds = {
  click: () => playSound('click'),
  hover: () => playSound('hover'),
  success: () => playSound('success'),
  error: () => playSound('error'),
  delete: () => playSound('delete'),
  toggle: () => playSound('toggle'),
  notify: () => playSound('notify'),
  switch: () => playSound('switch'),
};
