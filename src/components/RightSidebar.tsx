import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Ban, CheckCircle2, ChevronRight, Circle, CircleDot, CircleX, EllipsisVertical, ExternalLink, File, FileCode2, FileImage, FileText, Folder, FolderOpen, Folders, GitBranch, GitCompare, Globe, LockKeyhole, LogOut, MessageCircle, Plus, RefreshCw, Search, SlidersHorizontal, SquareTerminal, Trash2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import hljs from 'highlight.js/lib/common';
import { whatsappContextStore } from '../lib/store';
import TerminalDock from './TerminalDock';
import { readAgentState, writeAgentState, type AgentState, type TaskStatus } from '../lib/engine/planning';
import { LANGUAGE_STORAGE_KEY, browserUiTranslations, rightSidebarTranslations, type AppLanguage } from '../lib/i18n';
import { surfaces } from '../lib/surfaces';

type FileEntry = { path: string; kind: 'file' | 'directory' };
type FileNode = FileEntry & { name: string; children: FileNode[] };
type BrowserDomSelection = {
  title: string;
  text: string;
  html: string;
  url: string;
  selector: string;
  tag: string;
  isMultiSelect?: boolean;
};
type BrowserState = { url: string; title: string; viewport: { width: number; height: number }; text: string; elements: Array<{ id: string; selector: string; role: string; label: string; tag: string; type?: string; disabled: boolean; rect: { x: number; y: number; width: number; height: number } }> };

const sanitizeBrowserText = (value: unknown, max = 6000) => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const sanitizeBrowserSelector = (value: unknown) => {
  const selector = sanitizeBrowserText(value, 500);
  return /^(javascript|data):/i.test(selector) ? '' : selector;
};
const sanitizeBrowserUrl = (value: unknown) => {
  const raw = sanitizeBrowserText(value, 2000);
  try {
    const url = new URL(raw);
    return /^https?:$/i.test(url.protocol) ? url.toString().slice(0, 2000) : '';
  } catch {
    return '';
  }
};
const sanitizeBrowserSelection = (value: BrowserDomSelection): BrowserDomSelection => ({
  title: sanitizeBrowserText(value.title, 240),
  text: sanitizeBrowserText(value.text, 6000),
  html: sanitizeBrowserText(value.html, 4000).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''),
  url: sanitizeBrowserUrl(value.url),
  selector: sanitizeBrowserSelector(value.selector),
  tag: sanitizeBrowserText(value.tag, 40).toLowerCase(),
});

const browserSelectionHash = '#__codeclub_selection=';
const browserHost = (value: string) => {
  try { return new URL(value).hostname.replace(/^www\./i, '') || 'Navegador'; } catch { return 'Navegador'; }
};

const fileLanguageByExtension: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', css: 'css', scss: 'scss', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', md: 'markdown', mdx: 'markdown',
  py: 'python', rs: 'rust', sql: 'sql', sh: 'bash', bash: 'bash', ps1: 'powershell', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  java: 'java', kt: 'kotlin', go: 'go', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
};

const escapeHighlightedText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const highlightFileLines = (content: string, path: string) => {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const language = fileLanguageByExtension[extension];
  return content.split(/\r?\n/).map((line) => {
    if (!line) return ' ';
    try {
      return language && hljs.getLanguage(language) ? hljs.highlight(line, { language, ignoreIllegals: true }).value : escapeHighlightedText(line);
    } catch {
      return escapeHighlightedText(line);
    }
  });
};

const browserStateScript = `(() => {
  const selectorFor = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.getAttribute('data-testid')) part += '[data-testid="' + CSS.escape(node.getAttribute('data-testid')) + '"]';
      const parent = node.parentElement;
      if (parent) { const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName); if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'; }
      parts.unshift(part); node = parent;
    }
    return parts.join(' > ');
  };
  const labelFor = (element) => (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || element.getAttribute('placeholder') || element.id || element.tagName).trim().replace(/\\s+/g, ' ').slice(0, 120);
  const elements = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="combobox"]')).slice(0, 250).map((element, index) => { const rect = element.getBoundingClientRect(); return { id: 'element-' + index, selector: selectorFor(element), role: element.getAttribute('role') || element.tagName.toLowerCase(), label: labelFor(element), tag: element.tagName.toLowerCase(), type: element.getAttribute('type') || undefined, disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }; }).filter((element) => element.rect.width > 0 && element.rect.height > 0);
  const state = { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 12000), elements };
  location.hash = '#__codeclub_selection=' + encodeURIComponent(JSON.stringify({ title: document.title, text: JSON.stringify(state), html: '', url: location.href, selector: '__codeclub_state__', tag: 'document' }));
})()`;

const browserActionScript = (action: { type: string; selector?: string; text?: string; key?: string; amount?: number }) => `(() => {
  const selector = ${JSON.stringify(action.selector || '')};
  const element = selector ? document.querySelector(selector) : document.activeElement;
  const finish = () => { document.getElementById('__codeclub-agent-overlay')?.style.setProperty('display', 'none'); document.getElementById('__codeclub-agent-banner')?.style.setProperty('display', 'none'); document.documentElement.style.removeProperty('cursor'); if (window.__codeclubAgentEscHandler) window.removeEventListener('keydown', window.__codeclubAgentEscHandler, true); };
  const fail = (message) => { finish(); const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; if (typeof invoke === 'function') invoke('codeclub_browser_selection', { selection: { title: message, text: message, html: '', url: location.href, selector: '__codeclub_action_result__', tag: 'action' } }); };
  if (window.__codeclubAgentStop) { fail('Control cancelado con Escape.'); return; }
  if (${JSON.stringify(action.type)} === 'scroll') { window.scrollBy(0, ${Number(action.amount || 600)}); const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; if (typeof invoke === 'function') invoke('codeclub_browser_selection', { selection: { title: 'ok', text: 'Scroll ejecutado.', html: '', url: location.href, selector: '__codeclub_action_result__', tag: 'action' } }); return; }
  if (!element) { fail('No se encontró el elemento indicado.'); return; }
  if (element.disabled || element.getAttribute('aria-disabled') === 'true') { fail('El elemento está deshabilitado.'); return; }
  if (${JSON.stringify(action.type)} === 'move') { finish(); const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; if (typeof invoke === 'function') invoke('codeclub_browser_selection', { selection: { title: 'ok', text: 'Cursor movido al elemento.', html: '', url: location.href, selector: '__codeclub_action_result__', tag: 'action' } }); return; }
  if (${JSON.stringify(action.type)} === 'click') element.click();
  else if (${JSON.stringify(action.type)} === 'type') { element.focus(); const value = ${JSON.stringify(action.text || '')}; if ('value' in element) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set; setter?.call(element, value); } else element.textContent = value; element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); element.dispatchEvent(new Event('change', { bubbles: true })); }
  else if (${JSON.stringify(action.type)} === 'key') { element.focus(); element.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(action.key || 'Enter')}, bubbles: true })); element.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(action.key || 'Enter')}, bubbles: true })); }
  finish(); const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; if (typeof invoke === 'function') invoke('codeclub_browser_selection', { selection: { title: 'ok', text: 'Acción ejecutada.', html: '', url: location.href, selector: '__codeclub_action_result__', tag: 'action' } });
})()`;

const browserAgentOverlayScript = (selector?: string, cursorDataUrl = '', language: 'es' | 'en' = 'es') => `(() => {
  const overlayId = '__codeclub-agent-overlay';
  const bannerId = '__codeclub-agent-banner';
  const cursor = ${JSON.stringify(cursorDataUrl ? `url("${cursorDataUrl}") 4 4, crosshair` : 'crosshair')};
  const overlay = document.getElementById(overlayId) || Object.assign(document.body.appendChild(document.createElement('div')), { id: overlayId });
  const banner = document.getElementById(bannerId) || Object.assign(document.body.appendChild(document.createElement('div')), { id: bannerId });
  Object.assign(overlay.style, { position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid #1687FF', background: 'rgba(22,135,255,.12)', boxShadow: '0 0 0 1px rgba(255,255,255,.35), 0 0 18px rgba(22,135,255,.45)', display: 'none' });
  Object.assign(banner.style, { position: 'fixed', zIndex: '2147483647', top: '12px', left: '50%', transform: 'translateX(-50%)', width: 'min(520px, calc(100% - 32px))', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '0 14px', boxSizing: 'border-box', border: '1px solid rgba(141, 214, 255, 0.72)', borderRadius: '999px', background: 'linear-gradient(105deg, rgba(72, 190, 255, 0.84), rgba(110, 202, 255, 0.76))', color: '#f7fcff', font: '600 13px/1.1 "Segoe UI", sans-serif', textShadow: '0 1px 2px rgba(0, 50, 90, 0.32)', whiteSpace: 'nowrap', boxShadow: '0 0 28px rgba(61, 155, 255, 0.9), 0 0 58px rgba(61, 155, 255, 0.32), 0 8px 26px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.42)' });
  const dot = document.createElement('span'); Object.assign(dot.style, { width: '7px', height: '7px', flex: '0 0 auto', borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px #fff' });
  const label = document.createElement('span'); label.textContent = ${JSON.stringify(language === 'en' ? 'Codeclub is using your browser' : 'Codeclub está usando tu navegador')};
  const separator = document.createElement('span'); separator.textContent = '·'; separator.style.opacity = '0.68';
  const cancel = document.createElement('span'); cancel.textContent = ${JSON.stringify(language === 'en' ? 'Esc to cancel' : 'Esc para cancelar')}; cancel.style.fontWeight = '700';
  banner.replaceChildren(dot, label, separator, cancel);
  document.documentElement.style.cursor = cursor;
  window.__codeclubAgentStop = false;
  const send = (title, text) => { const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; if (typeof invoke === 'function') invoke('codeclub_browser_selection', { selection: { title, text, html: '', url: location.href, selector: '__codeclub_action_result__', tag: 'action' } }); };
  window.__codeclubAgentEscHandler = (event) => { if (event.key !== 'Escape') return; event.preventDefault(); window.__codeclubAgentStop = true; finish(); send('cancelled', 'Control cancelado con Escape.'); };
  window.addEventListener('keydown', window.__codeclubAgentEscHandler, true);
  const element = ${JSON.stringify(selector || '')} ? document.querySelector(${JSON.stringify(selector || '')}) : null;
  if (element) { const rect = element.getBoundingClientRect(); Object.assign(overlay.style, { display: 'block', left: Math.max(0, rect.left) + 'px', top: Math.max(0, rect.top) + 'px', width: Math.max(0, rect.width) + 'px', height: Math.max(0, rect.height) + 'px' }); }
})()`;

const browserInspectorScript = (active: boolean, cursorDataUrl = '') => {
  const cursor = cursorDataUrl ? `url("${cursorDataUrl}") 4 4, crosshair` : 'crosshair';
  return `(() => {
    const active = ${active ? 'true' : 'false'};
    const root = document.documentElement;
    const overlayId = '__codeclub-dom-overlay';
    const styleId = '__codeclub-dom-style';
    const activeAttribute = 'data-codeclub-inspect';
    let hovered = null;
    let selected = null;

    const ensureStyle = () => {
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        style.textContent =
          'html[' + activeAttribute + '="true"], html[' + activeAttribute + '="true"] * { cursor: ${cursor} !important; }' +
          'html[' + activeAttribute + '="true"] body *:hover:not(:has(*:hover)):not(#' + overlayId + '):not(#' + overlayId + ' *) { outline: 2px solid #1687FF !important; outline-offset: -2px !important; box-shadow: inset 0 0 0 9999px rgba(22, 135, 255, .10) !important; }' +
          '#' + overlayId + ' { position: fixed; display: none; pointer-events: none; box-sizing: border-box; border: 2px solid #1687FF; background: rgba(22, 135, 255, .10); z-index: 2147483647; }';
        (document.head || root).appendChild(style);
      }
    };

    const ensureOverlay = () => {
      let overlay = document.getElementById(overlayId);
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.setAttribute('aria-hidden', 'true');
        (document.body || root).appendChild(overlay);
      }
      return overlay;
    };

    const placeOverlay = (element) => {
      if (!(element instanceof Element)) return;
      const rect = element.getBoundingClientRect();
      const overlay = ensureOverlay();
      if (rect.width < 1 || rect.height < 1) {
        overlay.style.display = 'none';
        return;
      }
      overlay.style.display = 'block';
      overlay.style.left = Math.max(0, rect.left) + 'px';
      overlay.style.top = Math.max(0, rect.top) + 'px';
      overlay.style.width = Math.min(rect.width, innerWidth - Math.max(0, rect.left)) + 'px';
      overlay.style.height = Math.min(rect.height, innerHeight - Math.max(0, rect.top)) + 'px';
    };

    const setActive = (next) => {
      window.__codeclubInspect = next;
      if (next) {
        selected = null;
        ensureStyle();
        root.setAttribute(activeAttribute, 'true');
        ensureOverlay().style.display = 'none';
      } else {
        root.removeAttribute(activeAttribute);
        if (!selected) ensureOverlay().style.display = 'none';
      }
    };

    window.__codeclubSetInspectMode = setActive;
    setActive(active);
    if (window.__codeclubInspectorInstalled) return;
    window.__codeclubInspectorInstalled = true;

    const eventElement = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const target = path[0] || event.target;
      return target instanceof Element && !target.closest('#' + overlayId) ? target : null;
    };

    const selectorFor = (element) => {
      const parts = [];
      let node = element;
      while (node && node.nodeType === 1 && parts.length < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          const escaped = window.CSS?.escape ? CSS.escape(node.id) : node.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
          parts.unshift(part + '#' + escaped);
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    const elementTitle = (element) => {
      const text = (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ');
      return (text || element.id || element.tagName.toLowerCase()).slice(0, 90);
    };

    const sendSelection = (payload) => {
      const fallback = () => {
        const encoded = encodeURIComponent(JSON.stringify(payload));
        history.replaceState(history.state, '', location.pathname + location.search + '${browserSelectionHash}' + encoded);
      };
      try {
        const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
        if (typeof invoke !== 'function') {
          fallback();
          return;
        }
        Promise.resolve(invoke('codeclub_browser_selection', { selection: payload })).catch(fallback);
      } catch (_) {
        fallback();
      }
    };

    const previewElement = (event) => {
      if (!window.__codeclubInspect) return;
      const element = eventElement(event);
      if (!element) return;
      hovered = element;
      placeOverlay(element);
    };
    ['pointerover', 'pointermove', 'mouseover', 'mousemove'].forEach((name) => {
      document.addEventListener(name, previewElement, true);
    });

    const block = (event) => {
      if (!window.__codeclubInspect) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'contextmenu', 'dblclick', 'submit'].forEach((name) => {
      document.addEventListener(name, block, true);
    });

    document.addEventListener('click', (event) => {
      if (!window.__codeclubInspect) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = eventElement(event);
      if (!element) return;
      selected = element;
      hovered = element;
      placeOverlay(element);
      const payload = {
        title: elementTitle(element),
        text: (element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 3000),
        html: element.outerHTML.slice(0, 6000),
        url: location.href,
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase()
      };
      setActive(false);
      sendSelection(payload);
    }, true);

    const refreshOverlay = () => {
      if (window.__codeclubInspect && hovered) placeOverlay(hovered);
      else if (selected) placeOverlay(selected);
    };
    addEventListener('scroll', refreshOverlay, true);
    addEventListener('resize', refreshOverlay);
  })();`;
};

