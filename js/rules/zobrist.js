// js/rules/zobrist.js - 确定性 Zobrist 哈希（棋形哈希 / AI 置换表共用）
import { BLACK, WHITE } from './constants.js';

function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createZobrist(size, seed = 20260602) {
    const rand = mulberry32(seed);
    // table[color][y][x] = [k1, k2]，两个 32 位半哈希降低碰撞
    const table = {};
    for (const color of [BLACK, WHITE]) {
        const rows = [];
        for (let y = 0; y < size; y++) {
            const row = [];
            for (let x = 0; x < size; x++) {
                row.push([Math.floor(rand() * 4294967296), Math.floor(rand() * 4294967296)]);
            }
            rows.push(row);
        }
        table[color] = rows;
    }

    function hash(cells) {
        let a = 0;
        let b = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const stone = cells[y][x];
                if (stone === 0) continue;
                const k = table[stone][y][x];
                a ^= k[0];
                b ^= k[1];
            }
        }
        return [a >>> 0, b >>> 0];
    }

    function key(a, b) {
        return `${a.toString(36)}:${b.toString(36)}`;
    }

    return { size, table, hash, key };
}
