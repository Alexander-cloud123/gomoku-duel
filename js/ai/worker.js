// js/ai/worker.js - AI Web Worker（模块 Worker）
import { search as searchGomoku } from './gomoku-engine.js';
import { search as searchGo } from './go-engine.js';

self.onmessage = (event) => {
    const request = event.data || {};
    const id = request.id;

    try {
        let result;
        const options = { ...(request.options || {}) };
        if (request.mode === 'go') {
            options.komi = request.komi;
            options.koPoint = request.koPoint;
            options.historyKeys = request.historyKeys;
            result = searchGo(request.cells, request.myColor, options);
        } else {
            result = searchGomoku(request.cells, request.myColor, options);
        }
        self.postMessage({ id, ok: true, result });
    } catch (err) {
        self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
};
