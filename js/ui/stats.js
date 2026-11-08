// js/ui/stats.js - 本地设置与战绩（localStorage，失败时静默降级）
const STORAGE_KEY = 'gomoku-duel:v2';

const DEFAULTS = {
    name: '玩家',
    mode: 'gomoku',
    goSize: 19,
    komi: 7.5,
    assist: true,
    difficulty: 'medium',
    sound: true,
    stats: {
        gomoku: { win: 0, loss: 0, draw: 0 },
        go: { win: 0, loss: 0, draw: 0 }
    }
};

function safeParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function loadProfile() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? safeParse(raw) : null;
        if (!parsed || typeof parsed !== 'object') return structuredClone(DEFAULTS);
        return {
            ...DEFAULTS,
            ...parsed,
            stats: {
                gomoku: { ...DEFAULTS.stats.gomoku, ...(parsed.stats?.gomoku || {}) },
                go: { ...DEFAULTS.stats.go, ...(parsed.stats?.go || {}) }
            }
        };
    } catch {
        return structuredClone(DEFAULTS);
    }
}

export function saveProfile(profile) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
        /* 隐私模式或存储已满时忽略 */
    }
}

export function recordResult(profile, mode, outcome) {
    if (!profile.stats[mode]) profile.stats[mode] = { win: 0, loss: 0, draw: 0 };
    profile.stats[mode][outcome] = (profile.stats[mode][outcome] || 0) + 1;
    saveProfile(profile);
    return profile;
}

export function formatStats(profile, mode) {
    const s = profile.stats[mode] || { win: 0, loss: 0, draw: 0 };
    return `${s.win} 胜 / ${s.loss} 负 / ${s.draw} 和`;
}
