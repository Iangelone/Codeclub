'use client';

/** Edits CSS/text on a selected live DOM node and tracks reversible preview changes. */
import { useEffect, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { browserStyleTranslations, type AppLanguage } from '../lib/i18n';

export type BrowserElementSelection = {
  title: string; text: string; html: string; x: number; y: number; markerId: string;
  selector: string; pageUrl: string; tagName: string; textEditable: boolean; originalText: string;
  styles: Record<string, string>;
};

export type BrowserElementChanges = {
  selector: string;
  styles: Record<string, { before: string; after: string }>;
  text?: { before: string; after: string };
};

const pixelProperties = ['font-size', 'border-radius', 'border-width', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
const colorSwatch = (value: string) => {
  const channels = value.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  return channels ? `#${channels.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}` : /^#[\da-f]{6}$/i.test(value) ? value : '#000000';
};

export default function BrowserStyleEditor({ element, language, onCancel, onConfirm, onPreview }: {
  element: BrowserElementSelection; language: AppLanguage; onCancel: () => void;
  onConfirm: (changes: BrowserElementChanges, description: string) => Promise<void>;
  onPreview: (markerId: string, changes: BrowserElementChanges) => Promise<boolean>;
}) {
  const text = browserStyleTranslations[language];
  const [values, setValues] = useState(element.styles);
  const [content, setContent] = useState(element.originalText);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);
  const changes: BrowserElementChanges = { selector: element.selector, styles: {} };
  for (const [property, value] of Object.entries(values)) {
    if (value.trim() !== element.styles[property]) changes.styles[property] = { before: element.styles[property], after: value.trim() };
  }
  if (element.textEditable && content !== element.originalText) changes.text = { before: element.originalText, after: content };
  const hasChanges = Object.keys(changes.styles).length > 0 || Boolean(changes.text);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const preview: BrowserElementChanges = { ...changes, styles: Object.fromEntries(Object.entries(changes.styles).filter(([property, change]) => CSS.supports(property, change.after) && (property !== 'opacity' || (Number(change.after) >= 0 && Number(change.after) <= 1)))) };
      void onPreview(element.markerId, preview).then((available) => { if (active) setUnavailable(!available); });
    }, 60);
    return () => { active = false; window.clearTimeout(timer); };
    // Description changes do not alter the preview; the marker identifies the exact DOM node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, content, element.markerId, onPreview]);
  const update = (property: string, value: string) => { setValues((current) => ({ ...current, [property]: value })); setError(''); };
  const field = (property: string, label: string, color = false) => {
    const pixels = pixelProperties.includes(property);
    return <label className="browser-style-row" key={property}><span>{label}</span><span className="browser-style-value">
      {color && <input disabled={pending} className="browser-style-swatch" type="color" value={colorSwatch(values[property] || '')} aria-label={`${text.pickColor}: ${label}`} title={`${text.pickColor}: ${label}`} onChange={(event) => update(property, event.target.value)} />}
      <input disabled={pending} value={pixels ? (values[property] || '').replace(/px$/, '') : values[property] || ''} aria-label={label} onChange={(event) => update(property, pixels && /^-?(?:\d+\.?\d*|\.\d+)$/.test(event.target.value) ? `${event.target.value}px` : event.target.value)} />
      {pixels && <span className="browser-style-unit">px</span>}
    </span></label>;
  };
  const spacing = (kind: 'padding' | 'margin') => <fieldset className="browser-style-spacing"><legend>{text[kind]}</legend><div>{['top', 'right', 'bottom', 'left'].map((side, index) => field(`${kind}-${side}`, text.sides[index]))}</div></fieldset>;

  return <form className="browser-style-editor" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending) onCancel(); } }} onSubmit={async (event) => {
    event.preventDefault();
    if (!hasChanges || pending || unavailable) return;
    for (const [property, change] of Object.entries(changes.styles)) {
      if (!CSS.supports(property, change.after) || (property === 'opacity' && (Number(change.after) < 0 || Number(change.after) > 1))) { setError(`${text.invalidValue}: ${property}`); return; }
    }
    setPending(true);
    try { await onConfirm(changes, description.trim()); }
    catch { setError(text.previewUnavailable); setPending(false); }
  }}>
    <header><SlidersHorizontal size={17} aria-hidden="true" /><input autoFocus disabled={pending} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={text.description} aria-label={text.description} /></header>
    <div className="browser-style-element" title={element.selector}>&lt;{element.tagName}&gt;</div>
    <div className="browser-style-fields">
      {element.textEditable && <label className="browser-style-row"><span>{text.content}</span><span className="browser-style-value"><input disabled={pending} value={content} onChange={(event) => setContent(event.target.value)} aria-label={text.content} /></span></label>}
      {field('color', text.color, true)}{field('background-color', text.background, true)}{field('opacity', text.opacity)}
      <div className="browser-style-divider" />
      {field('font-family', text.fontFamily)}{field('font-size', text.fontSize)}{field('font-weight', text.fontWeight)}
      <div className="browser-style-divider" />
      {field('border-radius', text.borderRadius)}{field('border-color', text.borderColor, true)}{field('border-width', text.borderWidth)}
      <div className="browser-style-divider" />
      {field('width', text.width)}{field('height', text.height)}{spacing('padding')}{spacing('margin')}
    </div>
    {(error || unavailable) && <p className="browser-style-error" role="alert">{error || text.previewUnavailable}</p>}
    <footer><button type="button" disabled={pending} onClick={onCancel}>{text.cancel}</button><button type="submit" disabled={!hasChanges || pending || unavailable} aria-label={text.confirm} title={text.confirm}><Check size={18} /></button></footer>
  </form>;
}