const buildTree = (entries: FileEntry[]) => {
  const roots: FileNode[] = [];
  const nodes = new Map<string, FileNode>();
  const sorted = entries.slice().sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let parent: FileNode | undefined;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let node = nodes.get(path);
      if (!node) {
        node = { path, name: part, kind: index === parts.length - 1 ? entry.kind : 'directory', children: [] };
        nodes.set(path, node);
        (parent ? parent.children : roots).push(node);
      }
      parent = node;
    });
  }
  const sortNodes = (items: FileNode[]) => {
    items.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
};

const iconForFile = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (name === '.env' || name.startsWith('.env.')) return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><LockKeyhole size={15} className="text-[#e6c35c]" /></span>;
  if (name === '.gitignore') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><GitBranch size={16} className="text-[#ef623b]" /></span>;
  if (extension === 'md') return <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[11px] font-bold leading-none text-[#4fda73]">M↓</span>;
  if (extension === 'js' || extension === 'jsx') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span className="rounded bg-[#62551a] px-0.5 text-[8px] font-bold text-[#f6d84a]">JS</span></span>;
  if (extension === 'ts' || extension === 'tsx' || extension === 'mjs' || extension === 'cjs') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span className="rounded bg-[#245b73] px-0.5 text-[8px] font-bold text-[#8bd5ff]">TS</span></span>;
  if (extension === 'json' || extension === 'jsonc') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#f5de19" d="M4.014 14.976a2.5 2.5 0 0 0 1.567-.518a2.38 2.38 0 0 0 .805-1.358a15.3 15.3 0 0 0 .214-2.944q.012-2.085.075-2.747a5.2 5.2 0 0 1 .418-1.686a3 3 0 0 1 .755-1.018A3.05 3.05 0 0 1 9 4.125A6.8 6.8 0 0 1 10.544 4h.7v1.96h-.387a2.34 2.34 0 0 0-1.723.468a3.4 3.4 0 0 0-.425 2.092a36 36 0 0 1-.137 4.133a4.7 4.7 0 0 1-.768 2.06A4.6 4.6 0 0 1 6.1 16a3.8 3.8 0 0 1 1.992 1.754a8.9 8.9 0 0 1 .618 3.865q0 2.435.05 2.9a1.76 1.76 0 0 0 .504 1.181a2.64 2.64 0 0 0 1.592.337h.387V28h-.7a6.8 6.8 0 0 1-1.544-.125a3.05 3.05 0 0 1-1.149-.581a3 3 0 0 1-.755-1.018a5.2 5.2 0 0 1-.418-1.686q-.062-.662-.075-2.747a15.3 15.3 0 0 0-.214-2.944a2.38 2.38 0 0 0-.805-1.358a2.5 2.5 0 0 0-1.567-.518Zm23.972 2.035a2.5 2.5 0 0 0-1.567.524a2.4 2.4 0 0 0-.805 1.361a16.5 16.5 0 0 0-.212 3.109a24 24 0 0 1-.169 3.234a3.35 3.35 0 0 1-.681 1.63a2.97 2.97 0 0 1-1.324.93a5.7 5.7 0 0 1-1.773.2h-.7V26.04h.387a2.64 2.64 0 0 0 1.592-.337a1.76 1.76 0 0 0 .506-1.186q.05-.462.05-2.9a8.9 8.9 0 0 1 .618-3.865A3.8 3.8 0 0 1 25.9 16a4.6 4.6 0 0 1-1.7-1.286a4.7 4.7 0 0 1-.768-2.06a36 36 0 0 1-.137-4.133a3.4 3.4 0 0 0-.425-2.092a2.34 2.34 0 0 0-1.723-.468h-.387V4h.7a6.8 6.8 0 0 1 1.54.125a3.05 3.05 0 0 1 1.149.581a3 3 0 0 1 .755 1.018a5.2 5.2 0 0 1 .418 1.686q.062.662.075 2.747a15.3 15.3 0 0 1-.212 3.109a2.38 2.38 0 0 1-.805 1.355a2.5 2.5 0 0 1-1.567.518Z" /></svg></span>;
  if (extension === 'html' || extension === 'htm') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#e44d26" d="M1.5 0h21l-1.9 21.5L12 24l-8.6-2.5L1.5 0Z" /><path fill="#f16529" d="M12 2v20.2l7-2 1.6-18.2H12Z" /><path fill="#fff" d="M12 6.2H5.5l.1 1.3.7 7.1H12v-2.4H8.5l-.2-2.4H12V6.2Zm0 11.3-3-.8-.2-2.4H6.5l.4 4.2 5.1 1.4v-2.4Z" /><path fill="#ebebeb" d="M12 6.2v2.4h3.6l-.2 2.4H12v2.4h5.5l.1-1.3.7-7.1H12Zm0 8.1v2.4l3-.8-.2-1.6H12Z" /></svg></span>;
  if (extension === 'xml' || extension === 'svg') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileCode2 size={16} className="text-[#f28c5b]" /></span>;
  if (extension === 'css' || extension === 'scss' || extension === 'sass' || extension === 'less') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileCode2 size={16} className="text-[#6ab7ff]" /></span>;
  if (extension === 'txt' || extension === 'log' || extension === 'csv') return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileText size={16} className="text-[#b8b8b8]" /></span>;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(extension)) return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileImage size={16} className="text-[#c084fc]" /></span>;
  const languageLabels: Record<string, string> = {
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX', py: 'PY', rb: 'RB', php: 'PHP', java: 'JAVA', kt: 'KT', kts: 'KT', swift: 'SW',
    rs: 'RS', go: 'GO', c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++', cs: 'C#', fs: 'F#', fsx: 'F#', vb: 'VB', scala: 'SC', dart: 'DART', lua: 'LUA', r: 'R', jl: 'JL',
    ex: 'EX', exs: 'EXS', erl: 'ERL', hrl: 'ERL', clj: 'CLJ', cljs: 'CLJS', hs: 'HS', lhs: 'HS', ml: 'ML', mli: 'MLI', sql: 'SQL', sh: 'SH', bash: 'SH', zsh: 'SH', fish: 'SH',
    ps1: 'PS', psm1: 'PS', bat: 'BAT', cmd: 'CMD', pl: 'PL', pm: 'PL', groovy: 'GR', pas: 'PAS', asm: 'ASM', s: 'ASM', zig: 'ZIG', nim: 'NIM', cr: 'CR', sol: 'SOL',
  };
  const languageColors: Record<string, string> = { js: '#f6d84a', jsx: '#61dafb', ts: '#6ab7ff', tsx: '#6ab7ff', py: '#6aa84f', rb: '#d45b64', php: '#b39ddb', java: '#e58b63', kt: '#c084fc', swift: '#f28c5b', rs: '#d9a066', go: '#72c7d6', cs: '#9bd36a', dart: '#55c2e8', lua: '#7b9fe8', sql: '#d6a85c', sh: '#8fd18a', ps1: '#6ab7ff', zig: '#f0a35b', sol: '#9b9b9b' };
  const label = languageLabels[extension];
  if (label) return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><span title={extension} className="text-[7px] font-bold leading-none" style={{ color: languageColors[extension] || '#d9a066' }}>{label}</span></span>;
  return <span className="flex h-4 w-4 shrink-0 items-center justify-center"><File size={16} className="text-[#a8a8a8]" /></span>;
};

function FilesView({ projectPath }: { projectPath: string }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [showTree, setShowTree] = useState(false);
  const [topbarCoolingDown, setTopbarCoolingDown] = useState(false);
  const topbarCooldownRef = useRef<number | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeScrollTopRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  useEffect(() => () => {
    if (topbarCooldownRef.current !== null) window.clearTimeout(topbarCooldownRef.current);
  }, []);

  const toggleTree = () => {
    if (topbarCoolingDown) return;
    setShowTree((visible) => !visible);
    setTopbarCoolingDown(true);
    topbarCooldownRef.current = window.setTimeout(() => {
      setTopbarCoolingDown(false);
      topbarCooldownRef.current = null;
    }, 1000);
  };

  const loadFiles = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await invoke<FileEntry[]>('codeclub_list_files', { projectPath, maxFiles: 1200 });
      setEntries(result);
      // Un proyecto grande puede contener miles de carpetas (por ejemplo node_modules).
      // Mantenerlas cerradas evita montar todo el árbol de golpe y conserva el layout.
      setExpanded(new Set());
      setError('');
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setSelectedPath('');
    setSelectedContent('');
    setQuery('');
    treeScrollTopRef.current = 0;
    void loadFiles();
  }, [projectPath]);

  useEffect(() => {
    const refreshWorkspace = (event: Event) => {
      const changedProjectPath = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      if (!changedProjectPath || changedProjectPath === projectPath) void loadFiles();
    };
    window.addEventListener('codeclub:workspace-changed', refreshWorkspace);
    const interval = window.setInterval(() => void loadFiles(), 2500);
    return () => {
      window.removeEventListener('codeclub:workspace-changed', refreshWorkspace);
      window.clearInterval(interval);
    };
  }, [projectPath]);

  useEffect(() => {
    if (treeScrollRef.current) treeScrollRef.current.scrollTop = treeScrollTopRef.current;
  });

  const openFile = async (path: string) => {
    if (!projectPath) return;
    setSelectedPath(path);
    setFileLoading(true);
    try {
      setSelectedContent(await invoke<string>('codeclub_read_file', { projectPath, path }));
    } catch (reason) {
      setSelectedContent(`No se pudo abrir el archivo:\n${String(reason)}`);
    } finally { setFileLoading(false); }
  };

  const tree = useMemo(() => buildTree(entries), [entries]);
  const highlightedFileLines = useMemo(() => highlightFileLines(selectedContent, selectedPath), [selectedContent, selectedPath]);
  const matches = (node: FileNode) => !query.trim() || node.path.toLowerCase().includes(query.trim().toLowerCase());
  const renderTree = (nodes: FileNode[], depth = 0): React.ReactNode => nodes.filter((node) => matches(node) || node.children.some((child) => matches(child))).map((node) => {
    const isOpen = expanded.has(node.path) || Boolean(query.trim());
    const isDirectory = node.kind === 'directory';
    return <React.Fragment key={node.path}>
      <button type="button" onClick={() => isDirectory ? setExpanded((current) => { const next = new Set(current); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; }) : void openFile(node.path)} className={`grid min-h-[30px] w-max min-w-full grid-cols-[16px_20px_minmax(0,1fr)] items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-[12px] transition-colors hover:bg-white/[0.04] ${selectedPath === node.path ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'text-[#eeeeee]'}`} style={{ paddingLeft: `${8 + depth * 28}px` }}>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#8b8b8b]">{isDirectory && <ChevronRight size={15} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />}</span>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">{isDirectory ? (isOpen ? <FolderOpen size={15} className="text-[#c8c8c8]" /> : <Folder size={15} className="text-[#c8c8c8]" />) : iconForFile(node.name)}</span>
        <span className="whitespace-nowrap">{node.name}</span>
      </button>
      {isDirectory && isOpen && <div className="relative"><span className="pointer-events-none absolute bottom-0 top-0 border-l border-[#2b2b2b]" style={{ left: `${8 + depth * 28}px` }} />{renderTree(node.children, depth + 1)}</div>}
    </React.Fragment>;
  });

  return <div className="flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#1A1A1A]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#1A1A1A] px-2">
      <span className="min-w-0 truncate text-[12px] leading-none text-[#eeeeee]">{selectedPath ? `/${selectedPath.replace(/\\/g, '/')}` : '/'}</span>
      <button type="button" onClick={toggleTree} disabled={topbarCoolingDown} className={`grid h-7 w-7 place-items-center rounded-[7px] border-0 transition-[background-color,color,transform] duration-700 ease-out active:scale-95 disabled:cursor-wait disabled:opacity-60 ${showTree ? 'bg-[#2B2B2B] text-[#eeeeee]' : 'bg-[#202020] text-[#777777]'} hover:bg-[#2B2B2B] hover:text-[#eeeeee]`} title={text.toggleTree} aria-label={text.toggleTree} aria-pressed={showTree}><FolderOpen size={15} /></button>
    </div>
    <div className="flex h-0 min-h-0 max-h-full flex-1 overflow-hidden">
      <main className="flex h-full min-w-0 min-h-0 flex-1 flex-col bg-[#1A1A1A]">
        {selectedPath ? <div className="flex min-h-0 flex-1 flex-col">{fileLoading ? <div className="flex flex-1 items-center justify-center text-xs text-[#777777]">{text.loadingFile}</div> : <pre className="file-preview-scrollbar m-0 min-h-0 flex-1 overflow-auto whitespace-pre p-4 font-mono text-[12px] leading-5 text-[#d8d8d8]"><code className="codeclub-file-code">{highlightedFileLines.map((line, index) => <span key={index} className="codeclub-file-line flex min-w-max"><span className="mr-4 w-10 shrink-0 select-none text-right text-[#555555]">{index + 1}</span><span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: line }} /></span>)}</code></pre>}</div> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><Folders size={42} strokeWidth={1.5} className="text-[#a7a7a7]" /><div className="max-w-[300px]"><p className="m-0 text-[18px] font-semibold text-[#eeeeee]">{text.openFile}</p><p className="m-0 mt-2 text-[14px] leading-5 text-[#a7a7a7]">{text.selectFile}</p></div></div>}
      </main>
      <aside className={`h-full max-h-full min-h-0 self-stretch flex shrink-0 flex-col border-l border-[#2b2b2b] bg-[#1A1A1A] transition-[width,transform,opacity] duration-200 ease-out ${showTree ? 'w-[35%]' : 'w-0 translate-x-full opacity-0 pointer-events-none'}`}>
        <div className="mt-0 flex h-0 min-h-0 flex-1 flex-col px-3 py-3">
          <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[10px] border border-[#353535] bg-[#1d1d1d] px-2.5 text-[#9a9a9a] focus-within:border-[#555555]"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] text-[#eeeeee] outline-none placeholder:text-[#929292]" placeholder={text.filterFiles} aria-label={text.filterFiles} /></label>
          <div ref={treeScrollRef} onScroll={(event) => { treeScrollTopRef.current = event.currentTarget.scrollTop; }} style={{ overscrollBehavior: 'none', overflowAnchor: 'none' }} className="h-0 min-h-0 flex-1 overflow-x-auto overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {loading ? <div className="p-3 text-sm text-[#777777]">{text.loadingFiles}</div> : error ? <div className="p-3 text-sm text-[#c28d8d]">{error}</div> : tree.length ? renderTree(tree) : <div className="p-3 text-sm text-[#777777]">{text.noFiles}</div>}
          </div>
        </div>
      </aside>
    </div>
    <style>{`.codeclub-file-code .hljs-comment, .codeclub-file-code .hljs-quote { color: #7f8c98; font-style: italic; } .codeclub-file-code .hljs-keyword, .codeclub-file-code .hljs-selector-tag, .codeclub-file-code .hljs-literal, .codeclub-file-code .hljs-section { color: #c792ea; } .codeclub-file-code .hljs-string, .codeclub-file-code .hljs-attr, .codeclub-file-code .hljs-template-variable { color: #c3e88d; } .codeclub-file-code .hljs-number, .codeclub-file-code .hljs-variable, .codeclub-file-code .hljs-regexp { color: #f78c6c; } .codeclub-file-code .hljs-title, .codeclub-file-code .hljs-title.function_, .codeclub-file-code .hljs-function .hljs-title { color: #82aaff; } .codeclub-file-code .hljs-built_in, .codeclub-file-code .hljs-type, .codeclub-file-code .hljs-class .hljs-title { color: #ffcb6b; } .codeclub-file-code .hljs-meta, .codeclub-file-code .hljs-symbol { color: #89ddff; }`}</style>
  </div>;
}

type ReviewFile = {
  path: string;
  status: string;
  diff: string;
  additions: number;
  deletions: number;
};

type CommandResult = { code?: number | null; stdout: string; stderr: string };

const reviewStatusLabel = (status: string, text: typeof rightSidebarTranslations.es = rightSidebarTranslations.es) => {
  if (status.includes('?')) return { label: 'U', title: text.untracked, color: '#c8a96b' };
  if (status.includes('D')) return { label: 'D', title: text.deleted, color: '#d77878' };
  if (status.includes('R')) return { label: 'R', title: text.renamed, color: '#c084fc' };
  if (status.includes('A')) return { label: 'A', title: text.added, color: '#76c893' };
  return { label: 'M', title: text.modified, color: '#7ab7e8' };
};

const parseReviewStatus = (output: string) => output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() || rawPath : rawPath;
  return { path: path.replace(/^"|"$/g, ''), status };
});

