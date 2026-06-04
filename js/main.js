// main.js - 入口：初始化、状态切换、事件绑定

import { Board, BLACK, WHITE, SIZE } from './board.js';
import { Game } from './game.js';
import { GameNet } from './webrtc.js';
import { AIAssistant, updateAIPanel } from './ai.js';
import { generateRoomCode, hasAssistant, stripAssistant } from './room.js';

// ===== 全局状态 =====
let board, game, net, ai;
let currentRoomCode = '';
let isHost = false;

// ===== 初始化 =====
function init() {
    board = new Board(document.getElementById('board'));
    game = new Game(board);
    net = new GameNet();
    ai = new AIAssistant();

    // 棋盘点击
    board.onCellClick = (x, y) => {
        if (!game.isMyTurn()) return;
        if (game.placeStone(x, y)) {
            updateMoveHistory();
            triggerAI();
        }
    };

    // 游戏事件
    game.onWin = (color) => handleWin(color);
    game.onDraw = () => handleDraw();
    game.onMoveSent = (msg) => net.send(msg);
    game.onUndoRequest = (msg) => net.send(msg);
    game.onDrawRequest = (msg) => net.send(msg);

    // 网络事件
    net.onMessage = (data) => handleNetMessage(data);
    net.onDisconnected = () => handleDisconnect();
    net.onError = (err) => handleError(err);

    // AI 事件
    ai.onResult = (result) => {
        updateAIPanel(result, game.myColor);
        // 在棋盘上显示 AI 提示
        board.setAiHints({
            recommend: result.bestMove,
            threats: result.threats
        });
    };

    // 按钮绑定
    bindButtons();
}

// ===== 页面切换 =====
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
}

// ===== 按钮绑定 =====
function bindButtons() {
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

// ===== 创建房间 =====
async function createRoom() {
    const code = generateRoomCode();
    currentRoomCode = code + '*'; // 带 * 表示有辅助权限
    isHost = true;

    document.getElementById('room-code').textContent = code;

    try {
        await net.createRoom(code);
        showPage('page-waiting');
    } catch (err) {
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
        // fallback
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

    try {
        await net.joinRoom(code);
        // 加入成功，开始游戏
        startGame(code);
    } catch (err) {
        alert('加入房间失败：房间不存在或已关闭');
    }
}

// ===== 开始游戏 =====
function startGame(roomCode) {
    const assistant = hasAssistant(roomCode) || isHost;
    const myColor = isHost ? BLACK : WHITE;

    game.start(myColor, assistant);
    ai.enable(assistant);

    // 显示/隐藏 AI 面板
    document.getElementById('ai-panel').hidden = !assistant;

    // 更新房间名
    document.getElementById('game-room-name').textContent = '房间 ' + stripAssistant(roomCode);

    showPage('page-game');

    // 如果是房主且轮到自己，触发 AI
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
            triggerAI();
            break;

        case 'UNDO_REQUEST':
            showDialog('dialog-overlay', '对手申请悔棋，是否同意？');
            break;

        case 'UNDO_RESPONSE':
            if (data.accept) {
                game.handleUndoRequest();
                updateMoveHistory();
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
        // 判断是悔棋还是和棋
        const msg = document.getElementById('dialog-message').textContent;
        if (msg.includes('悔棋')) {
            net.send({ type: 'UNDO_RESPONSE', accept });
            if (accept) {
                game.handleUndoRequest();
                updateMoveHistory();
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
    document.getElementById('result-overlay').hidden = false;
}

function handleDraw() {
    document.getElementById('result-message').textContent = '和棋！';
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

// ===== 触发 AI 分析 =====
function triggerAI() {
    if (ai.enabled && game.isMyTurn()) {
        ai.analyze(board.cells, game.myColor, game.moveHistory.length);
    }
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
