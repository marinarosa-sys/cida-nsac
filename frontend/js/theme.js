// js/theme.js
(function () {
  const THEME_KEY = 'fieldshift_dark_mode';

  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
      if (document.body) document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      if (document.body) document.body.classList.remove('dark-mode');
    }
  }

  // Apply immediately before paint to prevent flash
  const saved = localStorage.getItem(THEME_KEY) === 'true';
  applyTheme(saved);

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem(THEME_KEY) === 'true');

    const toggle = document.getElementById('darkModeToggle');
    if (toggle) {
      toggle.checked = localStorage.getItem(THEME_KEY) === 'true';
      toggle.addEventListener('change', () => {
        const active = toggle.checked;
        localStorage.setItem(THEME_KEY, String(active));
        applyTheme(active);
      });
    }
  });
})();