const parseReviewDiff = (output: string) => {
  const sections: Array<{ path: string; diff: string; additions: number; deletions: number }> = [];
  let current: { path: string; lines: string[]; additions: number; deletions: number } | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push({ path: current.path, diff: current.lines.join('\n'), additions: current.additions, deletions: current.deletions });
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = { path: match?.[2] || line.replace(/^diff --git /, ''), lines: [], additions: 0, deletions: 0 };
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  if (current) sections.push({ path: current.path, diff: current.lines.join('\n'), additions: current.additions, deletions: current.deletions });
  return sections;
};

function ReviewView({ projectPath }: { projectPath: string }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [topbarCoolingDown, setTopbarCoolingDown] = useState(false);
  const topbarCooldownRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  useEffect(() => () => {
    if (topbarCooldownRef.current !== null) window.clearTimeout(topbarCooldownRef.current);
  }, []);

  const runTopbarAction = (action: () => void | Promise<void>) => {
    if (topbarCoolingDown) return;
    setTopbarCoolingDown(true);
    try {
      Promise.resolve(action()).finally(() => {
        topbarCooldownRef.current = window.setTimeout(() => {
          setTopbarCoolingDown(false);
          topbarCooldownRef.current = null;
        }, 1000);
      });
    } catch {
      topbarCooldownRef.current = window.setTimeout(() => {
        setTopbarCoolingDown(false);
        topbarCooldownRef.current = null;
      }, 1000);
    }
  };

  const loadReview = async () => {
    if (!projectPath) { setFiles([]); setSelectedPath(''); return; }
    setLoading(true);
    setError('');
    try {
      const statusResult = await invoke<CommandResult>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['status', '--short', '--untracked-files=all'] } });
      if (statusResult.code !== 0 && !statusResult.stdout.trim()) throw new Error(statusResult.stderr || 'El proyecto no tiene un repositorio Git.');
      const statusEntries = parseReviewStatus(statusResult.stdout);
      const diffResult = await invoke<CommandResult>('codeclub_run_command', { projectPath, request: { command: 'git', args: ['diff', 'HEAD', '--no-ext-diff', '--unified=3', '--'] } });
      const diffEntries = parseReviewDiff(diffResult.stdout);
      const diffByPath = new Map(diffEntries.map((entry) => [entry.path.replace(/^b\//, ''), entry]));
      const nextFiles: ReviewFile[] = [];
      for (const entry of statusEntries) {
        const path = entry.path.replace(/^b\//, '');
        const diff = diffByPath.get(path);
        if (diff) {
          nextFiles.push({ path, status: entry.status, diff: diff.diff, additions: diff.additions, deletions: diff.deletions });
          diffByPath.delete(path);
          continue;
        }
        if (entry.status.includes('?')) {
          try {
            const content = await invoke<string>('codeclub_read_file', { projectPath, path });
            const lines = content.split(/\r?\n/);
            const syntheticDiff = [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
            nextFiles.push({ path, status: entry.status, diff: syntheticDiff, additions: lines.length, deletions: 0 });
          } catch { nextFiles.push({ path, status: entry.status, diff: '', additions: 0, deletions: 0 }); }
        } else nextFiles.push({ path, status: entry.status, diff: '', additions: 0, deletions: 0 });
      }
      for (const diff of diffByPath.values()) nextFiles.push({ path: diff.path, status: ' M', diff: diff.diff, additions: diff.additions, deletions: diff.deletions });
      setFiles(nextFiles);
      setSelectedPath((current) => nextFiles.some((file) => file.path === current) ? current : nextFiles[0]?.path || '');
    } catch (reason) { setError(String(reason)); setFiles([]); setSelectedPath(''); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void loadReview();
    const refresh = (event: Event) => {
      const changedProject = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      if (!changedProject || changedProject === projectPath) void loadReview();
    };
    window.addEventListener('codeclub:workspace-changed', refresh);
    window.addEventListener('codeclub:artifacts-changed', refresh);
    return () => {
      window.removeEventListener('codeclub:workspace-changed', refresh);
      window.removeEventListener('codeclub:artifacts-changed', refresh);
    };
  }, [projectPath]);

  const selected = files.find((file) => file.path === selectedPath) || files[0];
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  if (!projectPath) return <div className="flex flex-1 items-center justify-center p-5 text-center text-[11px] text-[#777]">{text.selectProjectReview}</div>;
  return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#1A1A1A]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] px-2 [&>div:first-child]:hidden">
      <div className="flex min-w-0 items-center gap-2"><GitCompare size={14} className="shrink-0 text-[#a7a7a7]" /><div className="min-w-0"><div className="truncate text-[12px] text-[#eeeeee]">{text.changes}</div><div className="text-[10px] text-[#666]">{files.length} {files.length === 1 ? text.file : text.filesCount} · <span className="text-[#76c893]">+{additions}</span> <span className="text-[#d77878]">-{deletions}</span></div></div></div>
      <span className="min-w-0 truncate text-[12px] leading-none text-[#eeeeee]">{files.length} {files.length === 1 ? 'archivo' : 'archivos'} · <span className="text-[#76c893]">+{additions}</span> <span className="text-[#d77878]">-{deletions}</span></span>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => runTopbarAction(() => setShowFiles((visible) => !visible))} disabled={topbarCoolingDown} className={`grid h-7 w-7 place-items-center rounded-[7px] border-0 transition-[background-color,color,transform] duration-700 ease-out active:scale-95 disabled:cursor-wait disabled:opacity-60 ${showFiles ? 'bg-[#2B2B2B] text-[#eeeeee]' : 'bg-[#202020] text-[#777777]'} hover:bg-[#2B2B2B] hover:text-[#eeeeee]`} title={text.toggleFiles} aria-label={text.toggleFiles} aria-pressed={showFiles}><FileText size={13} /></button>
        <button type="button" onClick={() => runTopbarAction(() => loadReview())} disabled={loading || topbarCoolingDown} className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border-0 transition-[background-color,color,transform] duration-700 ease-out active:scale-95 disabled:cursor-wait disabled:opacity-60 ${loading || topbarCoolingDown ? 'bg-[#2B2B2B] text-[#eeeeee]' : 'bg-[#202020] text-[#777777]'} hover:bg-[#2B2B2B] hover:text-[#eeeeee]`} title={text.refreshChanges} aria-label={text.refreshChanges}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </div>
    {loading ? <div className="flex flex-1 items-center justify-center text-[11px] text-[#777]">{text.reviewing}</div> : error ? <div className="p-3 text-[11px] leading-5 text-[#c28d8d]">{error}</div> : !files.length ? <div className="flex flex-1 flex-col items-center justify-center gap-2 p-5 text-center text-[11px] text-[#777]"><GitCompare size={28} strokeWidth={1.5} /><span>{text.noPendingChanges}</span></div> : <div className="flex min-h-0 flex-1 flex-row-reverse overflow-hidden">
      <div className={`file-preview-scrollbar h-full w-[38%] min-w-[112px] shrink-0 overflow-y-auto border-l border-[#2b2b2b] p-1.5 ${showFiles ? '' : 'hidden'}`}>
        {files.map((file) => { const status = reviewStatusLabel(file.status); return <button key={file.path} type="button" onClick={() => setSelectedPath(file.path)} className={`flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-[#1c1c1c] ${selected?.path === file.path ? 'bg-[#1e1e1e]' : ''}`} title={file.path}><div className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-[10px] font-semibold" style={{ color: status.color }}>{status.label}</span><span className="truncate text-[10px] text-[#d8d8d8]">{file.path.split(/[\\/]/).pop()}</span></div><div className="truncate pl-[17px] text-[9px] text-[#666]">{/[/\\]/.test(file.path) ? file.path : status.title} <span className="text-[#76c893]">+{file.additions}</span> <span className="text-[#d77878]">-{file.deletions}</span></div></button>; })}
      </div>
      <div className="file-preview-scrollbar min-w-0 flex-1 overflow-auto bg-[#101010] p-2">
        <div className="mb-2 truncate px-1 text-[10px] text-[#999]" title={selected?.path}>{selected?.path}</div>
        {selected?.diff ? <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[10px] leading-[1.55]">{selected.diff.split('\n').map((line, index) => <span key={`${index}-${line}`} className={`block -mx-2 px-2 ${line.startsWith('+') && !line.startsWith('+++') ? 'bg-[#16351f] text-[#a6e3b4]' : line.startsWith('-') && !line.startsWith('---') ? 'bg-[#3b1d22] text-[#f0a8ae]' : line.startsWith('@@') ? 'text-[#8fb9d8]' : 'text-[#b9b9b9]'}`}>{line || ' '}</span>)}</pre> : <div className="p-1 text-[10px] text-[#777]">{text.noDiff}</div>}
      </div>
    </div>}
  </div>;
}

function BrowserToolbar({
  address,
  onAddressChange,
  onSubmit,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onReload,
  onInspect,
  onReference,
  inspectMode,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onReload: () => void;
  onInspect: () => void;
  onReference: () => void;
  inspectMode: boolean;
}) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const host = address.replace(/^https?:\/\//i, '').split('/')[0] || address;

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  const focusAddress = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  return <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[#242424] bg-[#1A1A1A] px-2">
    <button type="button" onClick={onBack} disabled={!canGoBack} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] transition-colors hover:bg-[#242424] hover:text-[#ddd] disabled:opacity-30" title={text.back}><ArrowLeft size={16} strokeWidth={1.7} /></button>
    <button type="button" onClick={onForward} disabled={!canGoForward} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] transition-colors hover:bg-[#242424] hover:text-[#ddd] disabled:opacity-30" title={text.forward}><ArrowRight size={16} strokeWidth={1.7} /></button>
    <button type="button" onClick={onReload} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#888] transition-colors hover:bg-[#242424] hover:text-[#ddd]" title={text.reload}><RefreshCw size={16} strokeWidth={1.7} /></button>
    <div onClick={focusAddress} className={`group/address relative flex h-8 min-w-0 flex-1 items-center justify-center rounded-[11px] border px-2.5 transition-colors ${focused ? 'border-[#343434] bg-[#242424]' : 'border-transparent hover:border-[#303030] hover:bg-[#292929]'}`}>
      <SlidersHorizontal size={14} strokeWidth={1.6} onClick={(event) => { event.stopPropagation(); onInspect(); }} className={`absolute left-2.5 z-10 cursor-pointer text-[#8a8a8a] transition-colors hover:text-[#d6d6d6] ${inspectMode ? 'text-[#d6d6d6]' : ''}`} title={text.selectElement} />
      <span className={`pointer-events-none truncate text-[13px] text-[#e4e4e4] transition-opacity ${focused ? 'opacity-0' : 'opacity-100'}`}>{host}</span>
      <form className="absolute inset-0 flex items-center px-8" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <input ref={inputRef} value={address} onChange={(event) => onAddressChange(event.target.value)} onFocus={(event) => { setFocused(true); event.currentTarget.select(); }} onBlur={() => setFocused(false)} className={`min-w-0 flex-1 bg-transparent text-center text-[13px] text-[#eeeeee] outline-none transition-opacity ${focused ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} aria-label={text.webAddress} />
      </form>
      <button type="button" onClick={(event) => { event.stopPropagation(); onReference(); }} className={`absolute right-2 grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent text-[#999] transition-colors hover:bg-[#333] hover:text-[#eee] ${focused ? 'opacity-100' : 'opacity-0 group-hover/address:opacity-100'}`} title={text.referencePage}><ArrowUpRight size={15} strokeWidth={1.7} /></button>
    </div>
    <button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#888] transition-colors hover:bg-[#242424] hover:text-[#ddd]" title={text.moreOptions}><EllipsisVertical size={16} strokeWidth={1.7} /></button>
  </div>;
}

function NativeBrowserView({ initialUrl = 'https://www.google.com' }: { initialUrl?: string }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const [address, setAddress] = useState(initialUrl);
  const [history, setHistory] = useState([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [error, setError] = useState('');
  const [inspectMode, setInspectMode] = useState(false);
  const [selection, setSelection] = useState<BrowserDomSelection | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const requestRef = useRef(0);
  const inspectModeRef = useRef(false);
  const addressRef = useRef(initialUrl);
  const historyIndexRef = useRef(0);
  const selectionKeyRef = useRef('');
  const browserCursorDataUrlRef = useRef('');
  const browserStateRef = useRef<BrowserState | null>(null);
  const navigationPollInFlightRef = useRef(false);
  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);
  useEffect(() => { inspectModeRef.current = inspectMode; }, [inspectMode]);
  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  const getBrowserCursorDataUrl = async () => {
    if (browserCursorDataUrlRef.current) return browserCursorDataUrlRef.current;
    try {
      const response = await fetch('/cursors/dark/arrow.cur', { cache: 'force-cache' });
      if (!response.ok) return '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      browserCursorDataUrlRef.current = `data:image/x-icon;base64,${btoa(binary)}`;
      return browserCursorDataUrlRef.current;
    } catch {
      return '';
    }
  };

  const requestBrowserState = () => new Promise<BrowserState | null>((resolve) => {
    let timer: number | undefined;
    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('codeclub:browser-state', handleState);
    };
    const handleState = (event: Event) => {
      cleanup();
      const state = (event as CustomEvent<BrowserState>).detail || null;
      if (state) browserStateRef.current = state;
      resolve(state);
    };
    window.addEventListener('codeclub:browser-state', handleState, { once: true });
    timer = window.setTimeout(() => { cleanup(); resolve(null); }, 5000);
    window.dispatchEvent(new CustomEvent('codeclub:browser-state-request'));
  });

  const moveBrowserCursor = async (selector?: string) => {
    const state = (await requestBrowserState()) || browserStateRef.current;
    const target = state?.elements.find((element) => element.selector === selector);
    let host = hostRef.current?.getBoundingClientRect();
    for (let attempt = 0; attempt < 8 && (!host || host.width < 1 || host.height < 1); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      host = hostRef.current?.getBoundingClientRect();
    }
    if (!target) return { ok: false, error: 'No se pudo ubicar el elemento indicado en el estado actual del navegador.' };
    if (!host || host.width < 1 || host.height < 1) return { ok: false, error: 'El panel del navegador todavía no tiene un área visible para mover el cursor.' };
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      const [position, scaleFactor] = await Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()]);
      const x = Math.round(position.x + (host.left + target.rect.x + target.rect.width / 2) * scaleFactor);
      const y = Math.round(position.y + (host.top + target.rect.y + target.rect.height / 2) * scaleFactor);
      await invoke('codeclub_computer_action', { request: { action: 'move', x, y } });
      return { ok: true, x, y };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };

  const installInspector = async (active: boolean) => {
    try {
      const cursorDataUrl = await getBrowserCursorDataUrl();
      await surfaces.browser.evaluate(browserInspectorScript(active, cursorDataUrl));
      setError('');
    } catch (reason) {
      setError(String(reason));
    }
  };

  const applySelection = (next: BrowserDomSelection) => {
    if (next.selector === '__codeclub_state__') {
      try { window.dispatchEvent(new CustomEvent('codeclub:browser-state', { detail: JSON.parse(next.text) as BrowserState })); } catch { /* Estado inválido: el agente recibirá timeout. */ }
      return;
    }
    if (next.selector === '__codeclub_action_result__') {
      window.dispatchEvent(new CustomEvent('codeclub:browser-action-result', { detail: { ok: next.title === 'ok', message: next.text } }));
      return;
    }
    const safe = sanitizeBrowserSelection(next);
    if (!safe.url || !safe.selector) return;
    const key = `${safe.url}|${safe.selector}|${safe.html.slice(0, 80)}`;
    if (selectionKeyRef.current === key) return;
    selectionKeyRef.current = key;
    inspectModeRef.current = false;
    setInspectMode(false);
    setSelection(safe);
    window.dispatchEvent(new CustomEvent('codeclub:browser-reference', {
      detail: {
        title: safe.title || safe.selector || text.selectedElement,
        text: JSON.stringify({
          source: 'browser-selection',
          trust: 'untrusted-data',
          url: safe.url,
          selector: safe.selector,
          tag: safe.tag,
          text: safe.text,
          html: safe.html,
        }),
      },
    }));
  };

  const getBrowserBounds = async () => {
    const host = hostRef.current;
    const rect = host?.getBoundingClientRect();
    if (!host || !rect || rect.width <= 0 || rect.height <= 0) return null;
    try {
      const appWindow = getCurrentWindow();
      const [innerSize, scaleFactor] = await Promise.all([appWindow.innerSize(), appWindow.scaleFactor()]);
      const logicalWidth = innerSize.width / scaleFactor;
      const logicalHeight = innerSize.height / scaleFactor;
      const left = Math.max(0, Math.min(rect.left, logicalWidth));
      const top = Math.max(0, Math.min(rect.top, logicalHeight));
      const width = Math.max(0, Math.min(rect.width, logicalWidth - left));
      const height = Math.max(0, Math.min(rect.height, logicalHeight - top));
      if (width <= 0 || height <= 0) return null;
      return { left, top, width, height };
    } catch {
      return null;
    }
  };

  const getStableBrowserBounds = async () => {
    let previous = await getBrowserBounds();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const next = await getBrowserBounds();
      if (next && previous
        && Math.abs(next.left - previous.left) < 1
        && Math.abs(next.top - previous.top) < 1
        && Math.abs(next.width - previous.width) < 1
        && Math.abs(next.height - previous.height) < 1) return next;
      previous = next;
    }
    return previous;
  };

  const syncWebview = async (view = webviewRef.current) => {
    const visible = document.body.classList.contains('has-right-panel');
    await surfaces.browser.setPanelVisible(visible);
    if (visible) await surfaces.browser.syncBounds();
    return;

    const isPanelOpen = document.body.classList.contains('has-right-panel');
    const bounds = isPanelOpen ? await getBrowserBounds() : null;

    if (!bounds) {
      if (webviewRef.current) {
        await webviewRef.current.close().catch(() => undefined);
        webviewRef.current = null;
      } else {
        await invoke('codeclub_browser_close').catch(() => undefined);
      }
      return;
    }

    if (!view && addressRef.current) {
      void openPage(addressRef.current, false);
      return;
    }

    if (!view) return;

    try {
      await view.setPosition(new LogicalPosition(bounds.left, bounds.top));
      await view.setSize(new LogicalSize(bounds.width, bounds.height));
    } catch {
      // El WebView puede no existir durante el cambio de página.
    }
  };

  const openPage = async (rawUrl: string, push = true) => {
    let url = '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('URL no permitida');
      url = parsed.toString();
    } catch {
      setError(text.invalidUrl);
      return;
    }
    const requestId = ++requestRef.current;
    setAddress(url); addressRef.current = url; setError(''); setSelection(null); setInspectMode(false);
    window.dispatchEvent(new CustomEvent('codeclub:browser-tab-changed', { detail: { url } }));
    inspectModeRef.current = false;
    selectionKeyRef.current = '';
    try {
      const managedHost = hostRef.current;
      if (managedHost) {
        if (push) {
          setHistory((current) => [...current.slice(0, historyIndex + 1), url]);
          setHistoryIndex((current) => { historyIndexRef.current = current + 1; return current + 1; });
        }
        await surfaces.browser.mount(managedHost, url);
        await syncWebview();
        return;
      }
      await webviewRef.current?.close().catch(() => undefined);
      if (requestId !== requestRef.current) return;
      const isPanelOpen = document.body.classList.contains('has-right-panel');
      const bounds = isPanelOpen ? await getStableBrowserBounds() : null;
      if (!bounds) {
        webviewRef.current = null;
        return;
      }
      const view = new Webview(getCurrentWindow(), 'codeclub-browser', {
        url,
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
        focus: false,
        backgroundColor: '#202124',
        dragDropEnabled: false,
        zoomHotkeysEnabled: true,
      });
      webviewRef.current = view;
      await view.hide();
      view.once('tauri://error', (event) => setError(`No se pudo abrir el navegador: ${JSON.stringify(event.payload || event)}`));
      view.once('tauri://created', () => { [300, 1000, 2500, 5000].forEach((delay) => { window.setTimeout(() => { if (inspectModeRef.current) void installInspector(true, view); }, delay); }); });
      if (push) {
        setHistory((current) => [...current.slice(0, historyIndex + 1), url]);
        setHistoryIndex((current) => { historyIndexRef.current = current + 1; return current + 1; });
      }
      await syncWebview(view);
      await view.show();
      [80, 240, 700].forEach((delay) => window.setTimeout(() => { void syncWebview(view); }, delay));
    } catch (reason) { setError(String(reason)); }
  };

  useEffect(() => {
    let stopListening: (() => void) | undefined;
    let stopPageListening: (() => void) | undefined;
    void listen<BrowserDomSelection>('codeclub-browser-selection', (event) => {
      applySelection(event.payload);
    }).then((unlisten) => { stopListening = unlisten; });
    void listen<string>('codeclub-browser-page-loaded', () => { if (inspectModeRef.current) void installInspector(true); }).then((unlisten) => { stopPageListening = unlisten; });
    const handleStateRequest = () => { void surfaces.browser.evaluate(browserStateScript).catch(() => undefined); };
    const handleAction = async (event: Event) => {
      const action = (event as CustomEvent).detail || {};
      const cursorDataUrl = await getBrowserCursorDataUrl();
      await surfaces.browser.evaluate(browserAgentOverlayScript(action.selector, cursorDataUrl, language)).catch(() => undefined);
      if (action.type === 'move') {
        const result = await moveBrowserCursor(action.selector);
        if (!result.ok) {
          window.dispatchEvent(new CustomEvent('codeclub:browser-action-result', { detail: result }));
          return;
        }
      }
      await surfaces.browser.evaluate(browserActionScript(action)).catch(() => undefined);
    };
    window.addEventListener('codeclub:browser-state-request', handleStateRequest);
    window.addEventListener('codeclub:browser-action', handleAction);
    void openPage(initialUrl, false);
    const handleSync = () => { void syncWebview(); };
    const resizeObserver = new ResizeObserver(handleSync);
    if (hostRef.current) resizeObserver.observe(hostRef.current);
    const bodyObserver = new MutationObserver(handleSync);
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', handleSync);
    window.addEventListener('codeclub:right-panel-toggled', handleSync);
    const closeBeforeReload = () => { void surfaces.browser.dispose(); };
    window.addEventListener('beforeunload', closeBeforeReload);
    const navigationPoll = window.setInterval(async () => {
      if (navigationPollInFlightRef.current) return;
      navigationPollInFlightRef.current = true;
      try {
        const currentUrl = await surfaces.browser.getUrl();
        const selectionMarker = currentUrl.indexOf(browserSelectionHash);
        if (selectionMarker >= 0) {
          try {
            const encoded = currentUrl.slice(selectionMarker + browserSelectionHash.length);
            const nextSelection = JSON.parse(decodeURIComponent(encoded)) as BrowserDomSelection;
            applySelection(nextSelection);
            await surfaces.browser.evaluate(`history.replaceState(history.state, '', ${JSON.stringify(nextSelection.url)});`);
          } catch (reason) {
            setError(`No se pudo leer la selección: ${String(reason)}`);
          }
          return;
        }
        if (currentUrl && currentUrl !== addressRef.current) {
          addressRef.current = currentUrl;
          setAddress(currentUrl);
          setHistory((current) => {
            const next = [...current.slice(0, historyIndexRef.current + 1), currentUrl];
            historyIndexRef.current = next.length - 1;
            setHistoryIndex(historyIndexRef.current);
            return next;
          });
        }
        if (inspectModeRef.current) void installInspector(true);
      } catch { /* El WebView todavía puede estar navegando o cerrado. */ }
      finally {
        navigationPollInFlightRef.current = false;
      }
    }, 700);
    return () => {
      resizeObserver.disconnect();
      bodyObserver.disconnect();
      window.removeEventListener('resize', handleSync);
      window.removeEventListener('codeclub:right-panel-toggled', handleSync);
      window.removeEventListener('beforeunload', closeBeforeReload);
      window.removeEventListener('codeclub:browser-state-request', handleStateRequest);
      window.removeEventListener('codeclub:browser-action', handleAction);
      window.clearInterval(navigationPoll);
      stopListening?.();
      stopPageListening?.();
      void surfaces.browser.dispose();
    };
  }, [initialUrl]);

  const goBack = () => { if (historyIndex > 0) void openPage(history[historyIndex - 1], false).then(() => setHistoryIndex((current) => { historyIndexRef.current = current - 1; return current - 1; })); };
  const goForward = () => { if (historyIndex < history.length - 1) void openPage(history[historyIndex + 1], false).then(() => setHistoryIndex((current) => { historyIndexRef.current = current + 1; return current + 1; })); };
  const referencePage = () => window.dispatchEvent(new CustomEvent('codeclub:browser-reference', { detail: selection ? {
    title: selection.title || selection.selector || text.selectedElement,
    url: selection.url || address,
    text: JSON.stringify({ url: selection.url, selector: selection.selector, tag: selection.tag, text: selection.text, html: selection.html }),
  } : { title: address.replace(/^https?:\/\//, '').split('/')[0] || text.page, text: `${text.openPage}: ${address}` } }));

  return <div className="flex h-full min-h-0 flex-col bg-[#1A1A1A] text-[#d8d8d8]">
    <BrowserToolbar address={address} onAddressChange={setAddress} onSubmit={() => void openPage(address)} onBack={goBack} onForward={goForward} canGoBack={historyIndex > 0} canGoForward={historyIndex < history.length - 1} onReload={() => void openPage(address, false)} onInspect={() => {
      const active = !inspectModeRef.current;
      inspectModeRef.current = active;
      selectionKeyRef.current = '';
      if (active) setSelection(null);
      setInspectMode(active);
      void installInspector(active);
    }} onReference={referencePage} inspectMode={inspectMode} />
    <div className="hidden flex shrink-0 items-center gap-1 border-b border-[#202020] px-2 py-2">
      <button type="button" onClick={goBack} disabled={historyIndex === 0} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#666] hover:bg-[#1c1c1c] hover:text-[#eee] disabled:opacity-30" title="Atrás"><ArrowLeft size={13} /></button>
      <button type="button" onClick={goForward} disabled={historyIndex >= history.length - 1} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#666] hover:bg-[#1c1c1c] hover:text-[#eee] disabled:opacity-30" title="Adelante"><ArrowRight size={13} /></button>
      <form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); void openPage(address); }}><input value={address} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-[#202020] bg-[#161616] px-2.5 py-1.5 text-[10px] text-[#cfcfcf] outline-none focus:border-[#2f2f2f]" aria-label="Dirección web" /></form>
      <button type="button" onClick={() => void openPage(address, false)} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#1c1c1c] hover:text-[#eee]" title="Cargar"><RefreshCw size={12} /></button>
      <button type="button" onClick={() => {
        const active = !inspectModeRef.current;
        inspectModeRef.current = active;
        selectionKeyRef.current = '';
        if (active) setSelection(null);
        setInspectMode(active);
        void installInspector(active);
      }} aria-pressed={inspectMode} className={`grid h-7 w-7 place-items-center rounded-md border-0 text-[#777] hover:bg-[#1c1c1c] hover:text-[#eee] ${inspectMode ? 'bg-[#242424] text-[#eee]' : 'bg-transparent'}`} title="Seleccionar elemento de la página"><ArrowUpRight size={13} /></button>
      <button type="button" onClick={referencePage} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#1c1c1c] hover:text-[#eee]" title="Referenciar página"><Globe size={12} /></button>
    </div>
    <div ref={hostRef} data-native-browser-host="true" className="relative ml-px min-h-0 flex-1 overflow-hidden bg-[#202124]">
      {error && <div className="absolute inset-x-0 top-0 z-10 bg-[#2b1e1e] p-2 text-[10px] text-[#d49a9a]">{error}</div>}
    </div>
  </div>;
}

function BrowserView({ initialUrl = 'https://www.google.com' }: { initialUrl?: string }) {
  const [address, setAddress] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const [page, setPage] = useState('');
  const [title, setTitle] = useState('Navegador');
  const [selection, setSelection] = useState('');
  const [selectedBox, setSelectedBox] = useState('');
  const [language, setLanguage] = useState<AppLanguage>('es');
  const browserText = browserUiTranslations[language];
  const [inspectMode, setInspectMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inspectModeRef = useRef(false);
  const historyRef = useRef([initialUrl]);
  const historyIndexRef = useRef(0);
  const selectedElementRef = useRef<HTMLElement | null>(null);
  useEffect(() => { inspectModeRef.current = inspectMode; }, [inspectMode]);

  const loadPage = async (nextUrl = address, pushHistory = true) => {
    const normalized = /^https?:\/\//i.test(nextUrl.trim()) ? nextUrl.trim() : `https://${nextUrl.trim()}`;
    setAddress(normalized); setUrl(normalized); setLoading(true); setError(''); setSelection(''); setSelectedBox('');
    try {
      const response = await invoke<{ status: number; body: string }>('codeclub_http_fetch', { request: { url: normalized, method: 'GET', headers: [], body: null } });
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
      const body = response.body || '';
      setPage(body.includes('<html') || body.includes('<!doctype') ? body : `<pre style="white-space:pre-wrap;font:13px system-ui;color:#ddd">${body.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char))}</pre>`);
      setTitle(normalized.replace(/^https?:\/\//, '').split('/')[0] || 'Navegador');
      if (pushHistory && historyRef.current[historyIndexRef.current] !== normalized) {
        historyRef.current = [...historyRef.current.slice(0, historyIndexRef.current + 1), normalized];
        historyIndexRef.current = historyRef.current.length - 1;
      }
    } catch (reason) { setPage(''); setError(`No se pudo cargar la página: ${String(reason)}`); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void loadPage(initialUrl, false);
  }, [initialUrl]);

  const goBack = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    void loadPage(historyRef.current[historyIndexRef.current], false);
  };
  const goForward = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    void loadPage(historyRef.current[historyIndexRef.current], false);
  };

  const readSelection = () => {
    try { setSelection(frameRef.current?.contentWindow?.getSelection?.().toString().trim() || ''); } catch { setSelection(''); }
  };
  const selectBox = (event: MouseEvent) => {
    if (!inspectModeRef.current) return;
    event.preventDefault();
    try {
      const target = event.target as HTMLElement;
      selectedElementRef.current?.classList.remove('codeclub-selected-element');
      if (selectedElementRef.current) selectedElementRef.current.style.removeProperty('outline');
      target.classList.add('codeclub-selected-element');
      target.style.setProperty('outline', '2px solid #4d9cff', 'important');
      target.style.setProperty('outline-offset', '2px', 'important');
      selectedElementRef.current = target;
      const text = target.innerText?.trim() || target.textContent?.trim() || '';
      const html = target.outerHTML || '';
      setSelectedBox(JSON.stringify({ tag: target.tagName.toLowerCase(), text: text.slice(0, 4000), html: html.slice(0, 8000) }));
      setSelection('');
    } catch { setSelectedBox(''); }
  };
  const bindFrame = () => {
    const document = frameRef.current?.contentDocument;
    if (!document) return;
    document.addEventListener('mouseup', readSelection);
    document.addEventListener('click', selectBox);
  };
  const pushReference = (text: string, referenceTitle: string) => {
    if (!text.trim()) return;
    window.dispatchEvent(new CustomEvent('codeclub:browser-reference', { detail: { title: referenceTitle, text: text.trim(), url: address } }));
    setInspectMode(false);
  };

  return <div className="flex h-full min-h-0 flex-col bg-[#1A1A1A] text-[#d8d8d8]">
    <BrowserToolbar address={address} onAddressChange={setAddress} onSubmit={() => void loadPage()} onBack={goBack} onForward={goForward} canGoBack={historyIndexRef.current > 0} canGoForward={historyIndexRef.current < historyRef.current.length - 1} onReload={() => void loadPage(address, false)} onInspect={() => setInspectMode((active) => !active)} onReference={() => pushReference(selectedBox || selection || title, selectedBox ? 'Elemento seleccionado' : selection ? 'Selección' : title)} inspectMode={inspectMode} />
    <div className="hidden flex shrink-0 items-center gap-1 border-b border-[#202020] px-2 py-2">
      <button type="button" onClick={goBack} disabled={historyIndexRef.current === 0} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#666] hover:bg-[#1c1c1c] hover:text-[#eee] disabled:opacity-30" title="Atrás"><ArrowLeft size={13} /></button>
      <button type="button" onClick={goForward} disabled={historyIndexRef.current >= historyRef.current.length - 1} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#666] hover:bg-[#1c1c1c] hover:text-[#eee] disabled:opacity-30" title="Adelante"><ArrowRight size={13} /></button>
      <form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); void loadPage(); }}><input value={address} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-[#202020] bg-[#161616] px-2.5 py-1.5 text-[10px] text-[#cfcfcf] outline-none focus:border-[#2f2f2f]" aria-label="Dirección web" /></form>
      <button type="button" onClick={() => void loadPage(address, false)} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#1c1c1c] hover:text-[#eee]" title="Cargar"><RefreshCw size={12} /></button>
      <button type="button" onClick={() => pushReference(selectedBox || selection || title, selectedBox ? 'Elemento seleccionado' : selection ? 'Selección' : title)} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#1c1c1c] hover:text-[#eee]" title="Enviar referencia al chat"><ArrowUpRight size={13} /></button>
      <button type="button" onClick={() => setInspectMode((active) => !active)} className={`grid h-7 w-7 place-items-center rounded-md border-0 text-[#777] hover:bg-[#1c1c1c] hover:text-[#eee] ${inspectMode ? 'bg-[#242424] text-[#eee]' : 'bg-transparent'}`} title="Seleccionar elemento de la página"><Globe size={12} /></button>
    </div>
    {(selection || selectedBox) && <div className="flex shrink-0 items-center gap-2 border-b border-[#202020] px-3 py-1.5 text-[10px] text-[#999]"><span className="min-w-0 flex-1 truncate">{selectedBox ? browserText.elementReady : browserText.selectionReady}</span><button type="button" onClick={() => pushReference(selectedBox || selection, selectedBox ? browserText.elementReady : browserText.selectionReady)} className="rounded-md border-0 bg-[#1c1c1c] px-2 py-1 text-[#ddd] hover:bg-[#242424]">{browserText.add}</button><button type="button" onClick={() => { setSelection(''); setSelectedBox(''); }} className="text-[#666] hover:text-[#eee]" aria-label={browserText.removeSelection}><X size={12} /></button></div>}
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#101010]">
      {loading && <div className="absolute inset-0 z-10 grid place-items-center bg-[#101010]/80 text-[11px] text-[#777]">{browserText.loading}</div>}
      {error ? <div className="p-4 text-[11px] text-[#a87878]">{error}</div> : page ? <iframe ref={frameRef} title={title} srcDoc={`<base href="${url}"><meta name="color-scheme" content="dark"><style>html{color-scheme:dark!important;background:#202124!important}body{background:#202124!important;color:#e8eaed!important;font:13px system-ui;padding:18px;line-height:1.55}a{color:#8ab4f8}input,textarea,button{color-scheme:dark}</style>${page}`} sandbox="allow-same-origin" onLoad={bindFrame} className={`h-full w-full border-0 bg-[#101010] ${inspectMode ? 'cursor-crosshair' : ''}`} /> : <div className="grid h-full place-items-center text-[11px] text-[#666]">{browserText.empty}</div>}
    </div>
  </div>;
}

function WhatsAppTerminalView() {
  const [logs, setLogs] = useState<string[]>(['$ whatsapp bridge --persistent']);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const appendLog = (message: string) => setLogs((current) => [...current, `${new Date().toLocaleTimeString()}  ${message}`].slice(-500));
    const connect = async () => {
      unlisten = await listen<any>('codeclub:whatsapp-event', (event) => {
        const payload = event.payload || {};
        if (payload.type === 'qr') { setRefreshing(false); appendLog('QR generado; escanealo desde WhatsApp > Dispositivos vinculados'); }
        else if (payload.type === 'ready') { setRefreshing(false); whatsappContextStore.set({ ...whatsappContextStore.get(), connected: true, account: payload.name || payload.phone }); appendLog(`Conectado como ${payload.name || payload.phone || 'cuenta desconocida'}`); }
        else if (payload.type === 'chats') { whatsappContextStore.set({ ...whatsappContextStore.get(), chats: payload.chats || [] }); appendLog(`Conversaciones recibidas: ${payload.chats?.length || 0}`); }
        else if (payload.type === 'message') { const current = whatsappContextStore.get(); const chatId = payload.chat?.id; whatsappContextStore.set({ ...current, chats: chatId ? [payload.chat, ...current.chats.filter((chat) => chat.id !== chatId)] : current.chats, messages: chatId ? { ...current.messages, [chatId]: [...(current.messages[chatId] || []), payload.message].slice(-300) } : current.messages }); appendLog(`Mensaje recibido en ${payload.chat?.name || payload.chat?.id || 'chat'}`); }
        else if (payload.type === 'chat_messages') { const current = whatsappContextStore.get(); whatsappContextStore.set({ ...current, messages: { ...current.messages, [payload.chatId]: payload.messages || [] } }); }
        else if (payload.type === 'error') appendLog(`ERROR ${payload.message || 'sin detalle'}`);
        else if (payload.type === 'warning') appendLog(`AVISO ${payload.message || 'sin detalle'}`);
        else if (payload.type === 'disconnected') appendLog(payload.reason || 'WhatsApp desconectado');
        else if (payload.type === 'session_reset') appendLog(payload.reason || 'Sesión reiniciada');
        else if (payload.type === 'logged_out') appendLog('Sesión cerrada');
        else appendLog(JSON.stringify(payload));
      });
      if (disposed) return;
      try {
        await invoke('codeclub_whatsapp_start');
        appendLog('Bridge iniciado');
      } catch (error) { appendLog(`ERROR ${String(error)}`); }
    };
    void connect();
    return () => { disposed = true; unlisten?.(); void invoke('codeclub_whatsapp_stop').catch(() => undefined); };
  }, []);

  return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#1A1A1A]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#1A1A1A] px-2 text-[12px] text-[#eeeeee]">
      <span>WhatsApp</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => { setRefreshing(true); setLogs((current) => [...current, `${new Date().toLocaleTimeString()}  Actualizando bridge...`].slice(-500)); void invoke('codeclub_whatsapp_refresh').catch((error) => { setRefreshing(false); setLogs((current) => [...current, `ERROR ${String(error)}`].slice(-500)); }); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Actualizar WhatsApp" aria-label="Actualizar WhatsApp"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button>
        <button type="button" onClick={() => { setLogs((current) => [...current, `${new Date().toLocaleTimeString()}  Cerrando sesión...`].slice(-500)); void invoke('codeclub_whatsapp_logout').catch((error) => setLogs((current) => [...current, `ERROR ${String(error)}`].slice(-500))); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Cerrar sesión de WhatsApp" aria-label="Cerrar sesión de WhatsApp"><LogOut size={14} /></button>
      </div>
    </div>
    <pre className="file-preview-scrollbar m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-[#101010] p-3 font-mono text-[11px] leading-5 text-[#b9b9b9]">{logs.join('\n')}</pre>
  </div>;
}

function LegacyWhatsAppView() {
  const [query, setQuery] = useState('');
  const [showConversations, setShowConversations] = useState(true);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState('Conectando con WhatsApp...');
  const [chats, setChats] = useState<Array<{ id: string; name: string; unreadCount: number; timestamp?: number; pinned?: number }>>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [messages, setMessages] = useState<Record<string, Array<{ id: string; body: string; fromMe: boolean }>>>({});
  const [input, setInput] = useState('');
  const [chatDebug, setChatDebug] = useState('Esperando datos de WhatsApp...');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const handleEvent = (payload: any) => {
      if (payload.type === 'qr') { setRefreshing(false); setQr(payload.dataUrl); setStatus('Escaneá el código QR con WhatsApp'); }
      if (payload.type === 'ready') {
        setQr('');
        setRefreshing(false);
        const account = payload.name || payload.phone;
        setStatus(account ? `Conectado como ${account}` : 'Conectado');
      }
      if (payload.type === 'session_reset') { setRefreshing(false); setQr(''); setChats([]); setActiveChatId(''); setStatus('Sesión expirada. Generando un nuevo QR...'); }
      if (payload.type === 'logged_out') {
        setRefreshing(false);
        setQr('');
        setChats([]);
        setActiveChatId('');
        setMessages({});
        setChatDebug('Sesión limpia. Esperando nuevas conversaciones...');
        setStatus('Sesión cerrada. Generando un nuevo QR...');
        setTimeout(() => { if (!disposed) void invoke('codeclub_whatsapp_start').catch((error) => setStatus(String(error))); }, 300);
      }
      if (payload.type === 'error') setStatus(payload.message || 'No se pudo conectar con WhatsApp');
      if (payload.type === 'disconnected') { setRefreshing(false); setQr(''); setStatus(payload.reason || 'WhatsApp desconectado'); }
      if (payload.type === 'chats') {
        const nextChats = payload.chats || [];
        setChats(nextChats);
        setChatDebug(`Evento recibido: ${nextChats.length} conversaciones`);
      }
      if (payload.type === 'message') {
        setChats((current) => [payload.chat, ...current.filter((chat) => chat.id !== payload.chat.id)]);
        setMessages((current) => ({ ...current, [payload.chat.id]: [...(current[payload.chat.id] || []).filter((message) => message.id !== payload.message.id), payload.message] }));
      }
      if (payload.type === 'chat_messages') setMessages((current) => ({ ...current, [payload.chatId]: payload.messages || [] }));
    };
    const connect = async () => {
      unlisten = await listen<any>('codeclub:whatsapp-event', (event) => handleEvent(event.payload));
      if (disposed) return;
      try {
        await invoke('codeclub_whatsapp_start');
      } catch (error) { setStatus(String(error)); }
    };
    void connect();
    return () => { disposed = true; unlisten?.(); void invoke('codeclub_whatsapp_stop').catch(() => undefined); };
  }, []);

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const activeChatNumber = activeChat?.id.split('@')[0] || '';
  const activeChatTitle = activeChat
    ? activeChat.name === activeChatNumber
      ? `WhatsApp - ${activeChatNumber}`
      : `WhatsApp - ${activeChatNumber} - ${activeChat.name}`
    : 'WhatsApp';
  const visibleChats = chats
    .filter((chat) => chat.name.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => {
      const pinnedOrder = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      return pinnedOrder || ((right.timestamp || 0) - (left.timestamp || 0));
    });
  const sendMessage = async () => {
    const body = input.trim();
    if (!body || !activeChatId) return;
    await invoke('codeclub_whatsapp_send', { chatId: activeChatId, body });
    setMessages((current) => ({ ...current, [activeChatId]: [...(current[activeChatId] || []), { id: `local-${Date.now()}`, body, fromMe: true }] }));
    setInput('');
  };
  const openChat = async (chatId: string) => {
    setActiveChatId(chatId);
    await invoke('codeclub_whatsapp_get_messages', { chatId }).catch(() => undefined);
  };

  return <div className="flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#1A1A1A]">
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#1A1A1A] px-2">
      <span className="min-w-0 truncate text-[12px] leading-none text-[#eeeeee]">{activeChatTitle}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => { setRefreshing(true); setChatDebug('Actualizando conversaciones...'); void invoke('codeclub_whatsapp_refresh').catch((error) => { setRefreshing(false); setChatDebug(String(error)); }); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Actualizar conversaciones" aria-label="Actualizar conversaciones">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button type="button" onClick={() => { setStatus('Cerrando sesión de WhatsApp...'); void invoke('codeclub_whatsapp_logout').catch((error) => setStatus(String(error))); }} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title="Cerrar sesión de WhatsApp" aria-label="Cerrar sesión de WhatsApp">
          <LogOut size={14} />
        </button>
        <button type="button" onClick={() => setShowConversations((visible) => !visible)} className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#202020] text-[#eeeeee] hover:bg-[#2b2b2b]" title={showConversations ? 'Ocultar conversaciones' : 'Mostrar conversaciones'} aria-label={showConversations ? 'Ocultar conversaciones' : 'Mostrar conversaciones'}>
          <MessageCircle size={15} />
        </button>
      </div>
    </div>
    <div className="flex h-0 min-h-0 max-h-full flex-1 overflow-hidden">
      <main className="flex h-full min-w-0 min-h-0 flex-1 flex-col bg-[#1A1A1A]">
        {qr ? <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"><img src={qr} alt="Código QR de WhatsApp" className="h-[220px] w-[220px] rounded-xl bg-white p-2" /><div><p className="m-0 text-[17px] font-semibold text-[#eeeeee]">Vincular WhatsApp</p><p className="m-0 mt-2 text-[13px] leading-5 text-[#a7a7a7]">Abrí WhatsApp en tu teléfono y escaneá este código</p></div></div> : activeChat ? <div className="flex min-h-0 flex-1 flex-col"><div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{(messages[activeChatId] || []).map((message) => <div key={message.id} className={`max-w-[78%] rounded-lg px-2.5 py-1.5 text-[12px] ${message.fromMe ? 'self-end bg-[#1e3a2b] text-[#e2f4e9]' : 'self-start bg-[#1d1d1d] text-[#eeeeee]'}`}>{message.body}</div>)}</div><div className="shrink-0 border-t border-[#2b2b2b] p-2"><div className="flex items-center gap-2 rounded-full border border-[#353535] bg-[#1d1d1d] px-3 py-1"><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendMessage(); }} className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-[#eeeeee] outline-none" placeholder="Escribí un mensaje..." /><button type="button" onClick={() => void sendMessage()} className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#79c893] text-[#111111]" aria-label="Enviar mensaje" title="Enviar mensaje"><ArrowUpRight size={16} strokeWidth={2} /></button></div></div></div> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><MessageCircle size={42} strokeWidth={1.5} className="text-[#a7a7a7]" /><div className="max-w-[300px]"><p className="m-0 text-[18px] font-semibold text-[#eeeeee]">{status}</p><p className="m-0 mt-2 text-[14px] leading-5 text-[#a7a7a7]">Seleccioná un chat cuando WhatsApp esté conectado</p></div></div>}
      </main>
      <aside className={`h-full max-h-full min-h-0 shrink-0 overflow-hidden border-l border-[#2b2b2b] bg-[#121212] transition-[width,transform,opacity] duration-200 ease-out ${showConversations ? 'w-[35%]' : 'w-0 translate-x-full opacity-0 border-l-0 pointer-events-none'}`}>
        <div className="flex h-full min-h-0 flex-1 flex-col px-3 py-3">
          <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[10px] border border-[#353535] bg-[#1d1d1d] px-2.5 text-[#9a9a9a] focus-within:border-[#555555]"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] text-[#eeeeee] outline-none placeholder:text-[#929292]" placeholder="Buscar conversaciones..." aria-label="Buscar conversaciones" /></label>
          <div className="min-h-0 flex-1 max-h-full overflow-y-auto bg-[#121212] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{visibleChats.length ? visibleChats.map((chat) => <button key={chat.id} type="button" onClick={() => void openChat(chat.id)} className={`flex min-h-[34px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] ${activeChatId === chat.id ? 'bg-[#1e1e1e] text-[#eeeeee]' : 'text-[#cccccc] hover:bg-white/[0.04]'}`}><MessageCircle size={14} className="shrink-0 text-[#79c893]" /><span className="min-w-0 flex-1 truncate">{chat.name}</span>{chat.unreadCount > 0 && <span className="text-[10px] text-[#79c893]">{chat.unreadCount}</span>}</button>) : <div className="px-2 py-4 text-center"><p className="m-0 text-[12px] text-[#777777]">{query ? 'No se encontraron conversaciones.' : 'No hay conversaciones disponibles.'}</p><p className="m-0 mt-2 text-[10px] text-[#555555]">{chatDebug}</p></div>}</div>
        </div>
      </aside>
    </div>
  </div>;
}

export default function RightSidebar() {
  type RightTab = 'files' | 'review' | 'browser' | 'artifacts' | 'terminals';
  type TerminalSession = { id: string; name: string; lastCommand?: string; is_agent?: boolean };
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const labels: Record<RightTab, string> = { files: text.files, review: text.review, browser: text.browser, artifacts: text.artifacts, terminals: text.terminals };
  const availableTabs: RightTab[] = ['files', 'review', 'browser', 'artifacts', 'terminals'];
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  useEffect(() => {
    const handleTerminalCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId?: string; command?: string }>).detail;
      const command = detail?.command?.trim();
      if (!command || !detail?.terminalId) return;
      setTerminalSessions((current) => current.map((session) => session.id === detail.terminalId ? { ...session, lastCommand: command.length > 24 ? `${command.slice(0, 23)}…` : command } : session));
    };
    window.addEventListener('codeclub:terminal-command', handleTerminalCommand);
    return () => window.removeEventListener('codeclub:terminal-command', handleTerminalCommand);
  }, []);
  useEffect(() => {
    const handleTerminalList = (event: Event) => {
      const sessions = ((event as CustomEvent<{ terminals?: TerminalSession[] }>).detail?.terminals || []).filter((terminal) => !terminal.is_agent);
      setTerminalSessions(sessions);
      setActiveTerminalId((current) => current || sessions[0]?.id || null);
    };
    const handleTerminalCreated = (event: Event) => {
      const terminal = (event as CustomEvent<TerminalSession>).detail;
      if (!terminal?.id) return;
      setTerminalSessions((current) => current.some((session) => session.id === terminal.id) ? current : [...current, terminal]);
      setActiveTerminalId(terminal.id);
      setTabs((current) => current.includes('terminals') ? current : [...current, 'terminals']);
      setActiveTab('terminals');
    };
    window.addEventListener('codeclub:terminal-list', handleTerminalList);
    window.addEventListener('codeclub:terminal-created', handleTerminalCreated);
    return () => {
      window.removeEventListener('codeclub:terminal-list', handleTerminalList);
      window.removeEventListener('codeclub:terminal-created', handleTerminalCreated);
    };
  }, []);
  const [tabs, setTabs] = React.useState<RightTab[]>([]);
  const [activeTab, setActiveTab] = React.useState<RightTab | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState({ top: 0, left: 0 });
  const [activeProjectPath, setActiveProjectPath] = useState('');
  const [activeProjectName, setActiveProjectName] = useState('');
  const [artifactState, setArtifactState] = useState<AgentState>({ plan: null, plans: [], todos: [] });
  const [browserUrl, setBrowserUrl] = useState('https://www.google.com');
  const [browserFaviconFailed, setBrowserFaviconFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingRef.current) return;
      const leftWidth = document.body.classList.contains('has-sidebar') ? 264 : 0;
      const availableWidth = Math.max(0, window.innerWidth - leftWidth);
      const minimum = availableWidth * 0.35;
      const maximum = availableWidth - minimum;
      const width = Math.min(maximum, Math.max(minimum, window.innerWidth - event.clientX));
      document.body.style.setProperty('--right-panel-width', `${width}px`);
    };
    const stopResize = () => { resizingRef.current = false; document.body.style.removeProperty('user-select'); };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadArtifacts = async () => {
      if (!activeProjectPath) { setArtifactState({ plan: null, plans: [], todos: [] }); return; }
      const next = await readAgentState(activeProjectPath);
      if (!cancelled) setArtifactState(next);
    };
    void loadArtifacts();
    const handleArtifactsChanged = (event: Event) => {
      const projectPath = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      if (!projectPath || projectPath === activeProjectPath) void loadArtifacts();
    };
    window.addEventListener('codeclub:artifacts-changed', handleArtifactsChanged);
    return () => { cancelled = true; window.removeEventListener('codeclub:artifacts-changed', handleArtifactsChanged); };
  }, [activeProjectPath, activeTab]);

  useEffect(() => {
    const handleBrowserTabChanged = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      setBrowserUrl(url);
      setBrowserFaviconFailed(false);
    };
    window.addEventListener('codeclub:browser-tab-changed', handleBrowserTabChanged);
    return () => window.removeEventListener('codeclub:browser-tab-changed', handleBrowserTabChanged);
  }, []);

  useEffect(() => {
    const handleBrowserNavigate = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      setBrowserUrl(url);
      setBrowserFaviconFailed(false);
      window.dispatchEvent(new CustomEvent('codeclub:open-right-panel'));
      setTabs((current) => current.includes('browser') ? current : [...current, 'browser']);
      setActiveTab('browser');
      setMenuOpen(false);
    };
    window.addEventListener('codeclub:browser-navigate', handleBrowserNavigate);
    return () => window.removeEventListener('codeclub:browser-navigate', handleBrowserNavigate);
  }, []);

  useEffect(() => {
    const openTerminals = () => {
      window.dispatchEvent(new CustomEvent('codeclub:open-right-panel'));
      setTabs((current) => current.includes('terminals') ? current : [...current, 'terminals']);
      setActiveTab('terminals');
      setMenuOpen(false);
    };
    window.addEventListener('codeclub:open-terminal-panel', openTerminals);
    return () => window.removeEventListener('codeclub:open-terminal-panel', openTerminals);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [menuOpen]);

  useEffect(() => {
    const menu = menuOpen ? document.querySelector('.terminal-shell-menu') : null;
    if (menu instanceof HTMLElement) {
      void surfaces.popup.open({ id: 'right-panel-tabs', anchor: menu.getBoundingClientRect(), content: menu });
    } else {
      void surfaces.popup.close();
    }
  }, [menuOpen]);

  useEffect(() => {
    const closePopup = () => setMenuOpen(false);
    const applyPopupAction = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (!tab || !['files', 'review', 'browser', 'artifacts', 'terminals'].includes(tab)) return;
      createTab(tab as RightTab);
      setMenuOpen(false);
    };
    window.addEventListener('codeclub:surface-popup-close', closePopup);
    window.addEventListener('codeclub:surface-popup-action', applyPopupAction);
    return () => {
      window.removeEventListener('codeclub:surface-popup-close', closePopup);
      window.removeEventListener('codeclub:surface-popup-action', applyPopupAction);
    };
  }, [tabs]);

  useEffect(() => {
    const handleNativeTab = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (!tab || !['files', 'review', 'browser', 'artifacts', 'terminals'].includes(tab)) return;
      createTab(tab as RightTab);
    };
    window.addEventListener('codeclub:right-panel-tab', handleNativeTab);
    return () => window.removeEventListener('codeclub:right-panel-tab', handleNativeTab);
  }, [tabs]);

  useEffect(() => {
    const handleProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; projectName?: string }>).detail;
      const projectPath = detail?.projectPath || '';
      setActiveProjectPath(projectPath);
      setActiveProjectName(detail?.projectName || projectPath.split(/[\\/]/).pop() || '');
    };
    window.addEventListener('codeclub:active-project', handleProject);
    window.addEventListener('codeclub:project-selection-changed', handleProject);
    return () => {
      window.removeEventListener('codeclub:active-project', handleProject);
      window.removeEventListener('codeclub:project-selection-changed', handleProject);
    };
  }, []);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.userSelect = 'none';
  };

  const addTab = () => {
    if (!menuOpen) {
      const rect = plusButtonRef.current?.getBoundingClientRect();
      const anchor = menuRef.current?.getBoundingClientRect();
      if (rect && anchor) {
        const menuWidth = 190;
        setMenuPosition({
          top: rect.bottom - anchor.top + 4,
          left: Math.max(8, Math.min(rect.right - menuWidth - anchor.left, anchor.width - menuWidth - 8)),
        });
      }
    }
    setMenuOpen((open) => !open);
  };

  const createTab = (tab: RightTab) => {
    window.dispatchEvent(new CustomEvent('codeclub:open-right-panel'));
    setTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setActiveTab(tab);
    setMenuOpen(false);
    if (tab === 'terminals') window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:new-terminal')), 0);
  };

  const terminalDisplayTabs = tabs.flatMap((tab) => tab === 'terminals' && terminalSessions.length > 0
    ? terminalSessions.map((session) => ({ tab, session }))
    : [{ tab, session: null as TerminalSession | null }] );

  const closeTerminalTab = (id: string) => {
    window.dispatchEvent(new CustomEvent('codeclub:terminal-close', { detail: { id } }));
    setTerminalSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      setActiveTerminalId((active) => active === id ? next[0]?.id || null : active);
      return next;
    });
  };

  useEffect(() => {
    const openArtifacts = (event: Event) => {
      const projectPath = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      window.dispatchEvent(new CustomEvent('codeclub:open-right-panel'));
      if (projectPath && projectPath !== activeProjectPath) setActiveProjectPath(projectPath);
      setTabs((current) => current.includes('artifacts') ? current : [...current, 'artifacts']);
      setActiveTab('artifacts');
      setMenuOpen(false);
    };
    window.addEventListener('codeclub:open-artifacts', openArtifacts);
    return () => window.removeEventListener('codeclub:open-artifacts', openArtifacts);
  }, [activeProjectPath]);

  const closeTab = (tab: RightTab) => {
    setTabs((current) => {
      const index = current.indexOf(tab);
      const next = current.filter((item) => item !== tab);
      setActiveTab((active) => active === tab ? next[index] ?? next[index - 1] ?? null : active);
      return next;
    });
  };

  const tabIcon = (tab: RightTab) => {
    if (tab === 'files') return <FolderOpen size={14} strokeWidth={1.7} />;
    if (tab === 'review') return <GitCompare size={14} strokeWidth={1.7} />;
    if (tab === 'browser') return <Globe size={14} strokeWidth={1.7} />;
    if (tab === 'artifacts') return <FileText size={14} strokeWidth={1.7} />;
    return <SquareTerminal size={14} strokeWidth={1.7} />;
  };

  return (
    <aside className="right-sidebar-shell right-sidebar relative z-40 row-start-2 col-start-3 h-full max-h-full min-w-0 min-h-0 border-0 bg-[#1A1A1A] text-[#d8d8d8] shadow-none" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.22)', borderLeft: '1px solid rgba(255, 255, 255, 0.22)' }} aria-label={text.rightPanel}>
      <div onPointerDown={startResize} className="absolute -left-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize bg-transparent transition-colors hover:bg-[#2f2f2f]" aria-label={text.resizePanel} role="separator" />
      <div className="flex h-full min-w-[264px] flex-col overflow-visible">
        <div ref={menuRef} className="relative z-50 flex h-[40px] min-w-0 shrink-0 overflow-visible border-b-0">
          <div className="file-preview-scrollbar terminal-tabs h-full min-w-0 flex-1 px-1" style={{ overflowX: 'scroll', overflowY: 'hidden' }}>
          {terminalDisplayTabs.map(({ tab, session }) => (
            <button key={session ? `terminal:${session.id}` : tab} type="button" onDoubleClick={() => session ? closeTerminalTab(session.id) : closeTab(tab)} onClick={() => { setActiveTab(tab); if (session) setActiveTerminalId(session.id); }} className={`terminal-tab h-[30px] min-w-0 ${session ? 'w-[160px] flex-none' : 'flex-1'} justify-between rounded-[6px] border-0 px-3 text-[10px] ${activeTab === tab && (!session || activeTerminalId === session.id) ? 'is-active bg-[#2B2B2B] text-[#eeeeee]' : 'bg-transparent text-[#888888]'}`}>
              {tab === 'browser' ? <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5"><span className="grid h-4 w-4 shrink-0 place-items-center">{browserFaviconFailed ? <Globe size={13} strokeWidth={1.7} /> : <img src={`${new URL(browserUrl).origin}/favicon.ico`} onError={() => setBrowserFaviconFailed(true)} alt="" className="h-3.5 w-3.5 rounded-sm" />}</span><span className="min-w-0 truncate">{browserHost(browserUrl)}</span></span> : <span className="flex min-w-0 flex-1 items-center justify-start gap-1.5"><span className="shrink-0">{tabIcon(tab)}</span><span className="min-w-0 truncate">{session?.lastCommand || session?.name || labels[tab]}</span></span>}
              {activeTab === tab && (!session || activeTerminalId === session.id) && <span role="button" tabIndex={0} aria-label={session ? text.closeTerminal : text.closeTab} className="ml-2 grid h-5 w-5 shrink-0 place-items-center rounded text-[#777] transition-colors hover:bg-[#3a3a3a] hover:text-[#eeeeee]" onClick={(event) => { event.stopPropagation(); session ? closeTerminalTab(session.id) : closeTab(tab); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); session ? closeTerminalTab(session.id) : closeTab(tab); } }}><X size={11} strokeWidth={1.8} /></span>}
            </button>
          ))}
          <div className="terminal-new relative shrink-0 px-1">
          <button ref={plusButtonRef} type="button" onClick={addTab} className="terminal-new-tab h-[30px] w-7 rounded-[6px]" aria-label={text.newTab} title={text.newTab}>
            <Plus size={13} strokeWidth={1.8} />
          </button>
          </div>
        </div>
        {menuOpen && <div className="terminal-shell-menu absolute z-[100] min-w-[190px]" style={{ position: 'absolute', top: menuPosition.top, left: menuPosition.left }} role="menu">
          {availableTabs.map((tab) => <button key={tab} type="button" data-menu-tab={tab} onClick={() => createTab(tab)} disabled={tabs.includes(tab) && tab !== 'terminals'} className="flex items-center gap-2 disabled:cursor-default disabled:opacity-35" role="menuitem"><span className="shrink-0">{tabIcon(tab)}</span><span className="truncate">{labels[tab]}</span></button>)}
        </div>}
        </div>
        <div className="relative z-0 flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
           {activeTab === 'files' && <FilesView projectPath={activeProjectPath} />}
           {activeTab === 'review' && <ReviewView projectPath={activeProjectPath} />}
           {activeTab === 'browser' && <NativeBrowserView initialUrl={browserUrl} />}
           {activeTab === 'artifacts' && <ArtifactsView state={artifactState} projectPath={activeProjectPath} projectName={activeProjectName} hasProject={Boolean(activeProjectPath)} />}
           {activeTab === 'terminals' && <div className="flex h-full min-h-0 w-full min-w-0"><TerminalDock embedded terminalId={activeTerminalId || undefined} /></div>}
          {tabs.length === 0 && <div className="flex flex-1 items-center justify-center px-6">
            <div className="flex w-full max-w-[420px] flex-col gap-2">
              {availableTabs.map((tab) => <button key={tab} type="button" onClick={() => createTab(tab)} className="flex min-h-[48px] items-center gap-3 rounded-xl border-0 bg-[#2B2B2B] px-4 text-left text-[14px] text-[#eeeeee] transition-colors hover:bg-[#303030]">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[#bdbdbd]">{tabIcon(tab)}</span>
                <span className="min-w-0 flex-1">{labels[tab]}</span>
              </button>)}
            </div>
          </div>}
        </div>
      </div>
    </aside>
  );
}

