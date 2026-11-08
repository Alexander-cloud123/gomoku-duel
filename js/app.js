// js/app.js - 应用控制器：页面流转、对局装配、联机/PvE 调度与 UI 同步
import { Game, PHASES } from './game.js';
import { BoardView } from './board.js';
import { Session } from './net/session.js';
import { Transport } from './net/webrtc.js';
import { AIClient } from './ai/client.js';
import {
    BLACK,
    WHITE,
    MODES,
    DEFAULT_KOMI,
    formatCoord,
    colorName
} from './rules/constants.js';
import { generateRoomCode, stripAssistant } from './room.js';
import { showPage, PAGES } from './ui/pages.js';
import { showToast } from './ui/toast.js';
import { Dialog } from './ui/dialog.js';
import { loadProfile, saveProfile, recordResult, formatStats } from './ui/stats.js';

const app = {
    profile: null,
    mode: MODES.GOMOKU,
    playMode: 'online',
    game: null,
    board: null,
    session: null,
    ai: null,
    dialog: null,
    aiThinking: false,
    localThinking: false,
    localAiColor: WHITE,
    hintTimer: null,
    localTimer: null,
    recorded: false,
    resultShown: false,
    audioContext: null,
    roomCode: '',
    lastAIRequest: 0
};

function $(id) {
    return document.getElementById(id);
}

function selectedSize() {
    return app.mode === MODES.GO ? Number(app.profile.goSize) : 15;
}

function selectedSettings() {
    if (app.mode === MODES.GO) {
        return {
            komi: Number(app.profile.komi) || DEFAULT_KOMI[selectedSize()] || 7.5,
            assist: app.profile.assist,
            undoLimit: 3
        };
    }
    return { assist: app.profile.assist, undoLimit: 3 };
}

// ===== 初始化 =====

export function initApp() {
    app.profile = loadProfile();
    app.dialog = new Dialog();
    app.ai = new AIClient({
        onThinking: (thinking) => {
            app.aiThinking = thinking;
            updateThinkingUI();
        },
        onError: (message) => showToast(`AI 不可用：${message}`, 'warning')
    });

    fillControls();
    bindEvents();
    applyModeUI();
    updateHomeStats();
    handleDeepLink();

    window.addEventListener('beforeunload', () => {
        if (app.session) app.session.destroy();
    });
}

function fillControls() {
    $('select-go-size').value = String(app.profile.goSize);
    $('select-komi').value = String(app.profile.komi);
    $('select-difficulty').value = app.profile.difficulty;
    $('toggle-assist').checked = Boolean(app.profile.assist);
    $('toggle-sound').checked = Boolean(app.profile.sound);
    $('input-name').value = app.profile.name || '玩家';
    setPlayTab(app.playMode);
}

