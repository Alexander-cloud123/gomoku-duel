// main.js - 入口：初始化、状态切换、事件绑定（支持五子棋和围棋）

import { Board, BLACK, WHITE } from './board.js';
import { Game } from './game.js';
import { GameNet } from './webrtc.js';
import { AIAssistant, updateAIPanel } from './ai.js';
import { generateRoomCode, hasAssistant, stripAssistant, createRoomId } from './room.js';

// ===== 全局状态 =====
let board, game, net, ai;
let currentRoomCode = '';
let isHost = false;
let cheatModeEnabled = false;
let cheatSequence = 'something for nothing';
let currentCheatIndex = 0;
let currentGameMode = 'gomoku'; // 'gomoku' 或 'go'

// ===== 初始化 =====
function init() {
    // 默认初始化五子棋（后面会根据模式重建）
    board = new Board(document.getElementById('board'), 15, 'gomoku');
    game = new Game(board, 'gomoku');
    net = new GameNet();
    ai = new AIAssistant();

    // 暴露给测试环境
    window.__gomoku = { board, game, net, ai, Board, BLACK, WHITE, currentGameMode };

    // 棋盘点击
    board.onCellClick = (x, y) => {
        if (!game.isMyTurn()) return;
        if (game.placeStone(x, y)) {
            updateMoveHistory();
            updateGoCaptures();
            triggerAI();
        }
    };

    // 游戏事件
    game.onWin = (color) => handleWin(color);
    game.onDraw = () => handleDraw();
    game.onMoveSent = (msg) => net.send(msg);
    game.onUndoRequest = (msg) => net.send(msg);
    game.onDrawRequest = (msg) => net.send(msg);
    game.onGameEnd = (score) => handleGameEnd(score);

    // 网络事件
    net.onMessage = (data) => handleNetMessage(data);
    net.onConnected = () => {
        if (isHost) {
            startGame(currentRoomCode);
        }
    };
    net.onDisconnected = () => handleDisconnect();
    net.onError = (err) => handleError(err);

    // AI 事件
    ai.onResult = (result) => {
        updateAIPanel(result, game.myColor, currentGameMode);
        board.setAiHints({
            recommend: result.bestMove,
            threats: result.threats,
            topThreats: result.topThreats || null
        });
    };

    // 按钮绑定
    bindButtons();

    // 作弊码监听
    document.addEventListener('keydown', handleCheatCode);
}

// ===== 页面切换 =====
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
}

// ===== 按钮绑定 =====
function bindButtons() {
    // 模式选择
    document.getElementById('btn-mode-gomoku').addEventListener('click', () => selectMode('gomoku'));
    document.getElementById('btn-mode-go').addEventListener('click', () => selectMode('go'));

    // 首页
    document.getElementById('btn-create').addEventListener('click', createRoom);
    document.getElementById('btn-join').addEventListener('click', () => showPage('page-join'));

    // 等待页
    document.getElementById('btn-copy').addEventListener('click', copyRoomCode);
    document.getElementById('btn-cancel-wait').addEventListener('click', cancelWait);

    // 加入页
    document.getElementById('btn-join-confirm').addEventListener('click', joinRoom);
    document.getElementById('btn-cancel-join').addEventListener('click', () => showPage('page-home'));

    // 游戏操作
    document.getElementById('btn-undo').addEventListener('click', () => game.requestUndo());
    document.getElementById('btn-draw').addEventListener('click', () => game.requestDraw());
    document.getElementById('btn-pass').addEventListener('click', () => {
        if (game.pass()) {
            updateMoveHistory();
            triggerAI();
        }
    });

    // AI 开关
    document.getElementById('ai-toggle').addEventListener('change', (e) => {
        const enabled = e.target.checked;
        ai.enable(enabled);
        document.getElementById('ai-content').classList.toggle('disabled', !enabled);
        if (enabled) {
            board.setAiHints(null);
            if (game.isMyTurn()) triggerAI();
        } else {
            board.setAiHints(null);
        }
    });

    document.getElementById('btn-surrender').addEventListener('click', () => {
        if (confirm('确定要认输吗？')) {
            game.surrender();
        }
    });

    // 结果弹窗
    document.getElementById('btn-restart').addEventListener('click', () => {
        hideDialog('result-overlay');
        game.restart();
        net.send({ type: 'RESTART' });
    });
    document.getElementById('btn-exit').addEventListener('click', () => {
        hideDialog('result-overlay');
        net.destroy();
        showPage('page-home');
    });

    // 对话框按钮
    document.getElementById('dialog-yes').addEventListener('click', () => handleDialogResponse(true));
    document.getElementById('dialog-no').addEventListener('click', () => handleDialogResponse(false));
}

// ===== 模式选择 =====
function selectMode(mode) {
    currentGameMode = mode;
    document.getElementById('btn-mode-gomoku').classList.toggle('active', mode === 'gomoku');
    document.getElementById('btn-mode-go').classList.toggle('active', mode === 'go');
}