function ArtifactsView({ state, projectPath, projectName, hasProject }: { state: AgentState; projectPath: string; projectName: string; hasProject: boolean }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = rightSidebarTranslations[language];
  const [selectedArtifact, setSelectedArtifact] = useState<{ kind: 'plan' | 'todo'; id: string } | null>(null);
  const selectionColor = '#3a3a3a';
  useEffect(() => setSelectedArtifact(null), [projectPath]);
  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);
  useEffect(() => {
    const clearSelectionOutsideArtifacts = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('section')) setSelectedArtifact(null);
    };
    document.addEventListener('click', clearSelectionOutsideArtifacts);
    return () => document.removeEventListener('click', clearSelectionOutsideArtifacts);
  }, []);
  const pushReference = (kind: 'plan' | 'todo', id: string, title: string) => {
    window.dispatchEvent(new CustomEvent('codeclub:artifact-reference', { detail: { projectPath, kind, id, title } }));
  };
  const plans = state.plans?.length ? state.plans : state.plan ? [state.plan] : [];
  const removePlan = async (id: string) => {
    const current = await readAgentState(projectPath);
    const nextPlans = (current.plans || (current.plan ? [current.plan] : [])).filter((plan) => plan.id !== id);
    await writeAgentState(projectPath, { ...current, plans: nextPlans, plan: nextPlans[nextPlans.length - 1] || null });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };
  const removeTodo = async (id: string) => {
    const current = await readAgentState(projectPath);
    await writeAgentState(projectPath, { ...current, todos: current.todos.filter((todo) => todo.id !== id) });
    window.dispatchEvent(new CustomEvent('codeclub:artifacts-changed', { detail: { projectPath } }));
  };
  const removeSelectedArtifact = async () => {
    if (!selectedArtifact) return;
    if (selectedArtifact.kind === 'plan') await removePlan(selectedArtifact.id);
    if (selectedArtifact.kind === 'todo') await removeTodo(selectedArtifact.id);
    setSelectedArtifact(null);
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !selectedArtifact) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      void removeSelectedArtifact();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedArtifact, projectPath]);
  const isSelected = (kind: 'plan' | 'todo', id: string) => selectedArtifact?.kind === kind && selectedArtifact.id === id;
  const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const exportQuoteCsv = (quote: any) => {
    const rows = [
      ['Cotización', quote.title || 'Cotización'],
      ['Descripción', quote.description || ''],
      ['Estado', quote.status || ''],
      ['Moneda', quote.currency || 'USD'],
      [],
      ['Resultado', 'Métrica', 'Importe'],
      ...(quote.items || []).map((item: any) => [item.outcome || item.description || '', item.metric || '', item.total ?? item.amount ?? 0]),
      [],
      ['Total', '', quote.total ?? 0],
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(quote.title || 'cotizacion').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'cotizacion'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportQuoteImage = async (quote: any) => {
    const width = 1600;
    const padding = 56;
    const cardWidth = width - padding * 2;
    const rowHeight = 58;
    const title = String(quote.title || 'Cotización');
    const description = String(quote.description || '');
    const items = Array.isArray(quote.items) ? quote.items : [];
    const currency = quote.currency || 'USD';
    const formatMoney = (value: unknown) => {
      try { return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
      catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
    };
    const escapeXml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const wrapText = (value: string, maxChars: number) => {
      const words = value.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = '';
      words.forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next;
      });
      if (line || !lines.length) lines.push(line);
      return lines.slice(0, 2);
    };
    const rowData = items.map((item: any) => ({
      outcome: wrapText(String(item.outcome || item.description || ''), 50),
      metric: wrapText(String(item.metric || '—'), 30),
      amount: formatMoney(item.total ?? item.amount),
    }));
    const rowDataHeight = Math.max(rowHeight, ...rowData.map((row) => Math.max(row.outcome.length, row.metric.length) * 24 + 22));
    const height = 360 + rowData.length * rowDataHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(2, 2);
    const roundRect = (x: number, y: number, w: number, h: number, radius: number) => { context.beginPath(); context.roundRect(x, y, w, h, radius); };
    context.fillStyle = '#101010';
    context.fillRect(0, 0, width, height);
    roundRect(padding, padding, cardWidth, height - padding * 2, 18);
    context.fillStyle = '#151515';
    context.fill();
    context.strokeStyle = '#2b2b2b';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#eeeeee';
    context.font = '600 28px Inter, Segoe UI, sans-serif';
    context.fillText(title, padding + 32, padding + 48);
    context.fillStyle = '#c2c2c2';
    context.font = '16px Inter, Segoe UI, sans-serif';
    context.fillText(description.slice(0, 150), padding + 32, padding + 80);
    context.fillStyle = '#777777';
    context.font = '14px Inter, Segoe UI, sans-serif';
    context.fillText(`Estado: ${quote.status || 'draft'}   ·   Moneda: ${currency}`, padding + 32, padding + 112);
    const tableX = padding + 32;
    const tableY = padding + 150;
    const columns = [tableX, tableX + 690, tableX + 1110, tableX + cardWidth - 64];
    context.fillStyle = '#101010';
    context.fillRect(tableX, tableY, cardWidth - 64, 42);
    context.fillStyle = '#999999';
    context.font = '600 14px Inter, Segoe UI, sans-serif';
    context.fillText('RESULTADO', columns[0] + 16, tableY + 27);
    context.fillText('MÉTRICA', columns[1] + 16, tableY + 27);
    context.textAlign = 'right';
    context.fillText('IMPORTE', columns[3] - 16, tableY + 27);
    context.textAlign = 'left';
    rowData.forEach((row, index) => {
      const y = tableY + 42 + index * rowDataHeight;
      context.strokeStyle = '#2b2b2b';
      context.beginPath(); context.moveTo(tableX, y); context.lineTo(tableX + cardWidth - 64, y); context.stroke();
      context.fillStyle = '#c2c2c2';
      context.font = '16px Inter, Segoe UI, sans-serif';
      row.outcome.forEach((line, lineIndex) => context.fillText(line, columns[0] + 16, y + 26 + lineIndex * 22));
      context.fillStyle = '#999999';
      row.metric.forEach((line, lineIndex) => context.fillText(line, columns[1] + 16, y + 26 + lineIndex * 22));
      context.fillStyle = '#eeeeee';
      context.textAlign = 'right';
      context.fillText(row.amount, columns[3] - 16, y + 32);
      context.textAlign = 'left';
    });
    const totalY = tableY + 42 + rowData.length * rowDataHeight + 34;
    context.fillStyle = '#bbbbbb';
    context.font = '600 16px Inter, Segoe UI, sans-serif';
    context.textAlign = 'right';
    context.fillText('TOTAL', columns[2] + 190, totalY);
    context.fillStyle = '#eeeeee';
    context.font = '600 22px Inter, Segoe UI, sans-serif';
    context.fillText(formatMoney(quote.total), columns[3] - 16, totalY);
    context.textAlign = 'left';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(title).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'cotizacion'}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const copyArtifact = async (kind: 'plan' | 'todo' | 'quote', artifact: any) => {
    const content = kind === 'plan'
      ? [`Plan: ${artifact.title}`, `Estado: ${artifact.status}`, ...(artifact.steps || []).map((step: any) => `- [${step.status}] ${step.title}`)].join('\n')
      : kind === 'todo'
        ? `TODO: ${artifact.title}\nEstado: ${artifact.status}`
        : [`Cotización: ${artifact.title || 'Cotización'}`, artifact.description || '', ...(artifact.items || []).map((item: any) => `${item.outcome || item.description || ''} | ${item.metric || ''} | ${item.total ?? item.amount ?? 0}`), `Total: ${artifact.total ?? 0}`].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(content);
      if (kind === 'quote') { exportQuoteCsv(artifact); await exportQuoteImage(artifact); }
    } catch (error) {
      console.error('No se pudo copiar el artifact:', error);
    }
  };
  if (!hasProject) return <div className="flex flex-1 items-center justify-center p-5 text-center text-[11px] text-[#777]">{text.selectProjectArtifacts}</div>;
  return <div className="file-preview-scrollbar h-full max-h-full min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [&_section+section]:mt-4">
    <div className="mb-4 flex items-center justify-between">
      <div><div className="text-[12px] font-medium text-[#eee]">{text.artifacts}</div><div className="mt-0.5 text-[10px] text-[#666]">{text.artifactsDescription}</div></div>
      <span className="max-w-[120px] truncate text-right text-[10px] text-[#555]" title={projectName}>{projectName}</span>
    </div>
    {plans.length > 0 && <section className="mb-4"><div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#666]">{text.plan}</div><div className="grid gap-3">{plans.map((plan) => <div key={plan.id} onClick={() => setSelectedArtifact({ kind: 'plan', id: plan.id })} onDoubleClick={() => pushReference('plan', plan.id, plan.title)} onContextMenu={(event) => { event.preventDefault(); void copyArtifact('plan', plan); }} className="cursor-pointer rounded-lg border bg-[#151515] p-2.5" style={{ borderColor: isSelected('plan', plan.id) ? selectionColor : '#202020' }}>
      <div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] font-medium text-[#ddd]">{plan.title}</span><div className="flex shrink-0 items-center gap-1"><ArtifactStatus status={plan.status} language={language} />{isSelected('plan', plan.id) && <button type="button" onClick={(event) => { event.stopPropagation(); void removePlan(plan.id); }} className="grid h-5 w-5 place-items-center rounded text-[#777] hover:bg-[#2a1b1b] hover:text-[#e58c8c]" title={text.deletePlan} aria-label={text.deletePlan}><Trash2 size={12} /></button>}</div></div>
      <div className="grid gap-1.5">{plan.steps.map((step) => <div key={step.id} className="flex min-w-0 items-center gap-2 text-[10px]"><ArtifactStatus status={step.status} language={language} /><span title={step.title} className="min-w-0 truncate text-[#999]">{step.title}</span></div>)}</div>
    </div>)}</div><div className="mt-4 h-px bg-[#202020]" /></section>}
    {state.todos.length > 0 ? <section className="grid gap-1.5"><div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#666]">{text.todo}</div>{state.todos.map((todo) => <div key={todo.id} onClick={() => setSelectedArtifact({ kind: 'todo', id: todo.id })} onDoubleClick={() => pushReference('todo', todo.id, todo.title)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); void copyArtifact('todo', todo); }} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-[#151515] px-2 py-1.5" style={{ borderColor: isSelected('todo', todo.id) ? selectionColor : '#202020' }}><ArtifactStatus status={todo.status} language={language} /><span title={todo.title} className="min-w-0 flex-1 truncate text-[11px] text-[#bbb]">{todo.title}</span>{isSelected('todo', todo.id) && <button type="button" onClick={(event) => { event.stopPropagation(); void removeTodo(todo.id); }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#777] hover:bg-[#2a1b1b] hover:text-[#e58c8c]" title={text.deleteTodo} aria-label={text.deleteTodo}><Trash2 size={12} /></button>}</div>)}</section> : !state.plan && <div className="rounded-lg border border-dashed border-[#252525] px-3 py-5 text-center text-[11px] text-[#666]">{text.noTodosPlans}</div>}
  </div>;
}