function bindEvents() {
    $('btn-mode-gomoku').addEventListener('click', () => switchMode(MODES.GOMOKU));
    $('btn-mode-go').addEventListener('click', () => switchMode(MODES.GO));

    $('tab-online').addEventListener('click', () => setPlayTab('online'));
    $('tab-local').addEventListener('click', () => setPlayTab('local'));

    $('btn-host').addEventListener('click', hostRoom);
    $('btn-join').addEventListener('click', () => {
        showPage(PAGES.JOIN);
        $('input-room').focus();
    });
    $('btn-start-local').addEventListener('click', startLocal);

    $('btn-copy-code').addEventListener('click', () => copyText(app.roomCode, '房间号已复制'));
    $('btn-copy-link').addEventListener('click', () => {
        const mode = app.mode === MODES.GO ? 'go' : 'gomoku';
        const link = `${location.origin}${location.pathname}?room=${app.roomCode}&mode=${mode}`;
        copyText(link, '邀请链接已复制');
    });
    $('btn-cancel-wait').addEventListener('click', exitToHome);

    $('btn-join-confirm').addEventListener('click', () => joinRoom($('input-room').value));
    $('input-room').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') joinRoom($('input-room').value);
    });
    $('btn-cancel-join').addEventListener('click', () => showPage(PAGES.HOME));

    $('btn-undo').addEventListener('click', onUndo);
    $('btn-draw').addEventListener('click', onDraw);
    $('btn-pass').addEventListener('click', onPass);
    $('btn-resign').addEventListener('click', onResign);
    $('btn-confirm-score').addEventListener('click', onConfirmScore);
    $('btn-back-home').addEventListener('click', exitToHome);

    $('ai-toggle').addEventListener('change', (event) => {
        app.profile.assist = event.target.checked;
        saveProfile(app.profile);
        updateAIPanelVisibility();
        if (!app.profile.assist) {
            app.board?.setHints(null);
        } else {
            scheduleHints();
        }
    });

    $('toggle-assist').addEventListener('change', (event) => {
        app.profile.assist = event.target.checked;
        saveProfile(app.profile);
        updateAIPanelVisibility();
    });
    $('toggle-sound').addEventListener('change', (event) => {
        app.profile.sound = event.target.checked;
        saveProfile(app.profile);
    });

    $('select-go-size').addEventListener('change', (event) => {
        app.profile.goSize = Number(event.target.value);
        saveProfile(app.profile);
    });
    $('select-komi').addEventListener('change', (event) => {
        app.profile.komi = Number(event.target.value);
        saveProfile(app.profile);
    });
    $('select-difficulty').addEventListener('change', (event) => {
        app.profile.difficulty = event.target.value;
        saveProfile(app.profile);
    });
    $('input-name').addEventListener('change', (event) => {
        const value = event.target.value.trim().slice(0, 24);
        app.profile.name = value || '玩家';
        event.target.value = app.profile.name;
        saveProfile(app.profile);
    });
}

// ===== 首页与模式 =====

function switchMode(mode) {
    app.mode = mode;
    app.profile.mode = mode;
    saveProfile(app.profile);
    applyModeUI();
}

function applyModeUI() {
    $('btn-mode-gomoku').classList.toggle('active', app.mode === MODES.GOMOKU);
    $('btn-mode-go').classList.toggle('active', app.mode === MODES.GO);
    $('go-only-settings').hidden = app.mode !== MODES.GO;
    updateHomeStats();
}

function setPlayTab(playMode) {
    app.playMode = playMode;
    $('tab-online').classList.toggle('active', playMode === 'online');
    $('tab-local').classList.toggle('active', playMode === 'local');
    $('online-actions').hidden = playMode !== 'online';
    $('local-actions').hidden = playMode !== 'local';
}

function updateHomeStats() {
    $('stats-text').textContent = formatStats(app.profile, app.mode);
}

function handleDeepLink() {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (!room) return;
    const mode = params.get('mode');
    if (mode === 'go' || mode === 'gomoku') switchMode(mode);
    $('input-room').value = stripAssistant(room).toUpperCase();
    showPage(PAGES.JOIN);
}

// ===== 对局装配 =====

function createGameEvents() {
    return {
        onChange: (snapshot, meta) => onGameChange(snapshot, meta),
        onGameOver: (result, snapshot) => onGameOver(result, snapshot)
    };
}

function setupMatch({ mode, size, settings, myColor }) {
    if (app.game) app.game.events = {};
    if (app.board) {
        app.board.dispose();
        app.board = null;
    }
    clearTimeout(app.hintTimer);
    clearTimeout(app.localTimer);
    app.hintTimer = null;
    app.localTimer = null;
    app.aiThinking = false;
    app.localThinking = false;
    app.recorded = false;
    app.resultShown = false;

    app.game = new Game({ mode, size, settings, events: createGameEvents() });
    app.game.start({ myColor });

    const canvas = $('board');
    app.board = new BoardView(canvas, { size, mode });
    app.board.onMove = onBoardMove;
    app.board.onDeadClick = onDeadClick;
    app.board.setHoverColor(myColor);
    app.board.setState(app.game.snapshot());

    $('ai-toggle').checked = Boolean(app.profile.assist);
    updateAIPanelVisibility();
    updateGameChrome();
    updateGameUI(app.game.snapshot());
    return app.game;
}

// ===== 人机 =====

