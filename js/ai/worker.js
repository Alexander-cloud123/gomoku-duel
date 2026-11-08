// js/ai/worker.js - AI Web Worker（模块 Worker）
import { search as searchGomoku } from './gomoku-engine.js';
import { search as searchGo } from './go-engine.js';

self.onmessage = (event) => {
    const request = event.data || {};
    const id = request.id;

    try {
        let result;
        if (request.mode === 'go') {
            result = searchGo(request.cells, request.myColor, request.options || {});
        } else {
            result = searchGomoku(request.cells, request.myColor, request.options || {});
        }
        self.postMessage({ id, ok: true, result });
    } catch (err) {
        self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
};
