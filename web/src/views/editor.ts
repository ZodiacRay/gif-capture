import { CropBox, contentBox } from '../cropbox';
import { clamp, formatBytes, h } from '../dom';
import { exportGif } from '../gif/export';
import { addTextToFrames, cropFrames, drawText } from '../imaging';
import { FrameStore } from '../model';
import { Player, Preview } from '../player';
import { loadSettings, saveSettings } from '../storage';
import { FrameStrip } from '../strip';
import { onThemeChange, themeToggleLabel, toggleTheme } from '../theme';
import { ribbonButton, ribbonGroup, showProgress, toast } from '../ui';

type Tool = 'none' | 'crop' | 'text';

const SWATCHES = ['#ffffff', '#000000', '#ff3b30', '#ffd60a', '#34c759', '#0a84ff'];

export interface EditorHooks {
  onNewRecording(): void;
  onOpenGif(file: File): void;
  /** A GIF was saved, so the current work is safe to leave. */
  onExported(): void;
}

export interface Editor {
  el: HTMLElement;
  /** Keyboard shortcuts only work while the editor is on screen. */
  setActive(active: boolean): void;
  /** Shows the first frame (after loading a new recording or file). */
  goToFirst(): void;
}

export function createEditor(store: FrameStore, hooks: EditorHooks): Editor {
  const settings = loadSettings();
  let active = false;
  let tool: Tool = 'none';

  const preview = new Preview();
  const strip = new FrameStrip(store, () => onSelectionChanged());
  const player = new Player(store, preview, strip);
  player.speed = settings.speed;
  player.loop = settings.playLoop;

  // ---------- ribbon ----------

  const undoBtn = ribbonButton('↶', '되돌리기', () => undo(), '되돌리기 (Ctrl+Z)');
  const cropBtn = ribbonButton('✂', '화면 자르기', () => setTool(tool === 'crop' ? 'none' : 'crop'), '모든 프레임의 화면을 자릅니다');
  const textBtn = ribbonButton('T', '글자 추가', () => setTool(tool === 'text' ? 'none' : 'text'), '프레임 위에 글자를 넣습니다');

  const limitOn = h('input', { type: 'checkbox', id: 'limit-on' });
  limitOn.checked = settings.limitOn;
  const limitMb = h('input', { type: 'number', min: 0.1, max: 200, step: 0.5, class: 'num', 'aria-label': '용량 제한(MB)' });
  limitMb.value = String(settings.limitMb);
  const gifLoop = h('input', { type: 'checkbox', id: 'gif-loop' });
  gifLoop.checked = settings.gifLoop;
  const syncLimit = (): void => {
    limitMb.disabled = !limitOn.checked;
    saveSettings({ limitOn: limitOn.checked, limitMb: Number(limitMb.value) || 5, gifLoop: gifLoop.checked });
  };
  limitOn.addEventListener('change', syncLimit);
  limitMb.addEventListener('change', syncLimit);
  gifLoop.addEventListener('change', syncLimit);
  limitMb.disabled = !limitOn.checked;

  const themeIcon = h('span', { class: 'ribbon-icon', 'aria-hidden': true });
  const themeLabel = h('span', { class: 'ribbon-label' });
  const themeBtn = h('button', { class: 'ribbon-btn', type: 'button', onclick: () => toggleTheme() }, themeIcon, themeLabel);
  const syncTheme = (): void => {
    const t = themeToggleLabel();
    themeIcon.textContent = t.icon;
    themeLabel.textContent = t.name;
    themeBtn.title = `${t.name}로 전환`;
  };
  onThemeChange(syncTheme);
  syncTheme();

  const fileInput = h('input', { type: 'file', accept: 'image/gif', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) hooks.onOpenGif(file);
  });

  const ribbon = h(
    'div',
    { class: 'ribbon' },
    ribbonGroup(
      '프레임 편집',
      undoBtn,
      ribbonButton('✕', '선택 삭제', () => deleteSelected(), '선택한 프레임을 삭제합니다 (Delete)'),
      ribbonButton('⇤', '앞쪽 삭제', () => trim('before'), '현재 프레임 앞쪽을 모두 삭제합니다'),
      ribbonButton('⇥', '뒤쪽 삭제', () => trim('after'), '현재 프레임 뒤쪽을 모두 삭제합니다'),
    ),
    ribbonGroup('이미지', cropBtn, textBtn),
    ribbonGroup(
      '내보내기',
      h(
        'div',
        { class: 'export-opts' },
        h('label', { class: 'check' }, limitOn, '용량 제한', limitMb, 'MB'),
        h('label', { class: 'check', title: '저장된 GIF가 계속 반복 재생되게 합니다' }, gifLoop, 'GIF 반복'),
      ),
      ribbonButton('💾', 'GIF 저장', () => void exportNow(), 'GIF 파일로 저장합니다'),
    ),
    ribbonGroup(
      '파일',
      ribbonButton('●', '새 녹화', () => hooks.onNewRecording(), '새로 녹화합니다'),
      ribbonButton('📂', 'GIF 열기', () => fileInput.click(), '다른 GIF 파일을 엽니다'),
      fileInput,
    ),
    ribbonGroup('보기', themeBtn),
  );

  // ---------- tool panel (crop / text options) ----------

  const cropW = h('input', { type: 'number', min: 1, class: 'num', 'aria-label': '자를 너비(px)' });
  const cropH = h('input', { type: 'number', min: 1, class: 'num', 'aria-label': '자를 높이(px)' });
  const cropPanel = h(
    'div',
    { class: 'tool-row', hidden: true },
    h('span', {}, '가장자리·모서리를 끌어 크기를 조절하고, 안쪽을 끌어 이동하세요 (모든 프레임에 적용)'),
    h('label', {}, '크기', cropW, '×', cropH, 'px'),
    h('button', { class: 'btn', type: 'button', onclick: () => cropBox.reset() }, '전체'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => void applyCrop() }, '적용'),
    h('button', { class: 'btn', type: 'button', onclick: () => setTool('none') }, '취소'),
  );

  const textInput = h('textarea', { rows: 1, class: 'text-input', placeholder: '넣을 글자 (줄바꿈 가능)', 'aria-label': '넣을 글자' });
  const textSize = h('input', { type: 'number', min: 6, max: 500, class: 'num', 'aria-label': '글자 크기(px)' });
  textSize.value = String(settings.textSize);
  const textColor = h('input', { type: 'color', class: 'color', 'aria-label': '글자 색' });
  textColor.value = settings.textColor;
  const selectedOnly = h('input', { type: 'checkbox' });
  const swatches = h(
    'span',
    { class: 'swatches' },
    ...SWATCHES.map((c) =>
      h('button', {
        class: 'swatch',
        type: 'button',
        style: `background:${c}`,
        title: c,
        'aria-label': `색 ${c}`,
        onclick: () => {
          textColor.value = c;
          drawTextPreview();
        },
      }),
    ),
  );
  const textPanel = h(
    'div',
    { class: 'tool-row', hidden: true },
    h('label', {}, '글자', textInput),
    h('label', {}, '크기', textSize, 'px'),
    h('label', {}, '색', swatches, textColor),
    h('label', { class: 'check' }, selectedOnly, '선택한 프레임에만'),
    h('span', { class: 'hint' }, '미리보기를 클릭(드래그)해 위치를 정하세요'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => void applyText() }, '적용'),
    h('button', { class: 'btn', type: 'button', onclick: () => setTool('none') }, '취소'),
  );
  const toolPanel = h('div', { class: 'tool-panel', hidden: true }, cropPanel, textPanel);

  // ---------- preview with crop box and text overlay ----------

  const cropBox = new CropBox(preview.wrapper, {
    getSourceSize: () => preview.size,
    onChange: (r) => {
      cropW.value = String(r.w);
      cropH.value = String(r.h);
    },
  });
  cropW.addEventListener('change', () => cropBox.setSize(Number(cropW.value) || 1, cropBox.rect.h));
  cropH.addEventListener('change', () => cropBox.setSize(cropBox.rect.w, Number(cropH.value) || 1));

  const textOverlay = h('canvas', { class: 'text-overlay' });
  textOverlay.hidden = true;
  preview.wrapper.append(textOverlay);
  let textPos: { x: number; y: number } | null = null;

  preview.onSizeChange = () => {
    if (preview.size) {
      textOverlay.width = preview.size.w;
      textOverlay.height = preview.size.h;
    }
    cropBox.refresh();
    drawTextPreview();
  };

  function drawTextPreview(): void {
    const g = textOverlay.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, textOverlay.width, textOverlay.height);
    if (tool !== 'text' || !textPos || !textInput.value) return;
    drawText(g, { text: textInput.value, x: textPos.x, y: textPos.y, size: clamp(Number(textSize.value) || 32, 6, 500), color: textColor.value });
  }

  textOverlay.addEventListener('pointerdown', (e) => {
    textOverlay.setPointerCapture(e.pointerId);
    placeText(e);
  });
  textOverlay.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) placeText(e);
  });
  function placeText(e: PointerEvent): void {
    const box = contentBox(preview.wrapper, preview.size);
    if (!box || !preview.size) return;
    const rect = preview.wrapper.getBoundingClientRect();
    textPos = {
      x: Math.round(clamp((e.clientX - rect.left - box.x) / box.scale, 0, preview.size.w)),
      y: Math.round(clamp((e.clientY - rect.top - box.y) / box.scale, 0, preview.size.h)),
    };
    drawTextPreview();
  }
  textInput.addEventListener('input', drawTextPreview);
  textSize.addEventListener('input', drawTextPreview);
  textColor.addEventListener('input', drawTextPreview);

  function setTool(next: Tool): void {
    player.stop();
    tool = next;
    cropBtn.classList.toggle('active', next === 'crop');
    textBtn.classList.toggle('active', next === 'text');
    toolPanel.hidden = next === 'none';
    cropPanel.hidden = next !== 'crop';
    textPanel.hidden = next !== 'text';
    textOverlay.hidden = next !== 'text';
    textOverlay.classList.toggle('placing', next === 'text');

    if (next === 'crop') {
      cropBox.show();
      cropBox.reset();
    } else {
      cropBox.hide();
    }
    if (next === 'text') {
      if (!textPos && preview.size) textPos = { x: Math.round(preview.size.w * 0.05), y: Math.round(preview.size.h * 0.05) };
      textInput.focus();
    }
    drawTextPreview();
  }

  // ---------- playback bar ----------

  const iconBtn = (icon: string, label: string, onClick: () => void): HTMLButtonElement =>
    h(
      'button',
      { class: 'play-btn', type: 'button', onclick: onClick, title: label },
      h('span', { class: 'play-icon', 'aria-hidden': true }, icon),
      h('span', { class: 'play-label' }, label),
    );

  const playIcon = h('span', { class: 'play-icon', 'aria-hidden': true }, '▶');
  const playLabel = h('span', { class: 'play-label' }, '재생');
  const playBtn = h('button', { class: 'play-btn', type: 'button', title: '재생 / 정지 (Space)', onclick: () => player.toggle() }, playIcon, playLabel);
  player.onStateChange = () => {
    playIcon.textContent = player.playing ? '■' : '▶';
    playLabel.textContent = player.playing ? '정지' : '재생';
  };

  const speedInput = h('input', { type: 'number', min: 0.1, max: 10, step: 0.25, class: 'num', 'aria-label': '재생 속도 배율' });
  speedInput.value = String(settings.speed);
  speedInput.addEventListener('change', () => {
    player.speed = clamp(Number(speedInput.value) || 1, 0.1, 10);
    speedInput.value = String(player.speed);
    saveSettings({ speed: player.speed });
  });
  const playLoop = h('input', { type: 'checkbox' });
  playLoop.checked = settings.playLoop;
  playLoop.addEventListener('change', () => {
    player.loop = playLoop.checked;
    saveSettings({ playLoop: playLoop.checked });
  });

  const playBar = h(
    'div',
    { class: 'playbar' },
    iconBtn('«', '맨 처음으로', () => strip.goTo(0, true)),
    iconBtn('←', '이전 프레임', () => strip.goTo(strip.currentIndex - 1, true)),
    playBtn,
    iconBtn('→', '다음 프레임', () => strip.goTo(strip.currentIndex + 1, true)),
    iconBtn('»', '맨 마지막으로', () => strip.goTo(store.frames.length - 1, true)),
    h(
      'div',
      { class: 'play-opts' },
      h('label', {}, '재생 속도 ×', speedInput),
      h('label', { class: 'check' }, playLoop, '반복 재생'),
    ),
  );

  const info = h('div', { class: 'info', 'aria-live': 'polite' });

  const el = h(
    'div',
    { class: 'editor', hidden: true },
    ribbon,
    toolPanel,
    playBar,
    h('div', { class: 'preview-area' }, preview.wrapper),
    strip.el,
    info,
  );

  // ---------- actions ----------

  function onSelectionChanged(): void {
    player.stop();
    const frame = strip.currentFrame;
    if (frame) void preview.show(frame).then(updateInfo);
    updateInfo();
  }

  function onFramesChanged(): void {
    player.stop();
    strip.render();
    undoBtn.disabled = !store.canUndo;
    const frame = strip.currentFrame;
    if (frame) void preview.show(frame).then(updateInfo);
    else preview.clear();
    updateInfo();
  }
  store.onChange(onFramesChanged);
  undoBtn.disabled = true;

  function updateInfo(): void {
    const n = store.frames.length;
    if (n === 0) {
      info.textContent = '';
      return;
    }
    const ms = store.totalMs();
    const fps = ms > 0 ? (n * 1000) / ms : 0;
    const sel = strip.selected.size > 1 ? ` · ${strip.selected.size}개 선택` : '';
    const size = preview.size ? ` · ${preview.size.w}×${preview.size.h}px` : '';
    info.textContent = `${n} 프레임 · ${(ms / 1000).toFixed(1)}초 · 평균 ${fps.toFixed(fps < 10 ? 1 : 0)} fps${size}${sel}`;
  }

  function undo(): void {
    if (!store.canUndo) return;
    setTool('none');
    store.undo();
    toast('되돌렸습니다.');
  }

  function deleteSelected(): void {
    if (strip.selected.size === 0) return;
    if (strip.selected.size >= store.frames.length) {
      toast('모든 프레임을 삭제할 수는 없습니다.', 'error');
      return;
    }
    const index = strip.currentIndex;
    store.set(store.frames.filter((f) => !strip.selected.has(f.id)));
    strip.goTo(Math.min(index, store.frames.length - 1), true);
  }

  function trim(side: 'before' | 'after'): void {
    const i = strip.currentIndex;
    const frames = store.frames;
    if (side === 'before') {
      if (i <= 0) return toast('현재 프레임이 맨 앞입니다.');
      store.set(frames.slice(i));
      strip.goTo(0, true);
    } else {
      if (i >= frames.length - 1) return toast('현재 프레임이 맨 끝입니다.');
      store.set(frames.slice(0, i + 1));
      strip.goTo(i, true);
    }
  }

  async function applyCrop(): Promise<void> {
    const size = preview.size;
    if (!size) return;
    const r = cropBox.rect;
    if (r.x === 0 && r.y === 0 && r.w === size.w && r.h === size.h) return setTool('none'); // nothing to crop
    setTool('none');
    const dialog = showProgress('화면 자르는 중');
    try {
      const frames = await cropFrames(store.frames, r, (done, total) => dialog.update(`${done}/${total} 프레임`, done / total));
      store.set(frames);
      strip.goTo(strip.currentIndex, true);
      toast(`${r.w}×${r.h}px로 잘랐습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '자르기에 실패했습니다.', 'error');
    } finally {
      dialog.close();
    }
  }

  async function applyText(): Promise<void> {
    const text = textInput.value;
    if (!text.trim() || !textPos) return toast('글자를 입력하고 미리보기에서 위치를 클릭하세요.', 'error');
    const size = clamp(Number(textSize.value) || 32, 6, 500);
    const ids = selectedOnly.checked ? new Set(strip.selected) : null;
    saveSettings({ textSize: size, textColor: textColor.value });
    const options = { text, x: textPos.x, y: textPos.y, size, color: textColor.value };

    setTool('none');
    const dialog = showProgress('글자 넣는 중');
    try {
      const frames = await addTextToFrames(store.frames, ids, options, (done, total) => dialog.update(`${done}/${total} 프레임`, done / total));
      store.set(frames);
      strip.goTo(strip.currentIndex, true);
      toast('글자를 넣었습니다. Ctrl+Z로 되돌릴 수 있습니다.');
    } catch (e) {
      toast(e instanceof Error ? e.message : '글자 넣기에 실패했습니다.', 'error');
    } finally {
      dialog.close();
    }
  }

  async function exportNow(): Promise<void> {
    if (store.frames.length === 0) return;
    player.stop();
    setTool('none');
    syncLimit();
    const limit = limitOn.checked ? Math.round(Math.max(0.1, Number(limitMb.value) || 5) * 1024 * 1024) : null;

    const job = exportGif(
      store.frames.map((f) => ({ blob: f.blob, delayMs: f.delayMs })),
      { speed: player.speed, loop: gifLoop.checked, maxBytes: limit },
      (text, fraction) => dialog.update(text, fraction),
    );
    const dialog = showProgress('GIF 만드는 중', () => job.cancel());
    try {
      const result = await job.promise;
      download(result.blob, `recording-${timestamp()}.gif`);
      hooks.onExported();
      const size = formatBytes(result.blob.size);
      if (limit !== null && !result.fit) {
        toast(`목표 용량에 맞추지 못했습니다. 가장 작게 만든 결과(${size}, 크기 ${Math.round(result.scale * 100)}%)를 저장했습니다.`, 'error');
      } else if (result.scale < 0.999) {
        toast(`저장했습니다: ${size} (크기 ${Math.round(result.scale * 100)}%)`);
      } else {
        toast(`저장했습니다: ${size}`);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast(e instanceof Error ? e.message : 'GIF를 만들지 못했습니다.', 'error');
      else toast('취소했습니다.');
    } finally {
      dialog.close();
    }
  }

  // ---------- keyboard ----------

  window.addEventListener('keydown', (e) => {
    if (!active) return;
    const target = e.target as HTMLElement;
    const typing = target.matches('input, textarea, select, [contenteditable]');

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === ' ' && !target.matches('button')) {
      e.preventDefault();
      player.toggle();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'Escape' && tool !== 'none') {
      setTool('none');
    } else if (!target.matches('.strip')) {
      if (e.key === 'ArrowLeft') strip.goTo(strip.currentIndex - 1, true);
      else if (e.key === 'ArrowRight') strip.goTo(strip.currentIndex + 1, true);
      else if (e.key === 'Home') strip.goTo(0, true);
      else if (e.key === 'End') strip.goTo(store.frames.length - 1, true);
    }
  });

  return {
    el,
    setActive(value: boolean) {
      active = value;
      el.hidden = !value;
      if (!value) {
        player.stop();
        setTool('none');
      } else {
        onFramesChanged();
      }
    },
    goToFirst() {
      strip.goTo(0, true);
    },
  };
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
