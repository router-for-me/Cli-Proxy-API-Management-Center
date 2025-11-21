// 轻量事件总线，避免模块之间的直接耦合
export function createEventBus() {
    const target = new EventTarget();

    const on = (type, listener) => target.addEventListener(type, listener);
    const off = (type, listener) => target.removeEventListener(type, listener);
    const emit = (type, detail = {}) => target.dispatchEvent(new CustomEvent(type, { detail }));

    return { on, off, emit };
}
