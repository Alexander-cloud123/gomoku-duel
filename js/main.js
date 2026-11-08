// js/main.js - 模块入口
import { initApp } from './app.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
    initApp();
}
