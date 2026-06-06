// go-ai-eval.js - 围棋 AI 评估函数（启发式，无深度搜索）

const EMPTY = 0, BLACK = 1, WHITE = 2;
const SIZE = 19;

// 位置权重表（19×19，中心高、边角低）
const POSITION_WEIGHT = (() => {
    const weights = [];
    for (let r = 0; r < SIZE; r++) {
        const row = [];
        for (let c = 0; c < SIZE; c++) {
            // 距中心的曼哈顿距离
            const dist = Math.abs(r - 9) + Math.abs(c - 9);
            // 中心最高，边角最低
            row.push(Math.max(1, 10 - dist));
        }
        weights.push(row);
    }
    return weights;
})();

// 获取相邻位置
function getNeighbors(x, y) {
    const neighbors = [];
    if (x > 0) neighbors.push([x - 1, y]);
    if (x < SIZE - 1) neighbors.push([x + 1, y]);
    if (y > 0) neighbors.push([x, y - 1]);
    if (y < SIZE - 1) neighbors.push([x, y + 1]);
    return neighbors;
}

// BFS 获取连通同色棋子组
function getGroup(cells, x, y) {
    const color = cells[y][x];
    if (color === EMPTY) return [];

    const visited = new Set();
    const group = [];
    const queue = [{ x, y }];
    visited.add(y * SIZE + x);

    while (queue.length > 0) {
        const curr = queue.shift();
        group.push(curr);

        for (const [nx, ny] of getNeighbors(curr.x, curr.y)) {
            const key = ny * SIZE + nx;
            if (!visited.has(key) && cells[ny][nx] === color) {
                visited.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
    }

    return group;
}

// 计算一个棋组的气数
function getLiberties(cells, group) {
    const libertySet = new Set();
    for (const stone of group) {
        for (const [nx, ny] of getNeighbors(stone.x, stone.y)) {
            if (cells[ny][nx] === EMPTY) {
                libertySet.add(ny * SIZE + nx);
            }
        }
    }
    return libertySet.size;
}

// 模拟落子并提子（不修改原棋盘）
function simulateMove(cells, x, y, color) {
    const copy = cells.map(row => row.slice());
    const opp = color === BLACK ? WHITE : BLACK;
    copy[y][x] = color;

    const captured = [];
    for (const [nx, ny] of getNeighbors(x, y)) {
        if (copy[ny][nx] === opp) {
            const group = getGroup(copy, nx, ny);
            const liberties = getLiberties(copy, group);
            if (liberties === 0) {
                for (const stone of group) {
                    copy[stone.y][stone.x] = EMPTY;
                    captured.push(stone);
                }
            }
        }
    }

    // 检查自杀
    if (captured.length === 0) {
        const myGroup = getGroup(copy, x, y);
        const myLiberties = getLiberties(copy, myGroup);
        if (myLiberties === 0) {
            return null; // 自杀着
        }
    }

    return { board: copy, captured };
}

// 评估一个落子位置的价值
export function evaluatePosition(cells, x, y, color) {
    const opp = color === BLACK ? WHITE : BLACK;
    const result = simulateMove(cells, x, y, color);
    if (!result) return -1; // 非法着点

    let score = 0;

    // 1. 提子加分
    score += result.captured.length * 50;

    // 2. 己方棋组气数加分
    const myGroup = getGroup(result.board, x, y);
    const myLiberties = getLiberties(result.board, myGroup);
    if (myLiberties === 1) score -= 30; // 只有1气，危险
    else if (myLiberties === 2) score += 5;
    else if (myLiberties >= 3) score += 15;

    // 3. 连接加分：与己方棋子相邻数
    let adjacentFriendly = 0;
    let adjacentEnemy = 0;
    for (const [nx, ny] of getNeighbors(x, y)) {
        if (cells[ny][nx] === color) adjacentFriendly++;
        else if (cells[ny][nx] === opp) adjacentEnemy++;
    }
    score += adjacentFriendly * 8;

    // 4. 防守加分：减少对手棋组的气
    for (const [nx, ny] of getNeighbors(x, y)) {
        if (cells[ny][nx] === opp) {
            const oppGroup = getGroup(cells, nx, ny);
            const oppLibBefore = getLiberties(cells, oppGroup);
            const oppLibAfter = getLiberties(result.board, oppGroup.map(s => {
                // 重新在结果棋盘上找对应棋子
                return s;
            }).filter(s => result.board[s.y][s.x] === opp));
            if (oppLibAfter <= 1 && oppLibBefore > 1) score += 40; // 叫吃
            else if (oppLibAfter < oppLibBefore) score += 10;
        }
    }

    // 5. 救己方弱棋加分
    for (const [nx, ny] of getNeighbors(x, y)) {
        if (cells[ny][nx] === color) {
            const friendGroup = getGroup(cells, nx, ny);
            const friendLib = getLiberties(cells, friendGroup);
            if (friendLib === 1) score += 60; // 救急
            else if (friendLib === 2) score += 15;
        }
    }

    // 6. 位置权重
    score += POSITION_WEIGHT[y][x];

    // 7. 边角特殊位置加分（星位、小目等）
    const starPoints = [3, 9, 15];
    if (starPoints.includes(y) && starPoints.includes(x)) score += 5;

    return score;
}

// 获取候选落子位置
export function getCandidateMoves(cells) {
    const candidates = [];
    const visited = new Set();

    // 已有棋子周围 2 格内的空位
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] !== EMPTY) continue;
            // 检查周围 2 格是否有棋子
            let hasNeighbor = false;
            for (let dr = -2; dr <= 2 && !hasNeighbor; dr++) {
                for (let dc = -2; dc <= 2 && !hasNeighbor; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && cells[nr][nc] !== EMPTY) {
                        hasNeighbor = true;
                    }
                }
            }
            if (hasNeighbor) {
                candidates.push({ x: c, y: r });
            }
        }
    }

    // 棋盘为空时，推荐天元或星位
    if (candidates.length === 0) {
        candidates.push({ x: 9, y: 9 }); // 天元
        candidates.push({ x: 3, y: 3 });
        candidates.push({ x: 15, y: 15 });
        candidates.push({ x: 3, y: 15 });
        candidates.push({ x: 15, y: 3 });
    }

    return candidates;
}

