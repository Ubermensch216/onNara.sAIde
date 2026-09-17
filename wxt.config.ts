import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// manifest 전체는 이 파일에서 단일 관리한다.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],

  vite: () => ({
    plugins: [tailwindcss()],
  }),

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
        suggested_key: { default: 'Ctrl+Shift+S' },
        description: '__MSG_commandOpen__',
      },
    },
  },
});
