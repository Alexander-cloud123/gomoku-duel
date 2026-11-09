// scripts/smoke-e2e.mjs - 通过 Chrome DevTools Protocol 做真实浏览器冒烟测试
// 前置：本地开发服务器与带 --remote-debugging-port 的无头 Chromium 已启动。
// 用法：node scripts/smoke-e2e.mjs
// 可选：SMOKE_SHOT_DIR=docs/assets，会在首页与对局两个状态各保存一张截图
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const SHOT_DIR = process.env.SMOKE_SHOT_DIR || '';

const problems = [];
const passes = [];

function pass(message) {
    passes.push(message);
    console.log(`✔ ${message}`);
}

function fail(message, detail) {
    problems.push(`${message}${detail ? `：${detail}` : ''}`);
    console.error(`✖ ${message}${detail ? `：${detail}` : ''}`);
}

function assert(condition, message, detail) {
    if (condition) pass(message);
    else fail(message, detail);
}

async function getTargets() {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return response.json();
}

async function main() {
    let target = (await getTargets()).find((t) => t.type === 'page');
    if (!target) {
        const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
        target = await response.json();
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('无法连接 CDP'));
    });

    let nextId = 1;
    const pending = new Map();
    const consoleErrors = [];
    const exceptions = [];

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
            return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
            const details = message.params.exceptionDetails;
            exceptions.push(details.exception?.description || details.text);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            consoleErrors.push(message.params.args.map((a) => a.value || a.description || '').join(' '));
        }
        if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
            consoleErrors.push(message.params.entry.text);
        }
    };

    function send(method, params = {}) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP 超时: ${method}`));
            }, 20000);
            pending.set(id, (message) => {
                clearTimeout(timer);
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result);
            });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (result.exceptionDetails) {
            throw new Error(`页面异常: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''}`);
        }
        return result.result.value;
    }

    async function poll(expression, timeoutMs = 8000, label = '条件') {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (await evaluate(expression)) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        fail(`等待超时：${label}`);
        return false;
    }

    async function screenshot(name) {
        if (!SHOT_DIR) return;
        const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 90 });
        await fs.mkdir(SHOT_DIR, { recursive: true });
        const file = path.join(SHOT_DIR, `${name}.webp`);
        await fs.writeFile(file, Buffer.from(data, 'base64'));
        pass(`截图已保存：${file}`);
    }

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    // 固定视口，保证冒烟与截图在不同机器上一致
    await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
    });

    // ===== 首页 =====
    await send('Page.navigate', { url: APP_URL });
    await poll('document.readyState === "complete"', 10000, '首页加载');
    await poll('document.querySelector("#page-home").classList.contains("active")', 5000, '首页显示');

    assert(await evaluate('document.querySelectorAll(".page.active").length === 1'), '同一时间只有一个页面处于激活状态');
    assert(await evaluate('document.getElementById("stats-text").textContent.length > 0'), '战绩文案已初始化');
    assert(await evaluate('getComputedStyle(document.getElementById("page-home")).display !== "none"'), '首页可见');
    await screenshot('home');

    // 模式切换
    await evaluate('document.getElementById("btn-mode-go").click()');
    assert(await evaluate('document.getElementById("btn-mode-go").classList.contains("active")'), '切换到围棋模式');
    assert(await evaluate('document.getElementById("go-only-settings").hidden === false'), '围棋专属设置显示');
    await evaluate('document.getElementById("btn-mode-gomoku").click()');
    assert(await evaluate('document.getElementById("go-only-settings").hidden === true'), '切回五子棋隐藏围棋设置');

    // ===== 人机（围棋） =====
    await evaluate('document.getElementById("btn-mode-go").click()');
    await evaluate('document.getElementById("tab-local").click()');
    await evaluate('document.getElementById("select-difficulty").value = "medium"; document.getElementById("select-difficulty").dispatchEvent(new Event("change"))');
    await evaluate('document.getElementById("btn-start-local").click()');
    await poll('document.getElementById("page-game").classList.contains("active")', 5000, '进入围棋对局');
    assert(await evaluate('document.activeElement && document.getElementById("page-game").contains(document.activeElement)'), '切页后焦点进入对局页');
    await poll('document.getElementById("board").getBoundingClientRect().width > 300', 5000, '棋盘尺寸计算');
    await poll(`(() => {
        const c = document.getElementById('board');
        const r = c.getBoundingClientRect();
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        return c.width === Math.round(r.width * dpr) && c.width === c.height && c.width > 300;
    })()`, 5000, 'Canvas 后备缓冲');
    const canvasMetrics = await evaluate(`(() => {
        const c = document.getElementById('board');
        const r = c.getBoundingClientRect();
        return { width: c.width, height: c.height, cssWidth: r.width, cssHeight: r.height, dpr: Math.min(3, window.devicePixelRatio || 1) };
    })()`);
    assert(canvasMetrics.width === Math.round(canvasMetrics.cssWidth * canvasMetrics.dpr) &&
        canvasMetrics.width === canvasMetrics.height &&
        canvasMetrics.width > 300, 'Canvas 后备缓冲与 DPR / 尺寸一致', JSON.stringify(canvasMetrics));
    assert(await evaluate('document.getElementById("move-history").children.length === 0'), '对局初始无走子记录');

    const clickCenter = `(() => {
        const c = document.getElementById('board');
        const r = c.getBoundingClientRect();
        const ev = new PointerEvent('pointerdown', {
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            bubbles: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        });
        c.dispatchEvent(ev);
        return true;
    })()`;
    await evaluate(clickCenter);
    await poll('document.getElementById("move-history").children.length === 1', 3000, '用户落子');
    await poll('document.getElementById("move-history").children.length >= 2', 8000, 'AI 落子');
    assert(await evaluate('document.getElementById("move-history").children.length >= 2'), '围棋人机 AI 已出招');
    await poll('document.getElementById("turn-indicator").textContent.indexOf("轮到你") >= 0', 8000, '回合回到玩家');
    await poll('document.getElementById("thinking-indicator").hidden === true', 5000, '思考提示收起');

    await poll('document.getElementById("ai-recommend").textContent !== "--"', 8000, 'AI 辅助推荐');
    assert(await evaluate('document.getElementById("ai-recommend").textContent !== "--"'), 'AI 辅助面板给出推荐点');
    await screenshot('game');

    // ===== 人机（五子棋） =====
    await evaluate('document.getElementById("btn-back-home").click()');
    await poll('document.getElementById("page-home").classList.contains("active")', 5000, '返回首页');
    assert(await evaluate('document.querySelector("#page-home .page-focus") === document.activeElement'), '返回首页后焦点落在页面标题');
    await evaluate('document.getElementById("btn-mode-gomoku").click()');
    await evaluate('document.getElementById("btn-start-local").click()');
    await poll('document.getElementById("page-game").classList.contains("active")', 5000, '进入五子棋对局');
    await evaluate(clickCenter);
    await poll('document.getElementById("move-history").children.length >= 2', 8000, '五子棋 AI 落子');
    assert(await evaluate('document.getElementById("info-mode").textContent.indexOf("15") >= 0'), '五子棋棋盘为 15 路');

    // ===== 深链 =====
    await send('Page.navigate', { url: `${APP_URL}?room=ABCDEF&mode=gomoku` });
    await poll('document.readyState === "complete"', 10000, '深链加载');
    await poll('document.getElementById("page-join").classList.contains("active")', 5000, '深链进入加入页');
    assert(await evaluate('document.getElementById("input-room").value === "ABCDEF"'), '深链自动填充房间号');

    // ===== 汇总 =====
    const noisy = consoleErrors.filter((text) => text && !text.includes('favicon'));
    if (exceptions.length > 0) fail('页面出现未捕获异常', exceptions.join(' | '));
    else pass('页面无未捕获异常');
    if (noisy.length > 0) fail('控制台出现错误', noisy.slice(0, 4).join(' | '));
    else pass('控制台无错误输出');

    socket.close();
    console.log(`\n冒烟结果：${passes.length} 项通过，${problems.length} 项失败`);
    if (problems.length > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
