// The theme picked in Settings: the system's, or light or dark whatever the system says. Remembered in the browser.
export type Theme = 'system' | 'light' | 'dark';
const remembered = (): Theme => {
  try {
    const kept = localStorage.getItem('koppler-theme');
    return kept === 'light' || kept === 'dark' ? kept : 'system';
  } catch {
    return 'system';
  }
};
class Picked {
  now = $state(remembered());
  pick(next: Theme): void {
    this.now = next;
    if (next === 'system') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = next;
    try {
      if (next === 'system') localStorage.removeItem('koppler-theme');
      else localStorage.setItem('koppler-theme', next);
    } catch {
      // Not remembered where the browser keeps nothing.
    }
  }
}
export const theme = new Picked();
