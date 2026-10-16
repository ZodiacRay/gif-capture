import { CropBox } from '../cropbox';
import { clamp, formatDuration, h } from '../dom';
import type { Frame } from '../model';
import { type Capture, Recording } from '../recorder';
import { loadSettings, saveSettings } from '../storage';
import { toast } from '../ui';

export interface RecordHooks {
  /** Recording finished (or was stopped from the browser's own "stop sharing" bar). */
  onFinished(frames: Frame[]): void;
  /** The user gave up before recording. */
  onCancel(): void;
}

export interface RecordView {
  el: HTMLElement;
  /** Starts showing a screen that the user chose to share. */
  begin(capture: Capture): void;
  setActive(active: boolean): void;
}

export function createRecordView(hooks: RecordHooks): RecordView {
  const settings = loadSettings();
  const originalTitle = document.title;

  let capture: Capture | null = null;
  let recording: Recording | null = null;
  let cropBox: CropBox | null = null;
  let ticker = 0;
  let limitMs = 0;
  let active = false;
  let stopping = false;

  const wrapper = h('div', { class: 'preview-wrap record-preview' });
  const widthInput = h('input', { type: 'number', min: 16, class: 'num', 'aria-label': '녹화 너비(px)' });
  const heightInput = h('input', { type: 'number', min: 16, class: 'num', 'aria-label': '녹화 높이(px)' });
  const fullBtn = h('button', { class: 'btn', type: 'button', onclick: () => cropBox?.reset() }, '전체 화면');
  const fpsInput = h('input', { type: 'number', min: 1, max: 60, class: 'num', 'aria-label': 'fps' });
  fpsInput.value = String(settings.fps);
  const timerOn = h('input', { type: 'checkbox' });
  timerOn.checked = settings.timerOn;
  const timerSec = h('input', { type: 'number', min: 1, max: 3600, class: 'num', 'aria-label': '녹화 시간(초)' });
  timerSec.value = String(settings.timerSeconds);
  const recBtn = h('button', { class: 'btn record', type: 'button', onclick: () => toggle() }, '● 녹화 시작 (F7)');
  const cancelBtn = h('button', { class: 'btn', type: 'button', onclick: () => cancel() }, '취소');
  const status = h('div', { class: 'info', 'aria-live': 'polite' }, '녹화할 영역을 정한 뒤 녹화 시작을 누르세요.');

  const controls = h(
    'div',
    { class: 'record-controls' },
    h('label', {}, '영역', widthInput, '×', heightInput, 'px'),
    fullBtn,
    h('label', {}, fpsInput, 'fps'),
    h('label', { class: 'check' }, timerOn, '타이머', timerSec, '초'),
    recBtn,
    cancelBtn,
  );

  const el = h(
    'div',
    { class: 'record-view', hidden: true },
    h('div', { class: 'preview-area' }, wrapper),
    controls,
    status,
  );

  widthInput.addEventListener('change', () => cropBox?.setSize(Number(widthInput.value) || 16, cropBox.rect.h));
  heightInput.addEventListener('change', () => cropBox?.setSize(cropBox.rect.w, Number(heightInput.value) || 16));

  function begin(next: Capture): void {
    teardown();
    capture = next;
    stopping = false;
    wrapper.replaceChildren(next.video);
    next.video.className = 'preview-video';

    cropBox = new CropBox(wrapper, {
      getSourceSize: () => (capture ? { w: capture.width, h: capture.height } : null),
      onChange: (r) => {
        widthInput.value = String(r.w);
        heightInput.value = String(r.h);
      },
    });
    cropBox.show();
    cropBox.reset();
    next.video.addEventListener('resize', onVideoResize);
    next.onEnded(() => onSharingEnded(next));

    setIdle();
  }

  function onVideoResize(): void {
    if (!capture) return;
    capture.width = capture.video.videoWidth;
    capture.height = capture.video.videoHeight;
    if (!recording) cropBox?.refresh();
  }

  function onSharingEnded(which: Capture): void {
    if (which !== capture) return; // an old session ending after we moved on
    if (recording) void finish();
    else {
      toast('화면 공유가 끝났습니다.');
      cancel();
    }
  }

  function setIdle(): void {
    recBtn.textContent = '● 녹화 시작 (F7)';
    recBtn.classList.remove('stop');
    for (const input of [widthInput, heightInput, fpsInput, timerOn, timerSec]) input.disabled = false;
    fullBtn.disabled = false;
    cropBox?.setLocked(false);
    status.textContent = '녹화할 영역을 정한 뒤 녹화 시작을 누르세요.';
  }

  function toggle(): void {
    if (stopping) return;
    if (recording) void finish();
    else start();
  }

  function start(): void {
    if (!capture || !cropBox) return;
    const region = { ...cropBox.rect };
    // Even sizes keep later video-style processing happy and avoid 1px rounding surprises.
    region.w -= region.w % 2;
    region.h -= region.h % 2;
    if (region.w < 16 || region.h < 16) {
      toast('녹화 영역이 너무 작습니다. (최소 16×16px)', 'error');
      return;
    }

    const fps = clamp(Math.round(Number(fpsInput.value)) || 15, 1, 60);
    const seconds = clamp(Math.round(Number(timerSec.value)) || 10, 1, 3600);
    limitMs = timerOn.checked ? seconds * 1000 : 0;
    saveSettings({ fps, timerOn: timerOn.checked, timerSeconds: seconds });

    recording = new Recording(capture, region, fps);
    recording.start();

    for (const input of [widthInput, heightInput, fpsInput, timerOn, timerSec]) input.disabled = true;
    fullBtn.disabled = true;
    cropBox.setLocked(true);
    recBtn.classList.add('stop');
    tick();
    ticker = window.setInterval(tick, 250);
  }

  function tick(): void {
    if (!recording) return;
    const elapsed = recording.elapsedMs;
    if (limitMs > 0 && elapsed >= limitMs) {
      void finish(); // timer ran out
      return;
    }
    const time = limitMs > 0 ? `${formatDuration(elapsed)} / ${formatDuration(limitMs)}` : formatDuration(elapsed);
    recBtn.textContent = `■ 정지 · ${time}`;
    status.textContent = `녹화 중... ${recording.frameCount} 프레임`;
    document.title = `● ${time} · ${originalTitle}`;
  }

  async function finish(): Promise<void> {
    if (!recording || stopping) return;
    stopping = true;
    window.clearInterval(ticker);
    const current = recording;
    recording = null;
    status.textContent = '프레임을 정리하는 중...';
    try {
      const frames = await current.stop();
      capture?.stop();
      teardown();
      if (frames.length === 0) {
        toast('녹화된 프레임이 없습니다.', 'error');
        hooks.onCancel();
      } else {
        hooks.onFinished(frames);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '녹화를 마무리하지 못했습니다.', 'error');
      teardown();
      hooks.onCancel();
    }
  }

  function cancel(): void {
    window.clearInterval(ticker);
    recording = null;
    capture?.stop();
    teardown();
    hooks.onCancel();
  }

  function teardown(): void {
    window.clearInterval(ticker);
    document.title = originalTitle;
    cropBox?.destroy();
    cropBox = null;
    if (capture) capture.video.removeEventListener('resize', onVideoResize);
    wrapper.replaceChildren();
    capture = null;
    recording = null;
    stopping = false;
  }

  window.addEventListener('keydown', (e) => {
    if (active && e.key === 'F7') {
      e.preventDefault();
      toggle();
    }
  });

  return {
    el,
    begin,
    setActive(value: boolean) {
      active = value;
      el.hidden = !value;
    },
  };
}
