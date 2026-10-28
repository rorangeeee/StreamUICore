(() => {
  const key = 'streamui:appearance';
  const modes = new Set(['system', 'light', 'dark']);
  const media = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  try { const saved = localStorage.getItem(key); if (modes.has(saved)) mode = saved; } catch { }
  function apply() {
    const theme = mode === 'system' ? media.matches ? 'dark' : 'light' : mode;
    document.documentElement.dataset.appearance = mode;
    document.documentElement.dataset.theme = theme;
    const picker = document.getElementById('appearance-mode');
    if (picker) picker.value = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#1c1c1e' : '#f5f5f7';
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('appearance-mode');
    if (picker) picker.addEventListener('change', () => {
      mode = picker.value;
      try { localStorage.setItem(key, mode); } catch { }
      apply();
    });
    apply();
  }, { once: true });
  media.addEventListener('change', () => { if (mode === 'system') apply(); });
  addEventListener('storage', event => {
    if (event.key !== key) return;
    mode = modes.has(event.newValue) ? event.newValue : 'system'; apply();
  });
})();
