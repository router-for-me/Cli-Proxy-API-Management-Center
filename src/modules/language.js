export const languageModule = {
    setupLanguageSwitcher() {
        const loginToggle = document.getElementById('language-toggle');
        const mainToggle = document.getElementById('language-toggle-main');

        if (loginToggle) {
            loginToggle.addEventListener('click', () => this.toggleLanguage());
        }
        if (mainToggle) {
            mainToggle.addEventListener('click', () => this.toggleLanguage());
        }
    },

    toggleLanguage() {
        if (this.isLanguageRefreshInProgress) {
            return;
        }
        this.isLanguageRefreshInProgress = true;

        const currentLang = i18n.currentLanguage;
        const newLang = currentLang === 'zh-CN' ? 'en-US' : 'zh-CN';
        i18n.setLanguage(newLang);

        this.refreshBrandTitleAfterTextChange();
        this.updateThemeButtons();
        this.updateConnectionStatus();

        if (this.isLoggedIn && this.isConnected && this.events && typeof this.events.emit === 'function') {
            this.events.emit('config:refresh-requested', { forceRefresh: true });
        }

        // 简单释放锁，避免短时间内的重复触发
        setTimeout(() => {
            this.isLanguageRefreshInProgress = false;
        }, 500);
    }
};
