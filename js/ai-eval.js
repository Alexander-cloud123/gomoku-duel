// ai-eval.js - 评估函数（棋型识别、评分）— 五子棋专用

const EMPTY = 0, BLACK = 1, WHITE = 2;

// 棋型分数
const SCORES = {
    FIVE: 1000000,
    LIVE_FOUR: 100000,
    RUSH_FOUR: 10000,
    LIVE_THREE: 5000,
    SLEEP_THREE: 500,
    LIVE_TWO: 500,
    SLEEP_TWO: 50,
    LIVE_ONE: 10
};

// 在一条线上分析棋型
export function evaluateLine(line, color) {
    const opp = color === BLACK ? WHITE : BLACK;
    let score = 0;
    const len = line.length;

    for (let i = 0; i < len; i++) {
        if (line[i] !== color) continue;

        let j = i;
        while (j < len && line[j] === color) j++;
        const count = j - i;

        const leftOpen = i > 0 && line[i - 1] === EMPTY;
        const rightOpen = j < len && line[j] === EMPTY;

        if (count >= 5) {
            score += SCORES.FIVE;
        } else if (count === 4) {
            if (leftOpen && rightOpen) score += SCORES.LIVE_FOUR;
            else if (leftOpen || rightOpen) score += SCORES.RUSH_FOUR;
        } else if (count === 3) {
            if (leftOpen && rightOpen) score += SCORES.LIVE_THREE;
            else if (leftOpen || rightOpen) score += SCORES.SLEEP_THREE;
        } else if (count === 2) {
            if (leftOpen && rightOpen) score += SCORES.LIVE_TWO;
            else if (leftOpen || rightOpen) score += SCORES.SLEEP_TWO;
        } else if (count === 1) {
            if (leftOpen && rightOpen) score += SCORES.LIVE_ONE;
        }

        i = j - 1;
    }

    return score;
}

// 评估整个棋盘
export function evaluateBoard(cells, myColor) {
    const opp = myColor === BLACK ? WHITE : BLACK;
    let myScore = 0, oppScore = 0;

    const directions = [
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 1, dy: 1 },
        { dx: 1, dy: -1 }
    ];

    const SIZE = cells.length;

    for (const { dx, dy } of directions) {
        const lines = extractLines(cells, dx, dy, SIZE);
        for (const line of lines) {
            myScore += evaluateLine(line, myColor);
            oppScore += evaluateLine(line, opp);
        }
    }

    return myScore - oppScore;
}

function extractLines(cells, dx, dy, size) {
    const lines = [];

    if (dx === 1 && dy === 0) {
        for (let r = 0; r < size; r++) {
            lines.push(cells[r].slice());
        }
    } else if (dx === 0 && dy === 1) {
        for (let c = 0; c < size; c++) {
            const line = [];
            for (let r = 0; r < size; r++) line.push(cells[r][c]);
            lines.push(line);
        }
    } else if (dx === 1 && dy === 1) {
        for (let start = -(size - 1); start < size; start++) {
            const line = [];
            for (let i = 0; i < size; i++) {
                const r = i, c = start + i;
                if (c >= 0 && c < size) line.push(cells[r][c]);
            }
            if (line.length >= 5) lines.push(line);
        }
    } else if (dx === 1 && dy === -1) {
        for (let start = 0; start < 2 * size - 1; start++) {
            const line = [];
            for (let i = 0; i < size; i++) {
                const r = i, c = start - i;
                if (c >= 0 && c < size) line.push(cells[r][c]);
            }
            if (line.length >= 5) lines.push(line);
        }
    }

    return lines;
}

// 获取候选落子位置
export function getCandidateMoves(cells) {
    const SIZE = cells.length;
    const candidates = [];
    const visited = new Set();

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] === EMPTY) continue;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
                    if (cells[nr][nc] !== EMPTY) continue;
                    const key = nr * SIZE + nc;
                    if (!visited.has(key)) {
                        visited.add(key);
                        candidates.push({ x: nc, y: nr });
                    }
                }
            }
        }
    }

    if (candidates.length === 0) {
        candidates.push({ x: Math.floor(SIZE / 2), y: Math.floor(SIZE / 2) });
    }

    return candidates;
}

// 找出威胁位置
export function findThreats(cells, oppColor) {
    const SIZE = cells.length;
    const threats = [];

    const candidates = getCandidateMoves(cells);
    for (const { x, y } of candidates) {
        cells[y][x] = oppColor;
        if (cells[y].filter(c => c === oppColor).length >= 4) {
            threats.push({ x, y, level: 'danger' });
        } else {
            const lineScore = quickScorePositionEval(cells, x, y, oppColor);
            if (lineScore >= SCORES.RUSH_FOUR) {
                threats.push({ x, y, level: 'danger' });
            } else if (lineScore >= SCORES.LIVE_THREE) {
                threats.push({ x, y, level: 'warning' });
            }
        }
        cells[y][x] = EMPTY;
    }

    return threats;
}

function quickScorePositionEval(cells, x, y, color) {
    const SIZE = cells.length;
    let totalScore = 0;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

    for (const [dx, dy] of directions) {
        let count = 1;
        let leftOpen = false, rightOpen = false;

        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i, ny = y + dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else {
                rightOpen = ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === EMPTY;
                break;
            }
        }
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i, ny = y - dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else {
                leftOpen = ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === EMPTY;
                break;
            }
        }

        if (count >= 5) totalScore += SCORES.FIVE;
        else if (count === 4) totalScore += (leftOpen && rightOpen) ? SCORES.LIVE_FOUR : (leftOpen || rightOpen) ? SCORES.RUSH_FOUR : 0;
        else if (count === 3) totalScore += (leftOpen && rightOpen) ? SCORES.LIVE_THREE : (leftOpen || rightOpen) ? SCORES.SLEEP_THREE : 0;
        else if (count === 2) totalScore += (leftOpen && rightOpen) ? SCORES.LIVE_TWO : (leftOpen || rightOpen) ? SCORES.SLEEP_TWO : 0;
    }

    return totalScore;
}

// 胜率计算
export function scoreToWinRate(scoreDiff) {
    const winRate = 1 / (1 + Math.exp(-scoreDiff / 10000));
    return Math.round(winRate * 100);
}

export { EMPTY, BLACK, WHITE, SCORES };
