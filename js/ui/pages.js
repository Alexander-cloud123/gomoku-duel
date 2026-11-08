// js/ui/pages.js - 页面切换
export const PAGES = Object.freeze({
    HOME: 'page-home',
    WAITING: 'page-waiting',
    JOIN: 'page-join',
    GAME: 'page-game'
});

let currentPage = PAGES.HOME;

export function showPage(pageId) {
    document.querySelectorAll('.page').forEach((page) => {
        page.classList.toggle('active', page.id === pageId);
    });
    currentPage = pageId;
    const active = document.getElementById(pageId);
    if (active) {
        const focusable = active.querySelector('.page-focus');
        if (focusable) focusable.focus({ preventScroll: true });
    }
}

export function getCurrentPage() {
    return currentPage;
}