function QuoteArtifact({ quote, selected, selectionColor, onSelect, onCopy, onReference, onRemove }: { quote: any; selected: boolean; selectionColor: string; onSelect: () => void; onCopy: () => void; onReference: () => void; onRemove: () => void }) {
  const formatMoney = (value: number) => { try { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: quote.currency || 'USD', maximumFractionDigits: 2 }).format(Number(value || 0)); } catch { return `${quote.currency || 'USD'} ${Number(value || 0).toFixed(2)}`; } };
  return <section onClick={onSelect} onDoubleClick={onReference} onContextMenu={(event) => { event.preventDefault(); void onCopy(); }} className="cursor-pointer overflow-hidden rounded-lg border bg-[#151515] [&_thead]:bg-[#101010] [&_thead_tr]:text-[#777]" style={{ borderColor: selected ? selectionColor : '#202020' }}>
    <div className="flex items-center justify-between gap-2 border-b border-[#202020] px-2.5 py-2"><div className="min-w-0"><div className="truncate text-[11px] font-medium text-[#ddd]">{quote.title || 'Cotización'}</div><div title={quote.description} className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[#777]">{quote.description}</div></div>{selected && <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(); }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#777] hover:bg-[#2a1b1b] hover:text-[#e58c8c]" title="Eliminar cotización" aria-label="Eliminar cotización"><Trash2 size={12} /></button>}</div>
    <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-[10px]"><thead><tr className="border-b border-[#202020] text-[#666]"><th className="px-2.5 py-1.5 font-medium">Resultado</th><th className="px-2.5 py-1.5 font-medium">Métrica</th><th className="px-2.5 py-1.5 text-right font-medium">Importe</th></tr></thead><tbody>{(quote.items || []).map((item: any, index: number) => <tr key={`${quote.id}-${index}`} className="border-b border-[#1d1d1d] text-[#aaa]"><td title={item.outcome || item.description} className="max-w-[150px] truncate px-2.5 py-1.5">{item.outcome || item.description}</td><td title={item.metric} className="max-w-[110px] truncate px-2.5 py-1.5">{item.metric || '—'}</td><td className="px-2.5 py-1.5 text-right">{formatMoney(item.total ?? item.amount)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2} className="px-2.5 py-2 text-right font-medium text-[#bbb]">Total</td><td className="px-2.5 py-2 text-right font-medium text-[#eee]">{formatMoney(quote.total)}</td></tr></tfoot></table></div>
  </section>;
}

function ArtifactStatus({ status, language = 'es' }: { status: TaskStatus; language?: AppLanguage }) {
  const text = rightSidebarTranslations[language];
  const values: Record<TaskStatus, [React.ElementType, string, string]> = { pending: [Circle, '#999', text.pending], in_progress: [CircleDot, '#999', text.inProgress], completed: [CheckCircle2, '#999', text.completed], cancelled: [Ban, '#999', text.cancelled], blocked: [CircleX, '#999', text.blocked] };
  const [Icon, color, label] = values[status] || values.pending;
  return <span title={label} style={{ color }} className="flex shrink-0 items-center gap-1 text-[10px]"><Icon size={13} strokeWidth={1.8} /><span>{label}</span></span>;
}