function startLocal() {
    app.playMode = 'local';
    app.mode = app.mode || MODES.GOMOKU;
    teardownSession();
    setupMatch({
        mode: app.mode,
        size: selectedSize(),
        settings: selectedSettings(),
        myColor: BLACK
    });
    app.localAiColor = WHITE;
    app.roomCode = '';
    updateGameChrome();
    showPage(PAGES.GAME);
    showToast(`人机对战 · 难度：${difficultyLabel(app.profile.difficulty)}`, 'info');
    scheduleHints();
    updateGameUI(app.game.snapshot());
}

function difficultyLabel(level) {
    return { easy: '入门', medium: '进阶', hard: '高手' }[level] || '进阶';
}

function scheduleLocalAI() {
    if (app.playMode !== 'local' || !app.game) return;
    if (app.game.phase !== PHASES.PLAYING || app.game.isOver) return;
    if (app.game.turn !== app.localAiColor) return;
    if (app.localThinking) return;

    const currentGame = app.game;
    app.localThinking = true;
    updateThinkingUI();
    app.board?.setHints(null);

    const delay = 120 + Math.floor(Math.random() * 200);
    app.localTimer = setTimeout(async () => {
        if (currentGame.phase !== PHASES.PLAYING || currentGame.isOver) {
            app.localThinking = false;
            updateThinkingUI();
            return;
        }
        const result = await app.ai.analyze({
            mode: currentGame.mode,
            cells: currentGame.cells,
            myColor: app.localAiColor,
            captures: currentGame.captures,
            komi: currentGame.settings.komi,
            koPoint: currentGame.koPoint,
            options: { level: app.profile.difficulty }
        });

        app.localThinking = false;
        updateThinkingUI();

        if (!result || currentGame !== app.game || currentGame.isOver) return;
        if (currentGame.turn !== app.localAiColor) return;

        if (result.pass && currentGame.mode === MODES.GO) {
            currentGame.pass(app.localAiColor);
            return;
        }

        if (result.bestMove) {
            const outcome = currentGame.applyMove(app.localAiColor, result.bestMove.x, result.bestMove.y);
            if (outcome.ok) return;
        }
        playFallbackMove(currentGame, app.localAiColor);
    }, delay);
}

function playFallbackMove(game, color) {
    const size = game.size;
    const empties = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!game.cells[y][x]) empties.push({ x, y });
        }
    }
    for (let i = empties.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [empties[i], empties[j]] = [empties[j], empties[i]];
    }
    for (const move of empties) {
        if (game.applyMove(color, move.x, move.y).ok) return;
    }
}

// ===== 联机 =====

function sessionCallbacks() {
    return {
        onStatus: (status) => updateConnectionUI(status),
        onReady: ({ reconnecting }) => {
            showPage(PAGES.GAME);
            updateGameChrome();
            if (reconnecting) {
                showToast('已重新连接对手', 'success');
            }
            scheduleHints();
            updateGameUI(app.game?.snapshot());
        },
        onReject: (info) => handleReject(info),
        onNotice: ({ kind, message }) => showToast(message, kind === 'warning' ? 'warning' : kind === 'error' ? 'error' : 'info'),
        onRequest: (request, respond) => {
            app.dialog.show({
                title: request.kind === 'undo' ? '悔棋请求' : request.kind === 'draw' ? '和棋请求' : '再来一局',
                message: request.message,
                timeoutMs: 30000,
                timeoutValue: false,
                actions: [
                    { label: '拒绝', value: false },
                    { label: '同意', value: true, primary: true }
                ]
            }).then((answer) => respond(Boolean(answer)));
        },
        onPeerLeft: ({ message }) => {
            updateConnectionUI({ state: 'left', message });
            app.board?.setInteractive(false);
            app.dialog.show({
                title: '连接已断开',
                message: message || '对手已离开房间',
                actions: [{ label: '返回首页', value: 'home', primary: true }]
            }).then(() => exitToHome());
        },
        onRemoteSettings: (settings) => {
            app.mode = settings.mode;
            app.profile.goSize = settings.size;
            app.profile.komi = settings.komi;
            app.profile.assist = settings.assist !== false;
            saveProfile(app.profile);
            fillControls();
            applyModeUI();
            return setupMatch({
                mode: settings.mode,
                size: settings.size,
                settings: {
                    komi: settings.komi,
                    assist: settings.assist,
                    undoLimit: settings.undoLimit
                },
                myColor: WHITE
            });
        },
        onError: (err) => showToast(err.message || '网络错误', 'error')
    };
}

