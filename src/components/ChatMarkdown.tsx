/** Shared Markdown rendering for conversations and project previews. */
import React, { useState } from 'react';
import { Check, Code2, Copy, Play } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { copyText } from '../lib/runtime';
import { useAppLanguage, translate } from '../lib/i18n';

const getMarkdownLinkFavicon = (href?: string) => {
  try {
    const url = new URL(href || '');
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`;
  } catch {
    return '';
  }
};
const getMarkdownNodeText = (node: React.ReactNode): string => React.Children.toArray(node).map((child) => {
  if (!React.isValidElement(child)) return String(child);
  const props = child.props as { children?: React.ReactNode };
  return getMarkdownNodeText(props.children);
}).join('');
const getMarkdownCodeDetails = (children: React.ReactNode) => {
  const codeElement = React.Children.toArray(children).find((child) => React.isValidElement(child)) as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
  const className = codeElement?.props.className || '';
  const language = className.match(/language-([^\s]+)/)?.[1] || 'text';
  const content = codeElement?.props.children ?? children;
  return { language, content: getMarkdownNodeText(content) };
};

function MarkdownCodeBlock({ children }: { children?: React.ReactNode }) {
  const appLanguage = useAppLanguage();
  const [copied, setCopied] = useState(false);
  const { language, content } = getMarkdownCodeDetails(children);
  const label = language === 'text' ? translate('chatMarkdown.texto', appLanguage) : language.charAt(0).toUpperCase() + language.slice(1);

  const handleCopy = async () => {
    await copyText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return <div className="chat-code-card">
    <div className="chat-code-card-header">
      <span className="chat-code-card-language"><Code2 size={14} strokeWidth={1.8} aria-hidden="true" />{label}</span>
      <span className="chat-code-card-actions">
        <button type="button" className="chat-code-card-icon-button" onClick={() => window.dispatchEvent(new CustomEvent('codeclub:execute-inline-code', { detail: { code: content, language } }))} aria-label={translate('chatMarkdown.runCode', appLanguage)} title={translate('chatMarkdown.runCode', appLanguage)}><Play size={13} strokeWidth={2} aria-hidden="true" /></button>
        <span className="chat-code-card-divider" aria-hidden="true">|</span>
        <button type="button" className="chat-code-card-copy" onClick={() => void handleCopy()} aria-label={copied ? (translate('chatMarkdown.codeCopied', appLanguage)) : (translate('chatMarkdown.copyCode', appLanguage))} title={copied ? (translate('chatMarkdown.copied', appLanguage)) : (translate('chatMarkdown.copy', appLanguage))}>
          {copied ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.9} aria-hidden="true" />}
          <span>{copied ? (translate('chatMarkdown.copied', appLanguage)) : (translate('chatMarkdown.copy', appLanguage))}</span>
        </button>
      </span>
    </div>
    <pre>{children}</pre>
  </div>;
}

function MarkdownInlineCode({ children }: { children?: React.ReactNode }) {
  return <code className="chat-inline-code">{children}</code>;
}

export const MemoizedChatMarkdown = React.memo(function MemoizedChatMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    p: ({ children }) => <p>{children}</p>,
    ul: ({ children }) => <ul>{children}</ul>,
    ol: ({ children }) => <ol>{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    a: ({ children, href }) => {
      const favicon = getMarkdownLinkFavicon(href);
      return <a href={href} target="_blank" rel="noreferrer">{favicon && <img src={favicon} alt="" aria-hidden="true" className="chat-markdown-link-icon" loading="lazy" />}{children}</a>;
    },
    table: ({ children }) => <div className="chat-markdown-table"><table>{children}</table></div>,
    th: ({ children }) => <th>{children}</th>,
    td: ({ children }) => <td>{children}</td>,
    pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
    code: ({ children, className }) => className ? <code className={className}>{children}</code> : <MarkdownInlineCode>{children}</MarkdownInlineCode>,
    h1: ({ children }) => <h1>{children}</h1>,
    h2: ({ children }) => <h2>{children}</h2>,
    h3: ({ children }) => <h3>{children}</h3>,
  }}>{content}</ReactMarkdown>;
});
