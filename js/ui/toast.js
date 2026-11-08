// js/ui/toast.js - 轻量提示条
const KIND_CLASS = {
    info: 'toast-info',
    success: 'toast-success',
    warning: 'toast-warning',
    error: 'toast-error'
};

export function showToast(message, kind = 'info', duration = 3200) {
    const host = document.getElementById('toast-host');
    if (!host) return;

    const toast = document.createElement('div');
    toast.className = `toast ${KIND_CLASS[kind] || KIND_CLASS.info}`;
    toast.textContent = message;
    host.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 220);
    }, duration);
}