// ===== 重建游戏对象（根据模式） =====
function rebuildGameObjects() {
    // 销毁旧 Board 的事件监听器，防止重复绑定
    if (board && board.destroy) board.destroy();

    const canvas = document.getElementById('board');
    const size = currentGameMode === 'go' ? 19 : 15;

    board = new Board(canvas, size, currentGameMode);
    game = new Game(board, currentGameMode);
    ai.setGameMode(currentGameMode);

    // 重新绑定事件
    board.onCellClick = (x, y) => {
        if (!game.isMyTurn()) return;
        if (game.placeStone(x, y)) {
            updateMoveHistory();
            updateGoCaptures();
            triggerAI();
        }
    };

    game.onWin = (color) => handleWin(color);
    game.onDraw = () => handleDraw();
    game.onMoveSent = (msg) => net.send(msg);
    game.onUndoRequest = (msg) => net.send(msg);
    game.onDrawRequest = (msg) => net.send(msg);
    game.onGameEnd = (score) => handleGameEnd(score);

    ai.onResult = (result) => {
        updateAIPanel(result, game.myColor, currentGameMode);
        board.setAiHints({
            recommend: result.bestMove,
            threats: result.threats,
            topThreats: result.topThreats || null
        });
    };

    // 更新测试暴露
    window.__gomoku = { board, game, net, ai, Board, BLACK, WHITE, currentGameMode };
}

// ===== 创建房间 =====
async function createRoom() {
    const code = generateRoomCode();
    currentRoomCode = code + '*';
    isHost = true;

    // 重建游戏对象
    rebuildGameObjects();

    document.getElementById('room-code').textContent = code;
    document.getElementById('waiting-mode-badge').textContent = currentGameMode === 'go' ? '围棋' : '五子棋';
    showPage('page-waiting');

    try {
        await net.createRoom(code, currentGameMode);
    } catch (err) {
        showPage('page-home');
        alert('创建房间失败：' + err.message);
    }
}

// ===== 复制房间号 =====
async function copyRoomCode() {
    const code = stripAssistant(currentRoomCode);
    try {
        await navigator.clipboard.writeText(code);
        const btn = document.getElementById('btn-copy');
        btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = '一键复制'; }, 2000);
    } catch {
        const input = document.createElement('input');
        input.value = code;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        const btn = document.getElementById('btn-copy');
        btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = '一键复制'; }, 2000);
    }
}

// ===== 取消等待 =====
function cancelWait() {
    net.destroy();
    showPage('page-home');
}

// ===== 加入房间 =====
async function joinRoom() {
    const input = document.getElementById('input-room');
    const code = input.value.trim().toUpperCase();
    if (code.length !== 6) {
        alert('请输入 6 位房间号');
        return;
    }

    isHost = false;

    // 加入房间时，先尝试围棋前缀，失败再试五子棋
    // 简化处理：让用户在首页选好模式再加入
    rebuildGameObjects();

    try {
        await net.joinRoom(code, currentGameMode);
        startGame(code);
    } catch (err) {
        // 如果当前模式连接失败，尝试另一种模式
        const altMode = currentGameMode === 'go' ? 'gomoku' : 'go';
        try {
            currentGameMode = altMode;
            rebuildGameObjects();
            await net.joinRoom(code, currentGameMode);
            startGame(code);
        } catch (err2) {
            alert('加入房间失败：房间不存在或已关闭');
        }
    }
}

// ===== 开始游戏 =====
function startGame(roomCode) {
    const myColor = isHost ? BLACK : WHITE;
    const assistant = true;

    game.start(myColor, assistant);
    ai.enable(assistant);

    // 显示/隐藏 AI 面板
    document.getElementById('ai-panel').hidden = !assistant;

    // 围棋模式 UI 调整
    const isGo = currentGameMode === 'go';
    document.getElementById('btn-pass').hidden = !isGo;
    document.getElementById('btn-draw').hidden = isGo; // 围棋无和棋
    document.getElementById('go-captures-section').hidden = !isGo;

    // 更新房间名
    document.getElementById('game-room-name').textContent = '房间 ' + stripAssistant(roomCode);

    showPage('page-game');

    if (game.isMyTurn()) {
        triggerAI();
    }
}

// ===== 处理网络消息 =====
function handleNetMessage(data) {
    switch (data.type) {
        case 'MOVE':
            game.receiveMove(data.x, data.y, data.color);
            updateMoveHistory();
            updateGoCaptures();
            triggerAI();
            break;

        case 'PASS':
            game.receivePass(data.color);
            updateMoveHistory();
            triggerAI();
            break;

        case 'UNDO_REQUEST':
            showDialog('dialog-overlay', '对手申请悔棋，是否同意？');
            break;

        case 'UNDO_RESPONSE':
            if (data.accept) {
                game.handleUndoRequest();
                updateMoveHistory();
                updateGoCaptures();
            } else {
                alert('对手拒绝了你的悔棋申请');
            }
            break;

        case 'DRAW_REQUEST':
            showDialog('dialog-overlay', '对手申请和棋，是否同意？');
            break;

        case 'DRAW_RESPONSE':
            if (data.accept) {
                game.isOver = true;
                handleDraw();
            } else {
                alert('对手拒绝了你的和棋申请');
            }
            break;

        case 'RESTART':
            game.restart();
            break;
    }
}