function createSession(role) {
    const transport = new Transport();
    const session = new Session({
        transport,
        game: app.game,
        role,
        name: app.profile.name || '玩家',
        callbacks: sessionCallbacks()
    });
    return session;
}

async function hostRoom() {
    app.playMode = 'online';
    app.roomCode = generateRoomCode();
    teardownSession();
    setupMatch({
        mode: app.mode,
        size: selectedSize(),
        settings: selectedSettings(),
        myColor: BLACK
    });
    app.session = createSession('host');

    $('room-code').textContent = app.roomCode;
    $('waiting-mode').textContent = app.mode === MODES.GO ? '围棋' : '五子棋';
    $('btn-copy-link').hidden = false;
    showPage(PAGES.WAITING);

    try {
        await app.session.hostRoom(app.roomCode);
    } catch (err) {
        showToast(err.message || '创建房间失败', 'error');
        teardownSession();
        showPage(PAGES.HOME);
    }
}

async function joinRoom(rawCode) {
    let code = stripAssistant(String(rawCode || '')).trim().toUpperCase();
    if (code.length !== 6) {
        showToast('请输入 6 位房间号', 'error');
        return;
    }
    code = code.replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) {
        showToast('房间号格式不正确', 'error');
        return;
    }

    app.roomCode = code;
    app.playMode = 'online';
    teardownSession();
    setupMatch({
        mode: app.mode,
        size: selectedSize(),
        settings: selectedSettings(),
        myColor: WHITE
    });
    app.session = createSession('guest');
    updateConnectionUI({ state: 'joining', message: '正在连接房间…' });

    try {
        await app.session.joinRoom(code);
    } catch (err) {
        showToast(err.message || '加入房间失败', 'error');
        teardownSession();
        showPage(PAGES.JOIN);
    }
}

function handleReject(info) {
    if (app.session?.role === 'host') {
        showToast(info.message || '房间连接被拒绝', 'error');
        teardownSession();
        showPage(PAGES.HOME);
        return;
    }
    if (info.code === 'MODE_MISMATCH' && info.actualMode) {
        const actual = info.actualMode === MODES.GO ? MODES.GO : MODES.GOMOKU;
        const label = actual === MODES.GO ? '围棋' : '五子棋';
        app.mode = actual;
        applyModeUI();
        showToast(`房间是${label}模式，正在切换并重新加入…`, 'info');
        const code = app.roomCode;
        setTimeout(() => {
            joinRoom(code);
        }, 300);
        return;
    }
    showToast(info.message || '连接被拒绝', 'error');
    teardownSession();
    showPage(PAGES.HOME);
}

function teardownSession() {
    if (app.session) {
        app.session.destroy();
        app.session = null;
    }
}

function updateConnectionUI(status) {
    const el = $('conn-status');
    if (!el) return;
    const map = {
        waiting: ['等待对手…', 'status-waiting'],
        joining: ['连接中…', 'status-waiting'],
        connected: ['已连接', 'status-ok'],
        reconnecting: ['连接中断，正在恢复…', 'status-warn'],
        left: ['已断开', 'status-bad'],
        failed: ['连接失败', 'status-bad']
    };
    const [text, cls] = map[status.state] || [status.message || '未知状态', 'status-waiting'];
    el.textContent = text;
    el.className = `conn-status ${cls}`;
    if (status.message && (status.state === 'reconnecting' || status.state === 'failed')) {
        showToast(status.message, status.state === 'failed' ? 'error' : 'warning');
    }
    if (status.state === 'reconnecting' || status.state === 'failed' || status.state === 'left') {
        app.board?.setInteractive(false);
    } else if (app.game) {
        updateGameUI(app.game.snapshot());
    }
}

// ===== 交互 =====

