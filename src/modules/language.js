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
        const currentLang = i18n.currentLanguage;
        const newLang = currentLang === 'zh-CN' ? 'en-US' : 'zh-CN';
        i18n.setLanguage(newLang);

        this.updateThemeButtons();
        this.updateConnectionStatus();

        if (this.isLoggedIn && this.isConnected) {
            this.loadAllData(true);
        }
    }
};
