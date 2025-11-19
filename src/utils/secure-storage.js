// 简单的浏览器端加密存储封装
// 仅用于避免本地缓存中明文暴露敏感值，无法替代服务端安全控制

const ENC_PREFIX = 'enc::v1::';
const SECRET_SALT = 'cli-proxy-api-webui::secure-storage';

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

let cachedKeyBytes = null;

function encodeText(text) {
    if (encoder) return encoder.encode(text);
    const result = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        result[i] = text.charCodeAt(i) & 0xff;
    }
    return result;
}

function decodeText(bytes) {
    if (decoder) return decoder.decode(bytes);
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
    }
    return result;
}

function getKeyBytes() {
    if (cachedKeyBytes) return cachedKeyBytes;
    try {
        const host = typeof window !== 'undefined' ? window.location.host : 'unknown-host';
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown-ua';
        cachedKeyBytes = encodeText(`${SECRET_SALT}|${host}|${ua}`);
    } catch (error) {
        console.warn('Secure storage fallback to plain text:', error);
        cachedKeyBytes = encodeText(SECRET_SALT);
    }
    return cachedKeyBytes;
}

function xorBytes(data, keyBytes) {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ keyBytes[i % keyBytes.length];
    }
    return result;
}

function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function encode(value) {
    if (value === null || value === undefined) return value;
    try {
        const keyBytes = getKeyBytes();
        const encrypted = xorBytes(encodeText(String(value)), keyBytes);
        return `${ENC_PREFIX}${toBase64(encrypted)}`;
    } catch (error) {
        console.warn('Secure storage encode fallback:', error);
        return String(value);
    }
}

function decode(payload) {
    if (payload === null || payload === undefined) return payload;
    if (!payload.startsWith(ENC_PREFIX)) {
        return payload;
    }
    try {
        const encodedBody = payload.slice(ENC_PREFIX.length);
        const encrypted = fromBase64(encodedBody);
        const decrypted = xorBytes(encrypted, getKeyBytes());
        return decodeText(decrypted);
    } catch (error) {
        console.warn('Secure storage decode fallback:', error);
        return payload;
    }
}

export const secureStorage = {
    setItem(key, value, { encrypt = true } = {}) {
        if (typeof localStorage === 'undefined') return;
        if (value === null || value === undefined) {
            localStorage.removeItem(key);
            return;
        }
        const storedValue = encrypt ? encode(value) : String(value);
        localStorage.setItem(key, storedValue);
    },

    getItem(key, { decrypt = true } = {}) {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        return decrypt ? decode(raw) : raw;
    },

    removeItem(key) {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(key);
    },

    migratePlaintextKeys(keys = []) {
        if (typeof localStorage === 'undefined') return;
        keys.forEach((key) => {
            const raw = localStorage.getItem(key);
            if (raw && !String(raw).startsWith(ENC_PREFIX)) {
                this.setItem(key, raw, { encrypt: true });
            }
        });
    }
};