function onBoardMove(x, y) {
    if (!app.game || app.game.phase === PHASES.SCORING) return;

    if (app.playMode === 'local') {
        if (!app.game.canPlay(app.game.myColor)) {
            showToast('还没轮到你落子', 'info');
            return;
        }
        app.game.applyMove(app.game.myColor, x, y);
        return;
    }

    if (!app.session || !app.session.isReady) {
        showToast('尚未连接对手', 'warning');
        return;
    }
    const result = app.session.sendMove(x, y);
    if (!result.ok) {
        showToast(localizedReason(result.reason), 'warning');
    }
}

function onDeadClick(x, y) {
    if (!app.game || app.game.phase !== PHASES.SCORING) return;
    if (app.playMode === 'local') {
        app.game.toggleDead(x, y);
        return;
    }
    if (app.session && app.session.isReady) app.session.toggleDead(x, y);
}

function onUndo() {
    if (!app.game) return;
    if (app.playMode === 'local') {
        if (!app.game.canUndo(app.game.myColor)) {
            showToast('当前无法悔棋（次数已用完或尚未落子）', 'warning');
            return;
        }
        app.game.performUndo(app.game.myColor);
        showToast('已悔棋', 'info');
        return;
    }
    const result = app.session?.requestUndo();
    if (!result || !result.ok) {
        showToast(result?.reason === 'limit' ? '悔棋次数已用完' : '暂时无法发送悔棋请求', 'warning');
    } else {
        showToast('已发送悔棋请求，等待对手同意…', 'info');
    }
}

function onDraw() {
    if (!app.game) return;
    if (app.playMode === 'local') {
        app.game.finishDraw();
        return;
    }
    const result = app.session?.requestDraw();
    if (!result || !result.ok) showToast('暂时无法申请和棋', 'warning');
    else showToast('已发送和棋请求…', 'info');
}

function onPass() {
    if (!app.game || app.game.mode !== MODES.GO) return;
    if (app.playMode === 'local') {
        app.game.pass(app.game.myColor);
        return;
    }
    const result = app.session?.sendPass();
    if (!result || !result.ok) showToast(result?.reason === 'not-your-turn' ? '还没轮到你' : '无法虚手', 'warning');
}

async function onResign() {
    if (!app.game || app.game.isOver) return;
    const confirmed = await app.dialog.confirm({
        title: '认输',
        message: '确定要认输吗？本局将判对手胜。',
        confirmText: '认输',
        danger: true
    });
    if (!confirmed) return;

    if (app.playMode === 'local') {
        app.game.resign(app.game.myColor);
        return;
    }
    const result = app.session?.resign();
    if (!result || !result.ok) showToast('无法认输', 'warning');
}

function onConfirmScore() {
    if (!app.game || app.game.phase !== PHASES.SCORING) return;

    if (app.playMode === 'local') {
        const hash = app.game.scoreHash();
        app.game.agreeScore(app.game.myColor, hash);
        app.game.agreeScore(app.localAiColor, hash);
        return;
    }

    const result = app.session?.confirmScore();
    if (!result || !result.ok) {
        showToast(result?.reason === 'hash-mismatch' ? '计分不一致，正在重新同步…' : '无法确认', 'warning');
        app.session?.requestSync();
    } else if (!result.finished) {
        showToast('已确认，等待对手确认…', 'info');
    }
}

function localizedReason(reason) {
    const map = {
        'not-your-turn': '还没轮到你落子',
        occupied: '该位置已有棋子',
        'out-of-bounds': '落子位置越界',
        suicide: '自杀手不合法',
        ko: '打劫，此处暂不能落子',
        superko: '重复局面（超级劫），不合法',
        'not-playing': '对局已结束',
        'not-connected': '尚未连接对手',
        'not-go': '当前模式不支持虚手',
        limit: '悔棋次数已用完',
        cooldown: '操作太频繁，请稍后再试',
        busy: '已有待处理请求'
    };
    return map[reason] || '操作失败';
}

// ===== 状态渲染 =====

function onGameChange(snapshot, meta) {
    if (!snapshot) return;
    app.board?.setState({ ...snapshot });
    updateGameUI(snapshot);

    if (meta.type === 'move') {
        app.board?.setHints(null);
        playSound(520);
    }
    if (meta.type === 'restart' || meta.type === 'start') {
        app.dialog.close();
        app.resultShown = false;
    }
    if (meta.type === 'finished') {
        app.board?.setInteractive(false);
    }

    scheduleHints();
    scheduleLocalAI();
}

