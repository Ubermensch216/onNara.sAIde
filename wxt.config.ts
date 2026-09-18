import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// 글꼴을 넣지 않은 한글 PDF를 읽는 데 필요한 CMap만 배포한다(전체는 170개가 넘는다). lib/extract/pdf-text.ts 참조.
const CMAP_DIR = resolve('node_modules/pdfjs-dist/cmaps');
const KOREAN_CMAP = /^(Adobe-Korea1-|KSC|UniKS-)/;

// manifest 전체는 이 파일에서 단일 관리한다.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const name of readdirSync(CMAP_DIR).filter(file => KOREAN_CMAP.test(file))) {
        files.push({ absoluteSrc: resolve(CMAP_DIR, name), relativeDest: `cmaps/${name}` });
      }
    },
  },

  manifest: {
    minimum_chrome_version: '116',
    // ★ __MSG_*__ 는 public/_locales/{ko,en}/messages.json 에서 온다.
    //   이 필드들은 크롬이 스토어·확장 관리 화면에 직접 그리므로 우리 i18n
    //   모듈이 아니라 chrome.i18n 규약을 따라야 한다.
    name: '__MSG_extName__',
    short_name: '온나라 sAIde',
    default_locale: 'ko',
    description: '__MSG_extDescription__',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },

    action: {
      default_title: '__MSG_actionTitle__',
    },

    permissions: [
      'sidePanel',
      'activeTab',
      'scripting',
      'storage',
      'contextMenus',
      'tabs',
      'webNavigation',
      'downloads',
      // 답변의 다운로드 파일 경로를 눌러 기본 프로그램으로 여는 데 필요하다.
      'downloads.open',
      // 문서 본문이 PDF 뷰어로 표시될 때 pdf.js로 글자를 뽑는 숨은 문서를 만든다.
      'offscreen',
      /**
       * 일정 탭(S07)의 기한 알림. 둘은 한 쌍이다.
       *
       * ★ 사이드패널 타이머로는 안 된다. 패널을 닫으면 문서가 사라져 타이머도 죽는다.
       *   서비스 워커를 알람이 깨워 확인하고, 알림으로 알린다. 알림은 하루 한 번이다.
       */
      'alarms',
      'notifications',
    ],

    // 설치 시점에 확정으로 갖는 접근권은 로컬 Ollama뿐이다.
    host_permissions: ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'],

    /**
     * 페이지 본문 읽기용. 설치할 때는 아무 사이트 권한도 갖지 않고,
     * 사용자가 "이 페이지 요약" 같은 버튼을 누른 순간에만 해당 사이트를 요청한다.
     *
     * ★ activeTab만으로는 불가능하다 — activeTab은 사용자가 그 탭에서 확장을
     *   직접 호출한 순간에만 부여되고 페이지 이동 시 회수되는데, 사이드패널은
     *   그 이후로도 계속 열려 있기 때문이다. src/lib/permissions.ts 참조.
     */
    optional_host_permissions: ['<all_urls>'],

    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+A' },
        description: '__MSG_commandOpen__',
      },
    },
  },
});
