# Accessibility

## Scope and field protection

This pass improves the existing desktop, floating-widget, and public-page controls. It does not introduce product features or new runtime dependencies.

Editable controls are explicitly excluded from source changes: `input`, `textarea`, `select`, and the CodeMirror editor. Existing field values, attributes, placeholders, styles, typing handlers, and autofocus behavior remain intact. The 26 existing JSX field elements were extracted with the installed Babel parser before editing and compared byte for byte afterward. New focus and motion CSS targets buttons, links, navigation items, and decorative action labels. Existing field-specific CSS is unchanged.

Modal keyboard boundaries include existing fields in the native Tab sequence; they do not intercept typing, arrow keys, or text editing. Popup keyboard handlers ignore fields, contenteditable elements, CodeMirror, and xterm. Searchable selectors retain their existing search-field autofocus.

## Shared interaction rules

`src/components/ui/use-accessible-overlay.ts` contains three narrowly scoped hooks:

- `useDialogAccessibility`: remembers the opener, makes unrelated body surfaces inert, focuses a modal container only when existing autofocus has not already moved focus inside, keeps Tab/Shift+Tab within visible enabled controls, closes with Escape, and restores focus to an available opener. It restores the previous inert state and removes listeners on cleanup. Task editing preserves its existing initial field focus.
- `usePopupKeyboard`: focuses the current selected/checked option or first enabled item, supports Up/Down and Home/End, closes with Escape or Tab, and restores the trigger after menu activation. Enter and Space retain native button activation. Field-originating keyboard events are excluded.
- `useFileTreeKeyboard`: uses one Tab stop in the file tree. Up/Down traverse visible rows, Home/End reach the first/last row, Right expands a folder or enters its children, and Left collapses a folder or moves to its parent. Native Enter/Space activate existing file/folder buttons. This hook never targets the file editor.

Each hook installs and removes listeners in the same effect. Callback refs keep closures current without resetting focus on every parent render. Focusable candidates exclude hidden/inert surfaces and controls disabled through a fieldset.

## Surface coverage

| Surface | Existing behavior improved |
| --- | --- |
| Main navigation and sidebars | Named controls, current-chat state, category expanded state, hidden-surface isolation, visible keyboard focus, and English/Spanish labels. Existing skip navigation remains available. |
| Right panels | Tab keyboard navigation, localized menu names, visible close controls on keyboard focus, and exclusion of hidden panel content from interaction. File dialogs follow actual panel visibility. |
| Customize | Vertical sidebar tabs use Up/Down; horizontal tabs use Left/Right. Home/End work in both orientations. All controls reference an existing shared tabpanel. Switch names remain stable while checked state changes. The main panel's current ID participates in the existing responsive container rules, preserving readable names and action spacing from its 320px minimum width. |
| Task editing | Background isolation, existing field autofocus and Tab behavior, keyboard selectors with listbox/option semantics, selected values, and nested Escape handling. Selector values follow language changes without changing task text. |
| Task details | Status updates use an atomic polite status region. Existing errors retain alert semantics. |
| Orb editing | A specific dialog ref replaces document-wide dialog lookup. Focus is local, the background is inert, Escape closes the editor, and focus returns to its opener. Existing combobox input handlers remain unchanged. |
| Files | A named dialog with a visible close button invokes the existing close action. The tree exposes level, position, set size, expanded state, and current-file state. File selection buttons expose pressed state. |
| Review | Modal isolation and focus restoration; change-group and branch menus receive keyboard navigation. Existing searchable branch input behavior remains unchanged. |
| Chat | Response menus support keyboard navigation. Remove-reference/file/skill/extension buttons name both the action and its target. The message log is busy during transitions, history loads, and agent execution, avoiding intermediate streaming announcements. The entire workspace is no longer a competing live region. |
| Browser | More-options controls expose menu semantics and keyboard navigation. Existing address and comment fields and embedded-page editing are excluded. |
| Floating widget | Existing named controls and reduced-motion-aware shell behavior remain intact; shared focus rules improve keyboard visibility. Automatic hiding pauses while keyboard focus is inside the widget. Pointer dragging and native positioning are unchanged. |
| Public landing page | English content declares its language, navigation has a name, and the adjacent brand image no longer repeats the link text. |

## Visual access

- Keyboard focus on buttons and links uses a visible 2px accent outline. Hover-only close controls become opaque while focused.
- The selected-text toolbar uses compact neutral gray menu styling; hover does not inherit the orb accent, and keyboard focus remains visible.
- Low-contrast static gray labels on dark surfaces use `#999999` instead of `#777777`/`#888888`. Elements containing editable fields and disabled controls were excluded from that source adjustment.
- Windows forced-colors mode uses system focus colors and disabled-control colors.
- Decorative shimmer on action labels stops under `prefers-reduced-motion: reduce`. Motion components already inherit the app's reduced-motion configuration. Orbs respect the same preference.

These changes retain compact control geometry. They do not claim that every compact icon meets a 44px target size, or that embedded websites and third-party terminal/editor content meet WCAG.

## Verification

Run after `npm run next:build`, because the browser fixtures read the generated stylesheet:

```text
node scripts/test-accessibility.mjs
node scripts/test-sidebar-layout.mjs
node scripts/test-extensions-layout.mjs
node scripts/test-page-bootstrap.mjs
npm run electron:compile
git diff --check
```

The accessibility regression renders real TaskEditorModal, ScheduledSelect, ProjectPanelView, OrbsPanel, and sidebar ExtensionsPanel with an isolated native bridge. It checks modal naming/isolation, unchanged initial field focus, focus return, selector keys, nested Escape, Tab boundaries, tree navigation, vertical tabs, real tabpanel references, language, and Windows High Contrast focus.

The sidebar regression covers navigation, persistence, resizing, hidden panels, and language switching. The extension regression checks responsive layouts and actions across Spanish/English. Bootstrap checks normal/floating initialization and fullscreen state.

These are browser-level regressions with native operations mocked. Actual screen-reader speech, Windows WebView behavior, PTY execution, native pointer dragging, and user-specific display/contrast settings still require manual desktop verification. No accessibility certification is implied.

## Follow-up review — October 10, 2026

The existing 26 editable JSX controls were compared byte for byte with a parser snapshot and remain unchanged. Modal boundary navigation now excludes negative tab stops. Popup dismissal with Tab preserves native forward navigation instead of returning focus to the opener. Project context menus focus their actual trigger before opening, so Escape returns to the selected project. The quick project picker has radio-menu semantics, selected state, arrow navigation, Escape, and outside-click dismissal. The terminal container is a named region; xterm retains its own keyboard behavior.

English development-command labels and descriptions now use the shared language catalog. English selections explicitly request English responses. The historical functional review and the remaining three Spanish source comments were translated to English.

`npm run desktop:debug` starts the development renderer and forwards the accessibility-debug flag to Electron. `npm run test:debug` compiles Electron and verifies DevTools, forced accessibility support, preload, and a native read-only IPC call with a disposable profile and a local renderer fixture. It does not use saved accounts or commercial providers. Browser tests still do not certify screen-reader speech or third-party page accessibility.
