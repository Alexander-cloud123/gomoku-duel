// board.js - 棋盘渲染、落子、胜负判定（支持五子棋和围棋）

const EMPTY = 0, BLACK = 1, WHITE = 2;

export class Board {
    constructor(canvas, size = 15, gameMode = 'gomoku') {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.size = size;
        this.gameMode = gameMode;
        this.cells = Array.from({ length: size }, () => new Array(size).fill(EMPTY));
        this.onCellClick = null;
        this.lastMove = null;
        this.aiHints = null; // { recommend: {x,y}, threats: [{x,y}], topThreats: [{x,y}] }

        this._padding = 30;
        this._cellSize = (canvas.width - this._padding * 2) / (size - 1);

        // 围棋特有状态
        this.koPoint = null; // 打劫禁着点 {x, y}
        this.prevStateHash = null; // 上一步棋盘状态哈希

        this._bindEvents();
        this.render();
    }

    _bindEvents() {
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;

            const col = Math.round((x - this._padding) / this._cellSize);
            const row = Math.round((y - this._padding) / this._cellSize);

            if (col >= 0 && col < this.size && row >= 0 && row < this.size) {
                if (this.onCellClick) this.onCellClick(col, row);
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;

            const col = Math.round((x - this._padding) / this._cellSize);
            const row = Math.round((y - this._padding) / this._cellSize);

            if (col >= 0 && col < this.size && row >= 0 && row < this.size && this.cells[row][col] === EMPTY) {
                this._hoverPos = { x: col, y: row };
            } else {
                this._hoverPos = null;
            }
            this.render();
        });

