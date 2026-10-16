import './style.css';
import { h } from './dom';
import { importGif } from './importGif';
import { FrameStore } from './model';
import { startCapture } from './recorder';
import { loadSettings } from './storage';
import { applyTheme, onThemeChange, themeToggleLabel, toggleTheme } from './theme';
import { showProgress, toast } from './ui';
import { createEditor } from './views/editor';
import { createHome } from './views/home';
import { createRecordView } from './views/record';

const REPO = 'https://github.com/ZodiacRay/gif-capture';

applyTheme();

const store = new FrameStore();
/** True while there is work that has not been saved as a GIF. */
let dirty = false;
store.onChange(() => {
  dirty = store.frames.length > 0;
});

type View = 'home' | 'record' | 'editor';
let current: View = 'home';

const home = createHome({ onRecord: () => void startRecording(), onOpenGif: (file) => void openGif(file) });
const record = createRecordView({
  onFinished(frames) {
    store.reset(frames);
    show('editor');
    editor.goToFirst();
  },
  onCancel() {
    show(store.frames.length > 0 ? 'editor' : 'home');
  },
});
const editor = createEditor(store, {
  onNewRecording: () => void startRecording(),
  onOpenGif: (file) => void openGif(file),
  onExported: () => {
    dirty = false;
  },
});

function show(view: View): void {
  current = view;
  home.setActive(view === 'home');
  record.setActive(view === 'record');
  editor.setActive(view === 'editor');
}

async function startRecording(): Promise<void> {
  if (dirty && !window.confirm('저장하지 않은 편집 내용이 사라집니다. 새로 녹화할까요?')) return;
  try {
    const capture = await startCapture(loadSettings().fps);
    record.begin(capture);
    show('record');
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') toast('화면 선택을 취소했습니다.');
    else toast(`화면 녹화를 시작하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

async function openGif(file: File): Promise<void> {
  if (current === 'record') return;
  if (!/\.gif$/i.test(file.name) && file.type !== 'image/gif') {
    toast('GIF 파일만 열 수 있습니다.', 'error');
    return;
  }
  const hadFrames = store.frames.length > 0;
  const dialog = showProgress('GIF 여는 중');
  try {
    const frames = await importGif(file, (done, total) => dialog.update(`${done}/${total} 프레임`, done / total));
    store.set(frames); // undoable when something was open before
    show('editor');
    editor.goToFirst();
    toast(hadFrames ? '열었습니다. 이전 작업은 Ctrl+Z로 되돌릴 수 있습니다.' : `열었습니다: ${frames.length} 프레임`);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'GIF를 열지 못했습니다.', 'error');
  } finally {
    dialog.close();
  }
}

// ---------- page frame ----------

const themeIcon = h('span', { 'aria-hidden': true });
const themeName = h('span', {});
const themeBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => toggleTheme() }, themeIcon, ' ', themeName);
function syncTheme(): void {
  const t = themeToggleLabel();
  themeIcon.textContent = t.icon;
  themeName.textContent = t.name;
  themeBtn.title = `${t.name}로 전환`;
}
onThemeChange(syncTheme);
syncTheme();

const header = h(
  'header',
  { class: 'app-header' },
  h(
    'a',
    { class: 'brand', href: './', 'aria-label': 'GifCapture Web 처음으로' },
    h('img', { src: `${import.meta.env.BASE_URL}favicon.svg`, alt: '', width: 28, height: 28 }),
    h('span', {}, 'GifCapture ', h('small', {}, 'Web')),
  ),
  h('span', { class: 'spacer' }),
  h('a', { class: 'link', href: `${REPO}/releases/latest`, target: '_blank', rel: 'noopener' }, 'Windows 앱'),
  h('a', { class: 'link', href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub'),
  themeBtn,
);

const dropHint = h('div', { class: 'drop-hint', hidden: true }, 'GIF 파일을 여기에 놓으세요');

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');
app.append(
  header,
  h('main', { class: 'app-main' }, home.el, record.el, editor.el),
  h('footer', { class: 'app-footer' }, 'MIT License · 영상과 GIF는 이 브라우저 안에서만 처리되며 서버로 전송되지 않습니다.'),
  dropHint,
);
show('home');

// ---------- drag & drop a GIF anywhere ----------

let dragDepth = 0;
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || current === 'record') return;
  dragDepth++;
  dropHint.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropHint.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const file = e.dataTransfer?.files[0];
  if (file) void openGif(file);
});

// ---------- do not lose unsaved work by accident ----------

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
