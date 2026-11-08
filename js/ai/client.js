// js/ai/client.js - 主线程 AI 客户端：Worker 调度、请求去重、思考状态与主线程降级
export class AIClient {
    constructor(options = {}) {
        this.workerUrl = options.workerUrl || 'js/ai/worker.js';
        this.onThinking = options.onThinking || null;
        this.onResult = options.onResult || null;
        this.onError = options.onError || null;

        this.worker = null;
        this._id = 0;
        this._active = null;
        this._fallbackModules = null;

        this._initWorker();
    }

    _initWorker() {
        if (typeof Worker === 'undefined') return;
        try {
            this.worker = new Worker(this.workerUrl, { type: 'module' });
            this.worker.onmessage = (event) => this._onMessage(event.data);
            this.worker.onerror = (event) => {
                console.error('AI Worker error:', event.message || event);
                this.worker = null;
                if (this.onError) this.onError('推理线程异常，已切换到主线程');
            };
        } catch (err) {
            this.worker = null;
            if (this.onError) this.onError(err.message || '无法创建推理线程');
        }
    }

    get thinking() {
        return Boolean(this._active);
    }

    /**
     * 发起一次分析；新请求会取消旧请求（旧请求 resolve 为 null）。
     * @returns {Promise<object|null>}
     */
    analyze(request) {
        this.cancel();
        const id = ++this._id;

        return new Promise((resolve, reject) => {
            this._active = { id, resolve, reject };
            if (this.onThinking) this.onThinking(true);

            const payload = {
                id,
                mode: request.mode,
                cells: request.cells,
                myColor: request.myColor,
                captures: request.captures,
                komi: request.komi,
                koPoint: request.koPoint,
                options: request.options || {}
            };

            if (this.worker) {
                this.worker.postMessage(payload);
            } else {
                this._runFallback(payload);
            }
        });
    }

    cancel() {
        if (!this._active) return;
        const active = this._active;
        this._active = null;
        active.resolve(null);
        if (this.onThinking) this.onThinking(false);
    }

    _onMessage(data) {
        if (!data || !this._active || data.id !== this._active.id) return;
        const active = this._active;
        this._active = null;
        if (this.onThinking) this.onThinking(false);

        if (!data.ok) {
            active.reject(new Error(data.error || 'AI 计算失败'));
            return;
        }
        active.resolve(data.result);
        if (this.onResult) this.onResult(data.result);
    }

    async _runFallback(payload) {
        try {
            if (!this._fallbackModules) {
                const [gomoku, go] = await Promise.all([
                    import('./gomoku-engine.js'),
                    import('./go-engine.js')
                ]);
                this._fallbackModules = { gomoku: gomoku.search, go: go.search };
            }
            if (!this._active || this._active.id !== payload.id) return;

            const options = { ...(payload.options || {}) };
            if (options.timeBudgetMs === undefined) options.timeBudgetMs = 250;
            options.timeBudgetMs = Math.min(options.timeBudgetMs, 300);

            const result = payload.mode === 'go'
                ? this._fallbackModules.go(payload.cells, payload.myColor, {
                    ...options,
                    captures: payload.captures,
                    komi: payload.komi,
                    koPoint: payload.koPoint
                })
                : this._fallbackModules.gomoku(payload.cells, payload.myColor, options);

            if (!this._active || this._active.id !== payload.id) return;
            const active = this._active;
            this._active = null;
            if (this.onThinking) this.onThinking(false);
            active.resolve(result);
        } catch (err) {
            if (!this._active || this._active.id !== payload.id) return;
            const active = this._active;
            this._active = null;
            if (this.onThinking) this.onThinking(false);
            active.reject(err);
            if (this.onError) this.onError(err.message || 'AI 计算失败');
        }
    }

    destroy() {
        this.cancel();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
