// js/ui/dialog.js - 统一模态框（替代 alert/confirm，支持键盘与焦点陷阱）
export class Dialog {
    constructor() {
        this.root = document.getElementById('modal-root');
        this.titleEl = document.getElementById('modal-title');
        this.bodyEl = document.getElementById('modal-body');
        this.actionsEl = document.getElementById('modal-actions');
        this.card = this.root ? this.root.querySelector('.modal-card') : null;
        this.resolve = null;
        this.timer = null;
        this._lastFocus = null;

        if (this.root) {
            this.root.addEventListener('keydown', (event) => this._onKeyDown(event));
            this.root.addEventListener('click', (event) => {
                if (event.target === this.root) this._finish(null);
            });
        }
    }

    get isOpen() {
        return Boolean(this.root && !this.root.hidden);
    }

    /**
     * @param {object} options title/message/html/actions/timeoutMs/timeoutValue
     * @returns {Promise<any>} 选择结果
     */
    show(options = {}) {
        return new Promise((resolve) => {
            if (!this.root) {
                resolve(null);
                return;
            }
            if (this.isOpen) this._finish(null);

            this._lastFocus = document.activeElement;
            this.resolve = resolve;
            const { title = '', message = '', html = '', actions = [{ label: '知道了', value: 'ok', primary: true }], timeoutMs = 0, timeoutValue = null } = options;

            this.titleEl.textContent = title;
            this.bodyEl.innerHTML = '';
            if (message) {
                const p = document.createElement('p');
                p.className = 'modal-message';
                p.textContent = message;
                this.bodyEl.appendChild(p);
            }
            if (html) {
                const wrapper = document.createElement('div');
                wrapper.className = 'modal-html';
                wrapper.innerHTML = html;
                this.bodyEl.appendChild(wrapper);
            }

            this.actionsEl.innerHTML = '';
            for (const action of actions) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `btn btn-small ${action.primary ? 'btn-primary' : action.danger ? 'btn-danger' : 'btn-secondary'}`;
                button.textContent = action.label;
                button.addEventListener('click', () => this._finish(action.value));
                this.actionsEl.appendChild(button);
            }

            this.root.hidden = false;
            document.body.classList.add('modal-open');
            requestAnimationFrame(() => this.root.classList.add('visible'));

            const first = this.actionsEl.querySelector('button');
            if (first) first.focus({ preventScroll: true });

            if (timeoutMs > 0) {
                this.timer = setTimeout(() => this._finish(timeoutValue), timeoutMs);
            }
        });
    }

    confirm(options = {}) {
        return this.show({
            title: options.title || '确认',
            message: options.message || '',
            timeoutMs: options.timeoutMs || 0,
            timeoutValue: false,
            actions: [
                { label: options.cancelText || '取消', value: false },
                { label: options.confirmText || '确定', value: true, primary: true, danger: options.danger }
            ]
        }).then((value) => value === true);
    }

    _finish(value) {
        if (!this.root || this.root.hidden) return;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const resolve = this.resolve;
        this.resolve = null;
        this.root.hidden = true;
        this.root.classList.remove('visible');
        document.body.classList.remove('modal-open');
        if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
            this._lastFocus.focus({ preventScroll: true });
        }
        if (resolve) resolve(value);
    }

    close() {
        this._finish(null);
    }

    _onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            this._finish(null);
            return;
        }
        if (event.key !== 'Tab') return;
        const buttons = Array.from(this.actionsEl.querySelectorAll('button'));
        if (buttons.length === 0) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
}