// 找出威胁位置（己方弱棋、对手强棋）
export function findThreats(cells, oppColor) {
    const threats = [];
    const visited = new Set();

    // 1. 找己方只有 1 口气的棋组（紧急救援）
    const myColor = oppColor === BLACK ? WHITE : BLACK;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] !== myColor) continue;
            const key = r * SIZE + c;
            if (visited.has(key)) continue;

            const group = getGroup(cells, c, r);
            for (const s of group) visited.add(s.y * SIZE + s.x);

            const liberties = getLiberties(cells, group);
            if (liberties === 1) {
                // 找到这口气的位置
                for (const stone of group) {
                    for (const [nx, ny] of getNeighbors(stone.x, stone.y)) {
                        if (cells[ny][nx] === EMPTY) {
                            threats.push({ x: nx, y: ny, level: 'danger', reason: '救己方弱棋' });
                        }
                    }
                }
            } else if (liberties === 2) {
                threats.push({ x: group[0].x, y: group[0].y, level: 'warning', reason: '己方棋组气少' });
            }
        }
    }

    // 2. 找对手只有 1 口气的棋组（可以提子）
    const oppVisited = new Set();
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] !== oppColor) continue;
            const key = r * SIZE + c;
            if (oppVisited.has(key)) continue;

            const group = getGroup(cells, c, r);
            for (const s of group) oppVisited.add(s.y * SIZE + s.x);

            const liberties = getLiberties(cells, group);
            if (liberties === 1) {
                for (const stone of group) {
                    for (const [nx, ny] of getNeighbors(stone.x, stone.y)) {
                        if (cells[ny][nx] === EMPTY) {
                            threats.push({ x: nx, y: ny, level: 'danger', reason: '可提对手棋子' });
                        }
                    }
                }
            }
        }
    }

    return threats;
}

// 简单胜率估算
export function estimateWinRate(cells, myColor, captures) {
    const opp = myColor === BLACK ? WHITE : BLACK;
    let myStones = 0, oppStones = 0;
    let myInfluence = 0, oppInfluence = 0;

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] === myColor) {
                myStones++;
                myInfluence += POSITION_WEIGHT[r][c];
            } else if (cells[r][c] === opp) {
                oppStones++;
                oppInfluence += POSITION_WEIGHT[r][c];
            }
        }
    }

    // 加上提子数
    const myCaptures = captures[myColor] || 0;
    const oppCaptures = captures[opp] || 0;

    const myTotal = myStones + myCaptures * 2 + myInfluence * 0.1;
    const oppTotal = oppStones + oppCaptures * 2 + oppInfluence * 0.1;

    const diff = myTotal - oppTotal;
    const winRate = 50 + diff * 0.5;
    return Math.max(5, Math.min(95, Math.round(winRate)));
}

// 找最佳落子位置
export function findBestMove(cells, myColor, captures) {
    const candidates = getCandidateMoves(cells);
    if (candidates.length === 0) return null;

    let bestScore = -Infinity;
    let bestMove = candidates[0];

    for (const move of candidates) {
        // 进攻分
        const myScore = evaluatePosition(cells, move.x, move.y, myColor);
        if (myScore < 0) continue; // 非法着点

        // 防守分：如果对手下在这里的价值
        const opp = myColor === BLACK ? WHITE : BLACK;
        const oppScore = evaluatePosition(cells, move.x, move.y, opp);

        // 总分 = 进攻 + 防守权重
        const totalScore = myScore + oppScore * 0.8;

        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMove = move;
        }
    }

    return bestMove;
}

export { EMPTY, BLACK, WHITE, SIZE };
