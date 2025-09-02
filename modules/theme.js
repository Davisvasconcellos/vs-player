// modules/theme.js
export function applyTheme(theme) {
    const themeToggleBtn = document.getElementById('themeToggle');
    document.documentElement.setAttribute('data-theme', theme);

    if (themeToggleBtn) {
        themeToggleBtn.textContent = theme === 'light' ? '☀︎' : '☾';
    }
    
    localStorage.setItem('showplay_theme', theme);
}

export function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
}