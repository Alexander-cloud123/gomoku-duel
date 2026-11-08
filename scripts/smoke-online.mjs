// scripts/smoke-online.mjs - 两个真实浏览器页面通过 PeerJS 建房的联机冒烟
// 前置：本地开发服务器 + 带 --remote-debugging-port 的无头 Chromium。
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/';

const problems = [];

function logPass(message) {
    console.log(`✔ ${message}`);
}

function logFail(message, detail) {
    problems.push(message);
    console.error(`✖ ${message}${detail ? `：${detail}` : ''}`);
}

function assert(condition, message, detail) {
    if (condition) logPass(message);
    else logFail(message, detail);
}

async function newTarget(url) {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`创建页面失败: ${response.status}`);
    return response.json();
}

async function attach(target) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('无法连接 CDP'));
    });

    let nextId = 1;
    const pending = new Map();
    const exceptions = [];

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
            return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
            exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        }
    };

    function send(method, params = {}) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP 超时: ${method}`));
            }, 25000);
            pending.set(id, (message) => {
                clearTimeout(timer);
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result);
            });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }

    await send('Runtime.enable');
    await send('Page.enable');

    return {
        socket,
        send,
        evaluate,
        exceptions,
        async close() {
            socket.close();
        }
    };
}

async function poll(session, expression, timeoutMs, label) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await session.evaluate(expression)) return true;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    logFail(`等待超时：${label}`);
    return false;
}

async function clickCell(session, offsetCells = 0) {
    await session.evaluate(`(() => {
        const c = document.getElementById('board');
        const r = c.getBoundingClientRect();
        const cell = r.width / 15.8;
        const ev = new PointerEvent('pointerdown', {
            clientX: r.left + r.width / 2 + cell * ${offsetCells},
            clientY: r.top + r.height / 2,
            bubbles: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        });
        c.dispatchEvent(ev);
        return true;
    })()`);
}

async function main() {
    const hostTarget = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json())
        .find((t) => t.type === 'page');
    if (!hostTarget) throw new Error('没有可用的页面 target');

    const host = await attach(hostTarget);
    const guest = await attach(await newTarget(APP_URL));

    await host.send('Page.navigate', { url: APP_URL });
    await poll(host, 'document.readyState === "complete" && document.querySelector("#page-home.active")', 10000, '房主首页');
    await guest.send('Page.navigate', { url: APP_URL });
    await poll(guest, 'document.readyState === "complete" && document.querySelector("#page-home.active")', 10000, '访客首页');

    // 房主创建房间
    await host.evaluate('document.getElementById("btn-host").click()');
    await poll(host, 'document.getElementById("page-waiting").classList.contains("active")', 20000, '房主进入等待页');
    const roomCode = await host.evaluate('document.getElementById("room-code").textContent.trim()');
    assert(/^[A-Z2-9]{6}$/.test(roomCode), '房主生成 6 位房间号', roomCode);

    // 访客加入
    await guest.evaluate(`(() => {
        const input = document.getElementById('input-room');
        input.value = ${JSON.stringify(roomCode)};
        document.getElementById('btn-join-confirm').click();
        return true;
    })()`);

    await poll(guest, 'document.getElementById("page-game").classList.contains("active")', 25000, '访客进入对局');
    await poll(host, 'document.getElementById("page-game").classList.contains("active")', 25000, '房主进入对局');
    await poll(host, 'document.getElementById("conn-status").textContent.indexOf("已连接") >= 0', 15000, '房主连接状态');
    assert(await guest.evaluate('document.getElementById("conn-status").textContent.indexOf("已连接") >= 0'), '访客显示已连接');

    // 双方颜色
    assert(await host.evaluate('document.getElementById("info-role").textContent.indexOf("黑") >= 0'), '房主执黑');
    assert(await guest.evaluate('document.getElementById("info-role").textContent.indexOf("白") >= 0'), '访客执白');

    // 房主落子 -> 访客收到
    await clickCell(host, 0);
    await poll(guest, 'document.getElementById("move-history").children.length === 1', 15000, '访客收到落子');
    assert(await guest.evaluate('document.getElementById("move-history").children.length === 1'), '访客同步到房主落子');

    // 访客落子 -> 房主收到
    await clickCell(guest, 1);
    await poll(host, 'document.getElementById("move-history").children.length === 2', 15000, '房主收到落子');
    assert(await host.evaluate('document.getElementById("move-history").children.length === 2'), '房主同步到访客落子');

    // 悔棋：房主申请 -> 访客同意 -> 双端回退
    await host.evaluate('document.getElementById("btn-undo").click()');
    await poll(host, 'document.getElementById("modal-root").hidden === true', 2000, '悔棋请求不阻塞本地');
    await poll(guest, 'document.getElementById("modal-root").hidden === false', 10000, '访客收到悔棋请求');
    assert(await guest.evaluate('document.getElementById("modal-title").textContent.indexOf("悔棋") >= 0'), '访客看到悔棋确认框');
    await guest.evaluate('document.querySelectorAll("#modal-actions button")[1].click()');
    await poll(host, 'document.getElementById("move-history").children.length === 0', 10000, '房主悔棋生效');
    assert(await guest.evaluate('document.getElementById("move-history").children.length === 0'), '访客同步悔棋');

    // 认输同步
    await guest.evaluate('document.getElementById("btn-resign").click()');
    await poll(guest, 'document.getElementById("modal-root").hidden === false', 5000, '访客认输确认框');
    await guest.evaluate('document.querySelectorAll("#modal-actions button")[1].click()');
    await poll(host, 'document.getElementById("modal-root").hidden === false', 10000, '房主收到终局');
    assert(await host.evaluate('document.getElementById("modal-title").textContent.indexOf("赢") >= 0'), '房主收到胜局结果');

    if (host.exceptions.length || guest.exceptions.length) {
        logFail('联机过程中出现未捕获异常', [...host.exceptions, ...guest.exceptions].join(' | '));
    } else {
        logPass('联机过程无未捕获异常');
    }

    await host.close();
    await guest.close();
    console.log(`\n联机冒烟结果：${problems.length === 0 ? '全部通过' : `${problems.length} 项失败`}`);
    if (problems.length > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