function updateGameUI(snapshot) {
    if (!snapshot || !app.game) return;
    const game = app.game;

    const indicator = $('turn-indicator');
    if (indicator) {
        if (game.phase === PHASES.SCORING) {
            indicator.textContent = '终局点目：标记死子后双方确认';
            indicator.className = 'turn-indicator scoring';
        } else if (game.isOver) {
            indicator.textContent = '对局结束';
            indicator.className = 'turn-indicator';
        } else if (game.phase === PHASES.PLAYING && game.turn === game.myColor) {
            indicator.textContent = game.mode === MODES.GO ? '轮到你落子（或虚手）' : '轮到你落子';
            indicator.className = 'turn-indicator my-turn';
        } else if (app.localThinking || app.aiThinking) {
            indicator.textContent = 'AI 思考中…';
            indicator.className = 'turn-indicator thinking';
        } else {
            indicator.textContent = app.playMode === 'local' ? '等待 AI 落子…' : '等待对手落子…';
            indicator.className = 'turn-indicator';
        }
    }

    const canInteract = game.phase === PHASES.SCORING
        ? true
        : game.canPlay(game.myColor) && (app.playMode === 'local' || Boolean(app.session?.isReady));
    app.board?.setInteractive(Boolean(canInteract));
    app.board?.setDeadMarking(game.phase === PHASES.SCORING);

    setButtonState('btn-undo', game.canUndo(game.myColor) && game.phase === PHASES.PLAYING);
    const drawEnabled = game.phase === PHASES.PLAYING && !game.isOver && game.mode === MODES.GOMOKU &&
        (app.playMode === 'local' || Boolean(app.session?.isReady));
    setButtonState('btn-draw', drawEnabled);
    setButtonState('btn-pass', game.mode === MODES.GO && game.canPlay(game.myColor));
    setButtonState('btn-resign', !game.isOver && game.phase !== PHASES.IDLE);
    $('btn-draw').hidden = game.mode === MODES.GO;
    $('btn-pass').hidden = game.mode !== MODES.GO;

    updateGameChrome();
    updateGoInfo(snapshot);
    renderMoveHistory(snapshot);
    updateScoringPanel(snapshot);
    updateThinkingUI();
}

function setButtonState(id, enabled) {
    const el = $(id);
    if (el) el.disabled = !enabled;
}

function updateGameChrome() {
    if (!app.game) return;
    const modeLabel = app.game.mode === MODES.GO ? '围棋' : '五子棋';
    const roleLabel = app.playMode === 'local'
        ? '人机对战'
        : app.roomCode ? `房间 ${app.roomCode}` : '联机对战';
    $('game-room-name').textContent = roleLabel;
    $('info-mode').textContent = `${modeLabel} · ${app.game.size} 路`;
    $('info-role').textContent = app.playMode === 'local' ? '你执黑' : `你执${colorName(app.game.myColor)}`;
}

function updateGoInfo(snapshot) {
    const wrap = $('go-info');
    if (!wrap) return;
    if (snapshot.mode !== MODES.GO) {
        wrap.hidden = true;
        return;
    }
    wrap.hidden = false;
    $('go-captures').textContent = `黑 ${snapshot.captures[BLACK]} / 白 ${snapshot.captures[WHITE]}`;
    $('go-komi').textContent = snapshot.settings.komi.toFixed(1);
}

function renderMoveHistory(snapshot) {
    const list = $('move-history');
    if (!list) return;
    list.innerHTML = '';
    snapshot.moveHistory.forEach((move, index) => {
        const item = document.createElement('span');
        item.className = 'move-item';
        const symbol = move.color === BLACK ? '●' : '○';
        const coord = move.pass ? 'Pass' : formatCoord(move.x, move.y, snapshot.size);
        item.textContent = `${index + 1}.${symbol}${coord}`;
        if (move.captured && move.captured.length > 0) {
            item.textContent += `×${move.captured.length}`;
            item.classList.add('capture');
        }
        list.appendChild(item);
    });
    list.scrollLeft = list.scrollWidth;
}

