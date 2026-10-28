import interact from 'interactjs';
import { clamp, fitRect, localPoint, normalizeAngle, resizeRect } from './window-geometry.ts';
import { parseLayout } from './layout.ts';
import type { SavedLayout, WindowState } from './layout.ts';
import { defaultStageLayout } from './stage-layout.ts';
import type { StageMode } from './stage-layout.ts';
import { stageDividerPaths } from './stage-dividers.ts';
const STORAGE_KEY = 'stream-ui:audio-layout';

export class WindowManager {
  mode: StageMode = '21:9';
  private panels: HTMLElement[];
  private rects = new Map<HTMLElement, WindowState>();
  private order: HTMLElement[];
  private menu: HTMLElement;
  private menuTarget: HTMLElement | null = null;
  private defaultLayout = true;
  private rotation: { panel: HTMLElement; pointerId: number; startX: number; angle: number } | null = null;

  constructor(private workspace: HTMLElement, editable = true) {
    this.panels = Array.from(workspace.querySelectorAll<HTMLElement>('.scope-window'));
    this.order = [...this.panels];
    this.menu = document.querySelector<HTMLElement>('#layer-menu')!;
    this.reset();
    if (!editable) {
      this.panels.forEach(panel => panel.tabIndex = -1);
      return;
    }

    for (const panel of this.panels) {
      panel.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || this.fixedPanel(panel)) return;
        this.layer(panel, 'front');
        panel.focus({ preventScroll: true });
        if (!event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        this.begin(panel);
        this.rotation = { panel, pointerId: event.pointerId, startX: event.clientX, angle: this.rects.get(panel)!.angle };
        panel.classList.add('is-rotating');
        panel.setPointerCapture(event.pointerId);
      }, { capture: true });
      panel.addEventListener('pointermove', (event) => {
        const rotation = this.rotation;
        if (!rotation || rotation.panel !== panel || rotation.pointerId !== event.pointerId) return;
        event.preventDefault();
        if (event.altKey) {
          this.rects.get(panel)!.angle = normalizeAngle(rotation.angle + (event.clientX - rotation.startX) * .5);
          this.fit(panel);
        }
      });
      const endRotation = (event: PointerEvent) => {
        if (this.rotation?.panel !== panel || this.rotation.pointerId !== event.pointerId) return;
        this.rotation = null;
        panel.classList.remove('is-rotating');
        if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
        this.end(panel);
      };
      panel.addEventListener('pointerup', endRotation);
      panel.addEventListener('pointercancel', endRotation);
      panel.addEventListener('lostpointercapture', endRotation);
      panel.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.openMenu(panel, event.clientX, event.clientY);
      });
      panel.addEventListener('keydown', (event) => this.onKey(panel, event));

      let resizeStart: WindowState | null = null;
      interact(panel)
        .draggable({
          // The whole panel is a drag surface; its edges are reserved for resize.
          listeners: {
            start: () => this.begin(panel),
            move: (event) => {
              const rect = this.rects.get(panel)!;
              rect.x += event.dx;
              rect.y += event.dy;
              this.fit(panel);
            },
            end: () => this.end(panel),
          },
        })
        .resizable({
          edges: { top: true, bottom: true, left: true, right: true },
          margin: 10,
          listeners: {
            start: () => {
              resizeStart = { ...this.rects.get(panel)! };
              this.begin(panel);
            },
            move: (event) => {
              if (!resizeStart) return;
              const scale = this.geometryScale();
              const minWidth = this.mode === '16:9' && panel.id === 'wordmark-window' ? 80 : 220;
              const rect = resizeRect(resizeStart, event.edges, event.clientX - event.clientX0, event.clientY - event.clientY0, minWidth * scale, 120 * scale);
              this.rects.set(panel, { ...resizeStart, ...rect });
              this.fit(panel);
            },
            end: () => { resizeStart = null; this.end(panel); },
          },
        })
        .actionChecker((pointer: PointerEvent, event: Event) => {
          if ((event as MouseEvent).altKey || this.rotation || this.fixedPanel(panel)) return null;
          const rect = this.rects.get(panel)!;
          const local = localPoint(rect, pointer.clientX, pointer.clientY);
          const edges = {
            left: Math.abs(local.x) <= 10,
            right: Math.abs(local.x - rect.width) <= 10,
            top: Math.abs(local.y) <= 10,
            bottom: Math.abs(local.y - rect.height) <= 10,
          };
          return Object.values(edges).some(Boolean) ? { name: 'resize', edges } : { name: 'drag' };
        });
    }

    this.menu.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || !this.menuTarget) return;
      if (button.dataset.action === 'invert') {
        const rect = this.rects.get(this.menuTarget)!;
        rect.inverted = !rect.inverted;
        this.defaultLayout = false;
        this.apply(this.menuTarget);
        this.save();
      } else this.layer(this.menuTarget, button.dataset.layer!);
      this.closeMenu(true);
    });
    this.menu.addEventListener('keydown', (event) => this.onMenuKey(event));
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.contains(event.target as Node)) this.closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeMenu(true);
    });
    document.addEventListener('focusin', (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target as Node)) this.closeMenu();
    });
    window.addEventListener('resize', () => {
      this.closeMenu();
      if (this.defaultLayout) this.reset();
      else {
        this.panels.forEach((panel) => this.fit(panel));
        this.save();
      }
    });
  }

  reset(): void {
    const width = this.workspace.clientWidth;
    const height = this.workspace.clientHeight;
    this.defaultLayout = true;
    this.order = [...this.panels];
    this.closeMenu();
    const layout = defaultStageLayout(this.mode);
    for (const panel of this.panels) {
      const rect = layout.windows[panel.id];
      this.rects.set(panel, { ...rect, x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height });
    }
    this.panels.forEach((panel) => this.fit(panel));
    this.applyLayers();
  }

  setMode(mode: StageMode): void {
    if (this.mode === mode) return;
    interact.stop();
    if (this.rotation) {
      const { panel, pointerId } = this.rotation;
      this.rotation = null;
      if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId);
    }
    this.panels.forEach(panel => panel.classList.remove('is-interacting', 'is-rotating'));
    this.mode = mode;
    this.closeMenu();
  }

  private fixedPanel(panel: HTMLElement): boolean {
    return this.mode === '16:9' && ['stream-window', 'spectrogram-window', 'waveform-window'].includes(panel.id);
  }

  private begin(panel: HTMLElement): void {
    this.defaultLayout = false;
    panel.classList.add('is-interacting');
    this.closeMenu();
  }

  private end(panel: HTMLElement): void {
    panel.classList.remove('is-interacting');
    this.fit(panel);
    this.save();
  }

  private apply(panel: HTMLElement): void {
    const rect = this.rects.get(panel)!;
    Object.assign(panel.style, { width: `${rect.width}px`, height: `${rect.height}px`, transform: `translate(${rect.x}px, ${rect.y}px) rotate(${rect.angle}deg)` });
    panel.style.setProperty('--panel-width', `${rect.width}px`);
    panel.style.setProperty('--panel-height', `${rect.height}px`);
    if (panel.id === 'stream-window') {
      // The transparent aperture follows the saved panel geometry.
      this.workspace.querySelector('.stage-backdrop')!.setAttribute('viewBox', `0 0 ${this.workspace.clientWidth} ${this.workspace.clientHeight}`);
      const cutout = this.workspace.querySelector('#stream-cutout')!;
      for (const [key, value] of Object.entries({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, transform: `rotate(${rect.angle} ${rect.x + rect.width / 2} ${rect.y + rect.height / 2})` })) cutout.setAttribute(key, String(value));
    }
    panel.dataset.inverted = String(rect.inverted);
    panel.querySelectorAll('audio-scope, kinetic-wordmark').forEach(element => element.toggleAttribute('inverted', rect.inverted));
    if (['stream-window', 'spectrogram-window', 'waveform-window'].includes(panel.id)) this.updateDividers();
  }

  private updateDividers(): void {
    const svg = this.workspace.querySelector<SVGSVGElement>('.stage-dividers');
    if (!svg) return;
    const rect = (id: string) => this.rects.get(this.panels.find(panel => panel.id === id)!)!;
    const paths = stageDividerPaths(rect('stream-window'), rect('spectrogram-window'), rect('waveform-window'));
    svg.setAttribute('viewBox', `0 0 ${this.workspace.clientWidth} ${this.workspace.clientHeight}`);
    for (const [name, path] of Object.entries(paths)) svg.querySelector(`[data-divider="${name}"]`)!.setAttribute('d', path);
  }

  private fit(panel: HTMLElement): void {
    const rect = this.rects.get(panel)!;
    if (this.mode === '16:9' && panel.id === 'stream-window') Object.assign(rect, { x: 0, y: 0, width: this.workspace.clientWidth, height: this.workspace.clientHeight, angle: 0 });
    const scale = this.geometryScale();
    fitRect(rect, this.workspace.clientWidth, this.workspace.clientHeight, 80 * scale, 40 * scale);
    if (this.mode === '16:9' && panel.id === 'wordmark-blur-window') rect.x = (this.workspace.clientWidth - rect.width) / 2;
    this.apply(panel);
  }

  private geometryScale(): number {
    return this.mode === '16:9' ? Math.min(this.workspace.clientWidth / 3840, this.workspace.clientHeight / 2160) : 1;
  }

  private layer(panel: HTMLElement, action: string): void {
    this.defaultLayout = false;
    const current = this.order.indexOf(panel);
    const next = action === 'front' ? this.order.length - 1 : action === 'back' ? 0 : action === 'up' ? Math.min(this.order.length - 1, current + 1) : Math.max(0, current - 1);
    this.order.splice(current, 1);
    this.order.splice(next, 0, panel);
    this.applyLayers();
    this.save();
  }

  private applyLayers(): void {
    this.order.forEach((panel, index) => panel.style.zIndex = String(index + 1));
  }

  private openMenu(panel: HTMLElement, x: number, y: number): void {
    this.menuTarget = panel;
    this.menu.hidden = false;
    const index = this.order.indexOf(panel);
    this.menu.querySelectorAll<HTMLButtonElement>('button[data-layer]').forEach((button) => {
      const atTop = button.dataset.layer === 'front' || button.dataset.layer === 'up';
      button.disabled = atTop ? index === this.order.length - 1 : index === 0;
    });
    this.menu.querySelector('[data-action="invert"]')!.setAttribute('aria-checked', String(this.rects.get(panel)!.inverted));
    this.menu.style.left = `${clamp(x, 8, window.innerWidth - this.menu.offsetWidth - 8)}px`;
    this.menu.style.top = `${clamp(y, 8, window.innerHeight - this.menu.offsetHeight - 8)}px`;
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  private closeMenu(restoreFocus = false): void {
    if (!this.menu || this.menu.hidden) return;
    this.menu.hidden = true;
    if (restoreFocus) this.menuTarget?.focus({ preventScroll: true });
    this.menuTarget = null;
  }

  private onMenuKey(event: KeyboardEvent): void {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  private onKey(panel: HTMLElement, event: KeyboardEvent): void {
    if (this.fixedPanel(panel)) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      this.openMenu(panel, rect.x + 30, rect.y + 30);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    this.defaultLayout = false;
    const rect = this.rects.get(panel)!;
    const amount = event.shiftKey ? 20 : 2;
    const dx = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0;
    const dy = event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0;
    if (event.altKey) rect.angle = normalizeAngle(rect.angle + dx / 2);
    else if (event.ctrlKey) { rect.width += dx; rect.height += dy; }
    else { rect.x += dx; rect.y += dy; }
    this.fit(panel);
    this.save();
  }

  save(): void {
    const width = this.workspace.clientWidth;
    const height = this.workspace.clientHeight;
    const layout: SavedLayout = { order: this.order.map((panel) => panel.id), windows: {} };
    for (const panel of this.panels) {
      const rect = this.rects.get(panel)!;
      layout.windows[panel.id] = { x: rect.x / width, y: rect.y / height, width: rect.width / width, height: rect.height / height, angle: rect.angle, inverted: rect.inverted };
    }
    try { localStorage.setItem(`${STORAGE_KEY}:${this.mode}`, JSON.stringify(layout)); } catch { /* Storage is optional. */ }
    this.workspace.dispatchEvent(new CustomEvent('layoutchange', { detail: layout }));
  }

  restore(input: unknown): void {
    try {
      if (input === null) { this.reset(); return; }
      const layout = parseLayout(input, this.panels.map(panel => panel.id));
      if (!layout || !Array.isArray(layout.order) || layout.order.length !== this.panels.length || new Set(layout.order).size !== this.panels.length) { this.reset(); return; }
      const restoredOrder = layout.order.map((id) => this.panels.find((panel) => panel.id === id));
      if (restoredOrder.some((panel) => !panel)) return;
      const nextRects = new Map(this.rects);
      for (const panel of restoredOrder as HTMLElement[]) {
        const rect = layout.windows?.[panel.id];
        if (!rect || ![rect.x, rect.y, rect.width, rect.height, rect.angle].every(Number.isFinite) || typeof rect.inverted !== 'boolean' || rect.width <= 0 || rect.height <= 0) return;
        nextRects.set(panel, {
          x: rect.x * this.workspace.clientWidth,
          y: rect.y * this.workspace.clientHeight,
          width: rect.width * this.workspace.clientWidth,
          height: rect.height * this.workspace.clientHeight,
          angle: normalizeAngle(rect.angle), inverted: rect.inverted,
        });
      }
      this.rects = nextRects;
      this.order = restoredOrder as HTMLElement[];
      this.defaultLayout = false;
      this.panels.forEach((panel) => this.fit(panel));
      this.applyLayers();
    } catch { /* A corrupt or unavailable saved layout must not prevent startup. */ }
  }
}
