// Import CSS
import './styles.css';

// Import JavaScript modules
import './i18n.js';
import './app.js';

// Import logo image
import logoImg from './logo.jpg';

// Set logo after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const loginLogo = document.getElementById('login-logo');
    const siteLogo = document.getElementById('site-logo');

    if (loginLogo) {
        loginLogo.src = logoImg;
        loginLogo.style.display = 'block';
    }

    if (siteLogo) {
        siteLogo.src = logoImg;
        siteLogo.style.display = 'block';
    }
});