function updateScoringPanel(snapshot) {
    const panel = $('scoring-panel');
    if (!panel) return;
    if (snapshot.phase !== PHASES.SCORING) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    const score = app.game.getScore();
    $('score-summary').textContent =
        `黑 ${score.black.total.toFixed(1)}（子 ${score.black.stones} + 地 ${score.black.territory}） · ` +
        `白 ${score.white.total.toFixed(1)}（子 ${score.white.stones} + 地 ${score.white.territory} + 贴 ${score.komi}） · ` +
        `死子 ${score.deadRemoved} · ${score.marginText}`;
    const agreed = snapshot.agreed.length > 0;
    $('score-agree-state').textContent = agreed
        ? `已确认 ${snapshot.agreed.length}/2`
        : '双方确认后结束对局';
    setButtonState('btn-confirm-score', !snapshot.agreed.includes(app.game.myColor));
}

function updateAIPanelVisibility() {
    const panel = $('ai-panel');
    if (panel) panel.hidden = !app.profile.assist;
    $('ai-toggle').checked = Boolean(app.profile.assist);
}

function updateThinkingUI() {
    const thinking = app.localThinking || app.aiThinking;
    const el = $('thinking-indicator');
    if (el) el.hidden = !thinking;
    if (app.board) {
        // 思考时保持当前可交互状态，由 updateGameUI 控制
    }
}

function updateAIPanel(result) {
    if (!result) return;
    const recommend = $('ai-recommend');
    if (recommend) {
        recommend.textContent = result.bestMove
            ? formatCoord(result.bestMove.x, result.bestMove.y, app.game?.size ?? 15)
            : '--';
    }
    const fill = $('ai-winrate-fill');
    const text = $('ai-winrate-text');
    const rate = Math.max(1, Math.min(99, Math.round(result.winRate ?? 50)));
    if (fill) fill.style.width = `${rate}%`;
    if (text) text.textContent = `${rate}%`;

    const threat = $('ai-threat');
    if (threat) {
        const dangers = (result.threats || []).filter((t) => t.level === 'danger');
        const warnings = (result.threats || []).filter((t) => t.level === 'warning');
        if (dangers.length > 0) {
            threat.textContent = `紧急：对手有 ${dangers.length} 个致命威胁`;
            threat.className = 'ai-value ai-danger';
        } else if (warnings.length > 0) {
            threat.textContent = `注意：${warnings.length} 处威胁布局`;
            threat.className = 'ai-value ai-warning';
        } else {
            threat.textContent = '安全';
            threat.className = 'ai-value ai-safe';
        }
    }
    const status = $('ai-status');
    if (status && result.depth) {
        status.textContent = `深度 ${result.depth} · ${result.elapsedMs}ms`;
    }
}

function scheduleHints() {
    clearTimeout(app.hintTimer);
    const game = app.game;
    if (!game || !app.profile.assist || !app.board) return;
    if (!game.settings.assist) {
        app.board.setHints(null);
        return;
    }
    if (game.phase !== PHASES.PLAYING || game.isOver) {
        app.board.setHints(null);
        return;
    }
    if (game.turn !== game.myColor) {
        app.board.setHints(null);
        return;
    }
    if (app.playMode === 'online' && !app.session?.isReady) {
        app.board.setHints(null);
        return;
    }

    app.hintTimer = setTimeout(async () => {
        if (app.game !== game || game.turn !== game.myColor || game.phase !== PHASES.PLAYING) return;
        const result = await app.ai.analyze({
            mode: game.mode,
            cells: game.cells,
            myColor: game.myColor,
            captures: game.captures,
            komi: game.settings.komi,
            koPoint: game.koPoint,
            options: { level: 'hint' }
        });
        if (!result) return;
        if (app.game !== game || game.turn !== game.myColor || game.phase !== PHASES.PLAYING) return;
        app.board.setHints({
            recommend: result.bestMove,
            alternates: (result.alternates || []).slice(0, 2),
            threats: (result.threats || []).slice(0, 6)
        });
        updateAIPanel(result);
    }, 100);
}

// ===== 终局 =====