// ===== 对话框响应 =====
let dialogType = '';

function showDialog(overlayId, message) {
    document.getElementById('dialog-message').textContent = message;
    document.getElementById(overlayId).hidden = false;
    dialogType = overlayId;
}

function hideDialog(overlayId) {
    document.getElementById(overlayId).hidden = true;
}

function handleDialogResponse(accept) {
    if (dialogType === 'dialog-overlay') {
        const msg = document.getElementById('dialog-message').textContent;
        if (msg.includes('悔棋')) {
            net.send({ type: 'UNDO_RESPONSE', accept });
            if (accept) {
                game.handleUndoRequest();
                updateMoveHistory();
                updateGoCaptures();
            }
        } else if (msg.includes('和棋')) {
            net.send({ type: 'DRAW_RESPONSE', accept });
            if (accept) {
                game.isOver = true;
                handleDraw();
            }
        }
    }
    hideDialog(dialogType);
}

// ===== 胜负处理 =====
function handleWin(color) {
    const isMe = color === game.myColor;
    const msg = isMe ? '你赢了！' : '你输了...';
    document.getElementById('result-message').textContent = msg;
    document.getElementById('score-detail').hidden = true;
    document.getElementById('result-overlay').hidden = false;
}

function handleDraw() {
    document.getElementById('result-message').textContent = '和棋！';
    document.getElementById('score-detail').hidden = true;
    document.getElementById('result-overlay').hidden = false;
}

// ===== 围棋终局计分 =====
function handleGameEnd(score) {
    const winnerText = score.winner === BLACK ? '黑方胜' : '白方胜';
    document.getElementById('result-message').textContent = winnerText;

    // 显示计分详情
    const scoreDetail = document.getElementById('score-detail');
    scoreDetail.innerHTML = `
        <div class="score-row"><span>黑方棋子</span><span>${score.blackStones}</span></div>
        <div class="score-row"><span>黑方领地</span><span>${score.blackTerritory}</span></div>
        <div class="score-row"><span>黑方总分</span><span>${score.blackScore}</span></div>
        <div class="score-row"><span>白方棋子</span><span>${score.whiteStones}</span></div>
        <div class="score-row"><span>白方领地</span><span>${score.whiteTerritory}</span></div>
        <div class="score-row"><span>白方贴目</span><span>7.5</span></div>
        <div class="score-row"><span>白方总分</span><span>${score.whiteScore}</span></div>
        <div class="score-winner">${winnerText}（差 ${Math.abs(score.blackScore - score.whiteScore).toFixed(1)} 目）</div>
    `;
    scoreDetail.hidden = false;

    document.getElementById('result-overlay').hidden = false;
}

function handleDisconnect() {
    document.getElementById('game-conn-status').textContent = '已断开';
    document.getElementById('game-conn-status').style.color = '#E74C3C';
    alert('对手已断开连接');
}

function handleError(err) {
    console.error('Network error:', err);
}

// ===== 更新走子历史 =====
function updateMoveHistory() {
    document.getElementById('move-history').textContent = game.getMoveHistoryText();
}

// ===== 更新围棋提子数 =====
function updateGoCaptures() {
    if (currentGameMode !== 'go') return;
    const capturesEl = document.getElementById('go-captures');
    if (capturesEl) {
        capturesEl.textContent = `黑 ${game.captures[BLACK]} / 白 ${game.captures[WHITE]}`;
    }
}

// ===== 触发 AI 分析 =====
function triggerAI() {
    if (ai.enabled && game.isMyTurn()) {
        ai.analyze(board.cells, game.myColor, game.moveHistory.length, game.captures);
    }
}

// ===== 作弊码处理 =====
function handleCheatCode(e) {
    const key = e.key.toLowerCase();

    if (key !== cheatSequence[currentCheatIndex].toLowerCase()) {
        if (key === cheatSequence[0].toLowerCase()) {
            currentCheatIndex = 1;
        } else {
            currentCheatIndex = 0;
        }
        return;
    }

    currentCheatIndex++;

    if (currentCheatIndex === cheatSequence.length) {
        activateCheatMode();
        currentCheatIndex = 0;
    }
}

function activateCheatMode() {
    cheatModeEnabled = true;
    ai.setCheatMode(true);

    // 微妙提示：闪烁AI面板标题
    const aiTitle = document.querySelector('#ai-panel .sidebar-title');
    if (aiTitle) {
        let blinkCount = 0;
        const originalColor = aiTitle.style.color || '';
        const blinkInterval = setInterval(() => {
            aiTitle.style.color = blinkCount % 2 === 0 ? '#E74C3C' : originalColor;
            blinkCount++;
            if (blinkCount > 5) {
                clearInterval(blinkInterval);
                aiTitle.style.color = originalColor;
            }
        }, 200);
    }

    if (ai.enabled && game.isMyTurn()) {
        triggerAI();
    }
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