        this.canvas.addEventListener('mouseleave', () => {
            this._hoverPos = null;
            this.render();
        });
    }

    place(x, y, color) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
        if (this.cells[y][x] !== EMPTY) return false;

        if (this.gameMode === 'go') {
            return this._placeGo(x, y, color);
        }

        // 五子棋模式
        this.cells[y][x] = color;
        this.lastMove = { x, y };
        this.render();
        return true;
    }

    // ===== 围棋落子逻辑 =====
    _placeGo(x, y, color) {
        const opp = color === BLACK ? WHITE : BLACK;

        // 1. 检查打劫禁着点
        if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y) {
            return false;
        }

        // 2. 临时落子
        this.cells[y][x] = color;

        // 3. 检查并提走对方无气的棋组
        const captured = [];
        const neighbors = this._getNeighbors(x, y);
        for (const [nx, ny] of neighbors) {
            if (this.cells[ny][nx] === opp) {
                const group = this._getGroup(nx, ny);
                const liberties = this._getLiberties(group);
                if (liberties === 0) {
                    for (const stone of group) {
                        this.cells[stone.y][stone.x] = EMPTY;
                        captured.push(stone);
                    }
                }
            }
        }

        // 4. 检查自杀（落子后己方棋组无气且未提子）
        if (captured.length === 0) {
            const myGroup = this._getGroup(x, y);
            const myLiberties = this._getLiberties(myGroup);
            if (myLiberties === 0) {
                // 自杀着，撤回
                this.cells[y][x] = EMPTY;
                return false;
            }
        }

        // 5. 更新打劫禁着点（只提一子且己方也只一子时设置 Ko）
        this.koPoint = null;
        if (captured.length === 1) {
            const myGroup = this._getGroup(x, y);
            if (myGroup.length === 1) {
                this.koPoint = { x: captured[0].x, y: captured[0].y };
            }
        }

        this.lastMove = { x, y };
        this.render();
        return { captured };
    }

    // 获取相邻位置
    _getNeighbors(x, y) {
        const neighbors = [];
        if (x > 0) neighbors.push([x - 1, y]);
        if (x < this.size - 1) neighbors.push([x + 1, y]);
        if (y > 0) neighbors.push([x, y - 1]);
        if (y < this.size - 1) neighbors.push([x, y + 1]);
        return neighbors;
    }

    // BFS 获取连通同色棋子组
    _getGroup(x, y) {
        const color = this.cells[y][x];
        if (color === EMPTY) return [];

        const visited = new Set();
        const group = [];
        const queue = [{ x, y }];
        visited.add(y * this.size + x);

        while (queue.length > 0) {
            const curr = queue.shift();
            group.push(curr);

            for (const [nx, ny] of this._getNeighbors(curr.x, curr.y)) {
                const key = ny * this.size + nx;
                if (!visited.has(key) && this.cells[ny][nx] === color) {
                    visited.add(key);
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        return group;
    }

    // 计算一个棋组的气数
    _getLiberties(group) {
        const libertySet = new Set();
        for (const stone of group) {
            for (const [nx, ny] of this._getNeighbors(stone.x, stone.y)) {
                if (this.cells[ny][nx] === EMPTY) {
                    libertySet.add(ny * this.size + nx);
                }
            }
        }
        return libertySet.size;
    }

    // 获取棋盘状态哈希（用于 Ko 判定）
    getStateHash() {
        let hash = '';
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                hash += this.cells[r][c];
            }
        }
        return hash;
    }

    // 围棋计分：中国规则数子法
    calculateScore(captures) {
        const visited = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let blackStones = 0;
        let whiteStones = 0;

        // 统计棋子数
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.cells[r][c] === BLACK) blackStones++;
                else if (this.cells[r][c] === WHITE) whiteStones++;
            }
        }

        // BFS 找空点区域，判断归属
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.cells[r][c] !== EMPTY || visited[r][c]) continue;

                const region = [];
                const queue = [{ x: c, y: r }];
                visited[r][c] = true;
                let touchesBlack = false;
                let touchesWhite = false;

                while (queue.length > 0) {
                    const curr = queue.shift();
                    region.push(curr);

                    for (const [nx, ny] of this._getNeighbors(curr.x, curr.y)) {
                        if (this.cells[ny][nx] === BLACK) touchesBlack = true;
                        else if (this.cells[ny][nx] === WHITE) touchesWhite = true;
                        else if (!visited[ny][nx]) {
                            visited[ny][nx] = true;
                            queue.push({ x: nx, y: ny });
                        }
                    }
                }

                // 只被一方包围的空点算该方领地
                if (touchesBlack && !touchesWhite) blackTerritory += region.length;
                else if (touchesWhite && !touchesBlack) whiteTerritory += region.length;
                // 双方都接触的空点为中立，不计分
            }
        }

        // 中国规则：子数 + 目数，白方贴 7.5 目
        const blackScore = blackStones + blackTerritory;
        const whiteScore = whiteStones + whiteTerritory + 7.5;
        const winner = blackScore > whiteScore ? BLACK : WHITE;

        return {
            blackScore,
            whiteScore,
            blackStones,
            whiteStones,
            blackTerritory,
            whiteTerritory,
            winner
        };
    }

    // ===== 通用方法 =====

    undo(x, y, restoreStones = null) {
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
            this.cells[y][x] = EMPTY;
            // 围棋模式：恢复被提走的棋子
            if (restoreStones) {
                for (const s of restoreStones) {
                    this.cells[s.y][s.x] = s.color;
                }
            }
            this.render();
        }
    }

    checkWin(x, y, color) {
        if (this.gameMode === 'go') return false; // 围棋无即时胜负

        // 五子棋：五连判定
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (const [dx, dy] of directions) {
            let count = 1;
            for (let i = 1; i < 5; i++) {
                const nx = x + dx * i, ny = y + dy * i;
                if (ny >= 0 && ny < this.size && nx >= 0 && nx < this.size && this.cells[ny][nx] === color) count++;
                else break;
            }
            for (let i = 1; i < 5; i++) {
                const nx = x - dx * i, ny = y - dy * i;
                if (ny >= 0 && ny < this.size && nx >= 0 && nx < this.size && this.cells[ny][nx] === color) count++;
                else break;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    isFull() {
        for (let r = 0; r < this.size; r++)
            for (let c = 0; c < this.size; c++)
                if (this.cells[r][c] === EMPTY) return false;
        return true;
    }

    setAiHints(hints) {
        this.aiHints = hints;
        this.render();
    }

    reset() {
        this.cells = Array.from({ length: this.size }, () => new Array(this.size).fill(EMPTY));
        this.lastMove = null;
        this.aiHints = null;
        this._hoverPos = null;
        this.koPoint = null;
        this.prevStateHash = null;
        this.render();
    }

    render() {
        const ctx = this.ctx;
        const p = this._padding;
        const cs = this._cellSize;
        const size = this.size;

        // 背景
        ctx.fillStyle = '#F4ECD8';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 网格线
        ctx.strokeStyle = '#3D3D3D';
        ctx.lineWidth = 1;
        for (let i = 0; i < size; i++) {
            ctx.beginPath();
            ctx.moveTo(p + i * cs, p);
            ctx.lineTo(p + i * cs, p + (size - 1) * cs);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(p, p + i * cs);
            ctx.lineTo(p + (size - 1) * cs, p + i * cs);
            ctx.stroke();
        }

        // 星位
        const starPoints = this._getStarPoints();
        ctx.fillStyle = '#3D3D3D';
        for (const { r, c } of starPoints) {
            ctx.beginPath();
            ctx.arc(p + c * cs, p + r * cs, size === 19 ? 3.5 : 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // 坐标标注
        ctx.fillStyle = '#7F8C8D';
        ctx.font = size === 19 ? '9px sans-serif' : '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < size; i++) {
            // 列标 A-S (19) 或 A-O (15)
            ctx.fillText(String.fromCharCode(65 + (i >= 8 ? i + 1 : i)), p + i * cs, p - 14);
            // 行标 1-19 或 1-15
            ctx.fillText(String(size - i), p - 16, p + i * cs);
        }

        // AI 提示：作弊模式 - 显示三个威胁位置
        if (this.aiHints && this.aiHints.topThreats) {
            const colors = [
                'rgba(255, 0, 0, 0.5)',      // 红色 - 最大威胁
                'rgba(255, 165, 0, 0.4)',    // 橙色
                'rgba(255, 255, 0, 0.35)'    // 黄色
            ];
            for (let i = 0; i < this.aiHints.topThreats.length; i++) {
                const t = this.aiHints.topThreats[i];
                ctx.fillStyle = colors[i];
                ctx.beginPath();
                ctx.arc(p + t.x * cs, p + t.y * cs, cs * 0.4, 0, Math.PI * 2);
                ctx.fill();

                // 标注数字
                ctx.fillStyle = '#FFF';
                ctx.font = size === 19 ? 'bold 11px sans-serif' : 'bold 14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((i + 1).toString(), p + t.x * cs, p + t.y * cs);
            }
        }
        // AI 提示：正常模式 - 威胁位置
        else if (this.aiHints && this.aiHints.threats) {
            for (const t of this.aiHints.threats) {
                ctx.fillStyle = 'rgba(255, 68, 68, 0.35)';
                ctx.beginPath();
                ctx.arc(p + t.x * cs, p + t.y * cs, cs * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // AI 提示：推荐位置
        if (this.aiHints && this.aiHints.recommend) {
            const r = this.aiHints.recommend;
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p + r.x * cs, p + r.y * cs, cs * 0.42, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
            ctx.beginPath();
            ctx.arc(p + r.x * cs, p + r.y * cs, cs * 0.42, 0, Math.PI * 2);
            ctx.fill();
        }

        // 棋子
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (this.cells[r][c] !== EMPTY) {
                    this._drawStone(c, r, this.cells[r][c]);
                }
            }
        }

        // 最后落子标记
        if (this.lastMove) {
            const lm = this.lastMove;
            if (this.gameMode === 'go') {
                // 围棋：在棋子上画小方块
                const markColor = this.cells[lm.y][lm.x] === BLACK ? '#FFFFFF' : '#000000';
                ctx.fillStyle = markColor;
                const markSize = cs * 0.12;
                ctx.fillRect(
                    p + lm.x * cs - markSize,
                    p + lm.y * cs - markSize,
                    markSize * 2,
                    markSize * 2
                );
            } else {
                // 五子棋：红色方框
                ctx.strokeStyle = '#FF4444';
                ctx.lineWidth = 2;
                const markSize = 5;
                ctx.strokeRect(
                    p + lm.x * cs - markSize,
                    p + lm.y * cs - markSize,
                    markSize * 2,
                    markSize * 2
                );
            }
        }

        // 打劫禁着点标记（围棋）
        if (this.gameMode === 'go' && this.koPoint) {
            const kp = this.koPoint;
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 2;
            const s = cs * 0.2;
            ctx.strokeRect(p + kp.x * cs - s, p + kp.y * cs - s, s * 2, s * 2);
        }

        // 悬停预览
        if (this._hoverPos && this._hoverColor) {
            const h = this._hoverPos;
            if (this.cells[h.y][h.x] === EMPTY) {
                ctx.globalAlpha = 0.3;
                this._drawStone(h.x, h.y, this._hoverColor);
                ctx.globalAlpha = 1;
            }
        }
    }

    _getStarPoints() {
        if (this.size === 19) {
            // 标准围棋19路星位
            const pts = [3, 9, 15];
            const result = [];
            for (const r of pts) {
                for (const c of pts) {
                    result.push({ r, c });
                }
            }
            return result;
        } else if (this.size === 15) {
            const pts = [3, 7, 11];
            const result = [];
            for (const r of pts) {
                for (const c of pts) {
                    result.push({ r, c });
                }
            }
            return result;
        } else if (this.size === 9) {
            const pts = [2, 4, 6];
            const result = [];
            for (const r of pts) {
                for (const c of pts) {
                    result.push({ r, c });
                }
            }
            return result;
        }
        return [];
    }

    _drawStone(col, row, color) {
        const ctx = this.ctx;
        const p = this._padding;
        const cs = this._cellSize;
        const cx = p + col * cs;
        const cy = p + row * cs;
        const radius = cs * 0.42;

        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.beginPath();
        ctx.arc(cx + 2, cy + 2, radius, 0, Math.PI * 2);
        ctx.fill();

        if (color === BLACK) {
            ctx.fillStyle = '#1A1A1A';
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#1A1A1A';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    setHoverColor(color) {
        this._hoverColor = color;
    }

    getCellSize() {
        return this._cellSize;
    }

    getPadding() {
        return this._padding;
    }
}

export { EMPTY, BLACK, WHITE };