function onGameOver(result) {
    if (!app.game) return;
    if (app.resultShown) return;
    app.resultShown = true;
    app.board?.setHints(null);
    app.board?.setInteractive(false);
    clearTimeout(app.localTimer);

    if (!app.recorded) {
        app.recorded = true;
        let outcome = 'draw';
        if (result.winner === app.game.myColor) outcome = 'win';
        else if (result.winner !== null && result.winner !== undefined) outcome = 'loss';
        recordResult(app.profile, app.game.mode, outcome);
        updateHomeStats();
    }

    const isLocal = app.playMode === 'local';
    const title = result.winner === null
        ? '和棋'
        : result.winner === app.game.myColor ? '你赢了！' : '你输了…';
    const reasonMap = {
        five: '五连成线',
        resign: '对手认输' + (result.winner === app.game.myColor ? '' : ''),
        draw: '双方和棋',
        score: '数子定胜负',
        full: '棋盘已满',
        disconnect: '对手断开连接'
    };
    const reasonText = result.reason === 'resign'
        ? (result.winner === app.game.myColor ? '对手认输' : '你已认输')
        : reasonMap[result.reason] || '对局结束';

    let html = `<p class="result-reason">${reasonText}</p>`;
    if (result.score) {
        const s = result.score;
        html += `<div class="score-grid">
            <span>黑方</span><span>子 ${s.black.stones} + 地 ${s.black.territory} = ${s.black.total.toFixed(1)}</span>
            <span>白方</span><span>子 ${s.white.stones} + 地 ${s.white.territory} + 贴 ${s.komi} = ${s.white.total.toFixed(1)}</span>
            <span>结果</span><span>${s.marginText}</span>
        </div>`;
    }

    const actions = isLocal
        ? [{ label: '再来一局', value: 'restart', primary: true }, { label: '返回首页', value: 'home' }]
        : [{ label: '再来一局', value: 'restart', primary: true }, { label: '退出房间', value: 'home' }];

    playSound(result.winner === app.game.myColor ? 880 : 320);

    app.dialog.show({
        title,
        html,
        actions
    }).then((value) => {
        if (value === 'restart') {
            if (isLocal) {
                app.game.restart();
            } else {
                const outcome = app.session?.requestRestart();
                if (!outcome || !outcome.ok) {
                    showToast('无法发起再来一局请求', 'warning');
                } else {
                    showToast('已发送再来一局请求…', 'info');
                }
            }
        } else if (value === 'home') {
            exitToHome();
        }
    });
}

function exitToHome() {
    teardownSession();
    clearTimeout(app.hintTimer);
    clearTimeout(app.localTimer);
    resetAIPanel();
    if (app.board) {
        app.board.dispose();
        app.board = null;
    }
    if (app.game) app.game.events = {};
    app.game = null;
    app.resultShown = false;
    app.localThinking = false;
    app.aiThinking = false;
    updateThinkingUI();
    showPage(PAGES.HOME);
    updateHomeStats();
}

function resetAIPanel() {
    const recommend = $('ai-recommend');
    if (recommend) recommend.textContent = '--';
    const fill = $('ai-winrate-fill');
    if (fill) fill.style.width = '50%';
    const text = $('ai-winrate-text');
    if (text) text.textContent = '50%';
    const threat = $('ai-threat');
    if (threat) {
        threat.textContent = '安全';
        threat.className = 'ai-value ai-safe';
    }
    const status = $('ai-status');
    if (status) status.textContent = '';
}

// ===== 工具 =====

function copyText(text, successMessage) {
    if (!text) return;
    const done = () => showToast(successMessage, 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
        fallbackCopy(text, done);
    }
}

function fallbackCopy(text, done) {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        done();
    } catch {
        showToast('复制失败，请手动复制', 'error');
    }
    input.remove();
}

function playSound(frequency) {
    if (!app.profile.sound) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!app.audioContext) app.audioContext = new Ctx();
        const ctx = app.audioContext;
        if (ctx.state === 'suspended') ctx.resume();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.06;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        oscillator.stop(ctx.currentTime + 0.13);
    } catch {
        /* 音效失败不影响对局 */
    }
}

export { app, initApp as default };
