/**
 * 다국어. 계획서 §5 Phase 7-4
 *
 * ★ chrome.i18n을 UI에 쓰지 않는 이유.
 *   chrome.i18n은 **브라우저 언어**를 따르고 런타임에 바꿀 수 없다. 그런데
 *   설정 화면에는 이미 `locale` 항목이 있어서, 사용자는 앱 안에서 언어를
 *   바꿀 수 있다고 기대한다. 그래서 UI 문자열은 자체 카탈로그로 처리하고,
 *   chrome.i18n은 **manifest 필드(확장 이름·설명)** 에만 쓴다 — 그쪽은
 *   크롬이 스토어 목록과 확장 관리 화면에 직접 그리므로 우리가 못 건드린다.
 *
 * ★ 키가 빠지면 컴파일이 깨진다.
 *   en 카탈로그가 ko의 모든 키를 갖도록 satisfies로 강제한다. 번역 누락은
 *   화면에 키 이름이 그대로 노출되는 형태로 드러나므로 타입으로 막는 편이 낫다.
 */

import { createElement, Fragment, type ReactNode } from 'react';
import { create } from 'zustand';
import { MESSAGES, type MessageKey } from './catalog';

export type Locale = 'ko' | 'en';
export type { MessageKey };

export const LOCALES: Locale[] = ['ko', 'en'];

/** 브라우저 언어에서 기본 로케일을 고른다. 설정이 없을 때만 쓴다. */
export function detectLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'ko';
  return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

/**
 * 현재 로케일. App이 설정을 읽어 넣어 준다.
 *
 * zustand를 쓰는 이유는 두 가지다 — React 밖(스토어·오류 분류)에서도
 * `t()`를 부를 수 있어야 하고, 바뀌면 화면이 다시 그려져야 한다.
 */
export const useLocaleStore = create<LocaleState>((set) => ({
  locale: 'ko',
  setLocale: (locale) => set({ locale }),
}));

export function setLocale(l: Locale): void {
  useLocaleStore.getState().setLocale(l);
}

export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}

/** `{name}` 자리를 값으로 채운다. */
type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  // ko를 최종 폴백으로 둔다 — en에 구멍이 나도 키 이름이 노출되지는 않는다.
  const text = MESSAGES[locale][key] ?? MESSAGES.ko[key] ?? key;
  return interpolate(text, vars);
}

/**
 * React 밖에서 쓰는 번역 함수.
 * 스토어·서비스 워커 라우팅처럼 훅을 쓸 수 없는 곳에서 부른다.
 */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(getLocale(), key, vars);
}

/** React용. 로케일이 바뀌면 구독 중인 컴포넌트만 다시 그린다. */
export function useT(): (key: MessageKey, vars?: Vars) => string {
  const locale = useLocaleStore((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}

/**
 * `**강조**`를 `<strong>`으로 바꿔 준다.
 *
 * ★ 카탈로그를 평문으로 유지하기 위한 장치다. 설정 화면에는 "약 6배
 *   느려집니다" 같은 강조가 문장 한가운데 박혀 있는데, 그때마다 문장을
 *   앞·강조·뒤 세 키로 쪼개면 번역자가 문장을 볼 수 없게 된다. 어순이
 *   다른 언어에서는 그 조각들이 아예 맞지 않는다.
 */
export function rich(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return text;
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) =>
      i % 2 === 1 ? createElement('strong', { key: i }, part) : part,
    ),
  );
}

/** `useT`의 강조 지원판. 반환값이 문자열이 아니라 노드다. */
export function useRichT(): (key: MessageKey, vars?: Vars) => ReactNode {
  const locale = useLocaleStore((s) => s.locale);
  return (key, vars) => rich(translate(locale, key, vars));
}
