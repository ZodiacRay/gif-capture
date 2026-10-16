import { h } from '../dom';
import { captureSupported } from '../recorder';

export interface HomeHooks {
  onRecord(): void;
  onOpenGif(file: File): void;
}

export interface HomeView {
  el: HTMLElement;
  /** Empty, hidden container for the optional ad (only used when ads are configured and allowed). */
  adSlot: HTMLElement;
  setActive(active: boolean): void;
}

export function createHome(hooks: HomeHooks): HomeView {
  const supported = captureSupported();

  const fileInput = h('input', { type: 'file', accept: 'image/gif', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) hooks.onOpenGif(file);
  });

  const recordBtn = h(
    'button',
    { class: 'btn record big', type: 'button', onclick: () => hooks.onRecord(), disabled: !supported },
    '● 화면 녹화 시작',
  );

  const adSlot = h('aside', { class: 'ad-slot', 'aria-label': '광고' });
  adSlot.hidden = true;

  const el = h(
    'div',
    { class: 'home' },
    h(
      'div',
      { class: 'hero' },
      h('h1', {}, '화면을 녹화해서 GIF로'),
      h('p', {}, '브라우저에서 바로 녹화하고, 편집하고, 저장하세요. 영상은 이 컴퓨터 밖으로 나가지 않습니다.'),
      h('div', { class: 'hero-actions' }, recordBtn, h('button', { class: 'btn big', type: 'button', onclick: () => fileInput.click() }, '📂 GIF 불러오기'), fileInput),
      supported
        ? h('p', { class: 'hint' }, 'GIF 파일을 이 창에 끌어다 놓아도 열립니다.')
        : h('p', { class: 'hint warn' }, '이 브라우저(또는 기기)에서는 화면 녹화를 지원하지 않습니다. 데스크톱의 Chrome, Edge, Firefox, Safari에서 사용하세요. GIF 편집은 가능합니다.'),
    ),
    h(
      'ul',
      { class: 'features' },
      h('li', {}, h('strong', {}, '영역 지정'), ' 화면을 고른 뒤 녹화할 부분만 크기를 조절해 선택'),
      h('li', {}, h('strong', {}, '프레임 편집'), ' 삭제, 앞뒤 자르기, 화면 자르기, 글자 추가, 되돌리기'),
      h('li', {}, h('strong', {}, '용량 맞춤'), ' 목표 MB에 맞춰 자동으로 크기를 줄여 저장'),
      h('li', {}, h('strong', {}, '기존 GIF 편집'), ' GIF를 불러와서 같은 방식으로 편집'),
    ),
    adSlot,
  );

  return {
    el,
    adSlot,
    setActive(value: boolean) {
      el.hidden = !value;
    },
  };
}
