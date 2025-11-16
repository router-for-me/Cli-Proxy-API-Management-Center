export const themeModule = {
    initializeTheme() {
        const savedTheme = localStorage.getItem('preferredTheme');
        if (savedTheme && ['light', 'dark'].includes(savedTheme)) {
            this.currentTheme = savedTheme;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.currentTheme = 'dark';
        } else {
            this.currentTheme = 'light';
        }

        this.applyTheme(this.currentTheme);
        this.updateThemeButtons();

        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem('preferredTheme')) {
                    this.currentTheme = e.matches ? 'dark' : 'light';
                    this.applyTheme(this.currentTheme);
                    this.updateThemeButtons();
                }
            });
        }
    },

    applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        this.currentTheme = theme;
    },

    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        this.updateThemeButtons();
        localStorage.setItem('preferredTheme', newTheme);
    },

    updateThemeButtons() {
        const loginThemeBtn = document.getElementById('theme-toggle');
        const mainThemeBtn = document.getElementById('theme-toggle-main');

        const updateButton = (btn) => {
            if (!btn) return;
            const icon = btn.querySelector('i');
            if (this.currentTheme === 'dark') {
                icon.className = 'fas fa-sun';
                btn.title = i18n.t('theme.switch_to_light');
            } else {
                icon.className = 'fas fa-moon';
                btn.title = i18n.t('theme.switch_to_dark');
            }
        };

        updateButton(loginThemeBtn);
        updateButton(mainThemeBtn);
    },

    setupThemeSwitcher() {
        const loginToggle = document.getElementById('theme-toggle');
        const mainToggle = document.getElementById('theme-toggle-main');

        if (loginToggle) {
            loginToggle.addEventListener('click', () => this.toggleTheme());
        }
        if (mainToggle) {
            mainToggle.addEventListener('click', () => this.toggleTheme());
        }
    }
};
