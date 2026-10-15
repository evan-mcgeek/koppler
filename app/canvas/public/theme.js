/* global document */
// The chosen theme, set before the page draws. A file of its own: the page allows no inline script.
try {
  const theme = localStorage.getItem('koppler-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Not kept in this browser: the system's theme is used.
}
