// board.js - 棋盘渲染、落子、胜负判定

const EMPTY = 0, BLACK = 1, WHITE = 2;
const SIZE = 15;

export class Board {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.size = SIZE;
        this.cells = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
        this.onCellClick = null;
        this.lastMove = null;
        this.aiHints = null; // { recommend: {x,y}, threats: [{x,y}] }

        this._padding = 30;
        this._cellSize = (canvas.width - this._padding * 2) / (SIZE - 1);

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

            if (col >= 0 && col < SIZE && row >= 0 && row < SIZE) {
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

            if (col >= 0 && col < SIZE && row >= 0 && row < SIZE && this.cells[row][col] === EMPTY) {
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
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return false;
        if (this.cells[y][x] !== EMPTY) return false;
        this.cells[y][x] = color;
        this.lastMove = { x, y };
        this.render();
        return true;
    }

    undo(x, y) {
        if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
            this.cells[y][x] = EMPTY;
            this.render();
        }
    }

    checkWin(x, y, color) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (const [dx, dy] of directions) {
            let count = 1;
            for (let i = 1; i < 5; i++) {
                const nx = x + dx * i, ny = y + dy * i;
                if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && this.cells[ny][nx] === color) count++;
                else break;
            }
            for (let i = 1; i < 5; i++) {
                const nx = x - dx * i, ny = y - dy * i;
                if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && this.cells[ny][nx] === color) count++;
                else break;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    isFull() {
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (this.cells[r][c] === EMPTY) return false;
        return true;
    }

    setAiHints(hints) {
        this.aiHints = hints;
        this.render();
    }

    reset() {
        this.cells = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
        this.lastMove = null;
        this.aiHints = null;
        this._hoverPos = null;
        this.render();
    }

    render() {
        const ctx = this.ctx;
        const p = this._padding;
        const cs = this._cellSize;

        // 背景
        ctx.fillStyle = '#F4ECD8';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 网格线
        ctx.strokeStyle = '#3D3D3D';
        ctx.lineWidth = 1;
        for (let i = 0; i < SIZE; i++) {
            ctx.beginPath();
            ctx.moveTo(p + i * cs, p);
            ctx.lineTo(p + i * cs, p + (SIZE - 1) * cs);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(p, p + i * cs);
            ctx.lineTo(p + (SIZE - 1) * cs, p + i * cs);
            ctx.stroke();
        }

        // 星位
        const starPoints = [3, 7, 11];
        ctx.fillStyle = '#3D3D3D';
        for (const r of starPoints) {
            for (const c of starPoints) {
                ctx.beginPath();
                ctx.arc(p + c * cs, p + r * cs, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 坐标标注
        ctx.fillStyle = '#7F8C8D';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < SIZE; i++) {
            // 列标 A-O
            ctx.fillText(String.fromCharCode(65 + i), p + i * cs, p - 16);
            // 行标 1-15
            ctx.fillText(String(i + 1), p - 18, p + i * cs);
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
                ctx.font = 'bold 14px sans-serif';
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

            // 脉动效果用 CSS 动画替代，这里画静态金色圈
            ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
            ctx.beginPath();
            ctx.arc(p + r.x * cs, p + r.y * cs, cs * 0.42, 0, Math.PI * 2);
            ctx.fill();
        }

        // 棋子
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (this.cells[r][c] !== EMPTY) {
                    this._drawStone(c, r, this.cells[r][c]);
                }
            }
        }

        // 最后落子标记
        if (this.lastMove) {
            const lm = this.lastMove;
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

export { EMPTY, BLACK, WHITE, SIZE };
