export const navigationModule = {
    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                navItems.forEach(nav => nav.classList.remove('active'));
                document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));

                item.classList.add('active');
                const sectionId = item.getAttribute('data-section');
                const section = document.getElementById(sectionId);
                if (section) {
                    section.classList.add('active');
                }

                if (sectionId === 'logs') {
                    this.refreshLogs(false);
                } else if (sectionId === 'config-management') {
                    this.loadConfigFileEditor();
                    this.refreshConfigEditor();
                }
            });
        });
    },

    toggleMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const layout = document.getElementById('layout-container');
        const mainWrapper = document.getElementById('main-wrapper');

        if (sidebar && overlay) {
            const isOpen = sidebar.classList.toggle('mobile-open');
            overlay.classList.toggle('active');
            if (layout) {
                layout.classList.toggle('sidebar-open', isOpen);
            }
            if (mainWrapper) {
                mainWrapper.classList.toggle('sidebar-open', isOpen);
            }
        }
    },

    closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const layout = document.getElementById('layout-container');
        const mainWrapper = document.getElementById('main-wrapper');

        if (sidebar && overlay) {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
            if (layout) {
                layout.classList.remove('sidebar-open');
            }
            if (mainWrapper) {
                mainWrapper.classList.remove('sidebar-open');
            }
        }
    },

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const layout = document.getElementById('layout-container');

        if (sidebar && layout) {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            layout.classList.toggle('sidebar-collapsed', isCollapsed);

            localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');

            const toggleBtn = document.getElementById('sidebar-toggle-btn-desktop');
            if (toggleBtn) {
                toggleBtn.setAttribute('data-i18n-title', isCollapsed ? 'sidebar.toggle_expand' : 'sidebar.toggle_collapse');
                toggleBtn.title = i18n.t(isCollapsed ? 'sidebar.toggle_expand' : 'sidebar.toggle_collapse');
            }
        }
    },

    restoreSidebarState() {
        if (window.innerWidth > 1024) {
            const savedState = localStorage.getItem('sidebarCollapsed');
            if (savedState === 'true') {
                const sidebar = document.getElementById('sidebar');
                const layout = document.getElementById('layout-container');

                if (sidebar && layout) {
                    sidebar.classList.add('collapsed');
                    layout.classList.add('sidebar-collapsed');

                    const toggleBtn = document.getElementById('sidebar-toggle-btn-desktop');
                    if (toggleBtn) {
                        toggleBtn.setAttribute('data-i18n-title', 'sidebar.toggle_expand');
                        toggleBtn.title = i18n.t('sidebar.toggle_expand');
                    }
                }
            }
        }
    }
};
