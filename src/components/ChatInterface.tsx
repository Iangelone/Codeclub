import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, Copy, RotateCcw } from 'lucide-react';
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export default function ChatInterface({ catalog, defaultProvider, defaultModel }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [composerDocked, setComposerDocked] = useState(false);
  
  const [currentProvider, setCurrentProvider] = useState(defaultProvider);
  const [currentModel, setCurrentModel] = useState(defaultModel);

  const [menuOpen, setMenuOpen] = useState(false);
  const [commandKind, setCommandKind] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [activeChat, setActiveChat] = useState<{chatId: string, projectPath: string} | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState('blank');
  const [activeNote, setActiveNote] = useState<{noteId: string, projectPath: string, name?: string} | null>(null);
  const [activeTable, setActiveTable] = useState<{tableId: string, projectPath: string, name?: string} | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [tableData, setTableData] = useState<string[][]>([]);
  const noteSaveTimer = useRef(null);
  const tableSaveTimer = useRef(null);
  const commandMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    const handleOpenChat = async (e: any) => {
      const chat = e.detail;
      setWorkspaceMode('chat');
      setActiveChat(chat);
      setComposerDocked(false);
      setMessages([]);
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${chat.projectPath}/.codeclub/chats/${chat.chatId}.jsonl`;
        if (await exists(path)) {
          const content = await readTextFile(path);
          const lines = content.split('\n').filter(l => l.trim() !== '');
          const parsed = lines.map(l => JSON.parse(l));
          setMessages(parsed);
          setComposerDocked(parsed.length > 0);
        }
      } catch (err) {
        console.error("Error loading chat:", err);
      }
    };
    window.addEventListener('codeclub:open-chat', handleOpenChat);
    return () => window.removeEventListener('codeclub:open-chat', handleOpenChat);
  }, []);

  useEffect(() => {
    const handleOpenBlank = () => {
      setWorkspaceMode('blank');
      setActiveNote(null);
      setActiveTable(null);
    };

    const handleOpenNote = async (e: any) => {
      const note = e.detail;
      setWorkspaceMode('note');
      setActiveNote(note);
      setTitleDraft(note.name || 'Nota');
      setActiveTable(null);
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${note.projectPath}/.codeclub/notes/${note.noteId}.md`;
        setNoteContent((await exists(path)) ? await readTextFile(path) : '');
      } catch (err) {
        console.error("Error loading note:", err);
        setNoteContent('');
      }
    };

    const handleOpenTable = async (e: any) => {
      const table = e.detail;
      setWorkspaceMode('table');
      setActiveTable(table);
      setTitleDraft(table.name || 'Tabla');
      setActiveNote(null);
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${table.projectPath}/.codeclub/tables/${table.tableId}.json`;
        const fallback = Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => ''));
        setTableData((await exists(path)) ? JSON.parse(await readTextFile(path)) : fallback);
      } catch (err) {
        console.error("Error loading table:", err);
        setTableData(Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => '')));
      }
    };

    window.addEventListener('codeclub:open-blank', handleOpenBlank);
    window.addEventListener('codeclub:open-note', handleOpenNote);
    window.addEventListener('codeclub:open-table', handleOpenTable);
    return () => {
      window.removeEventListener('codeclub:open-blank', handleOpenBlank);
      window.removeEventListener('codeclub:open-note', handleOpenNote);
      window.removeEventListener('codeclub:open-table', handleOpenTable);
    };
  }, []);

  useEffect(() => {
    const handleRenamedNote = (e: any) => {
      if (!activeNote || e.detail.itemId !== activeNote.noteId || e.detail.projectPath !== activeNote.projectPath) return;
      setActiveNote({ ...activeNote, name: e.detail.name });
      setTitleDraft(e.detail.name);
    };

    const handleRenamedTable = (e: any) => {
      if (!activeTable || e.detail.itemId !== activeTable.tableId || e.detail.projectPath !== activeTable.projectPath) return;
      setActiveTable({ ...activeTable, name: e.detail.name });
      setTitleDraft(e.detail.name);
    };

    window.addEventListener('codeclub:renamed-note', handleRenamedNote);
    window.addEventListener('codeclub:renamed-table', handleRenamedTable);
    return () => {
      window.removeEventListener('codeclub:renamed-note', handleRenamedNote);
      window.removeEventListener('codeclub:renamed-table', handleRenamedTable);
    };
  }, [activeNote, activeTable]);

  const openCommandMenu = (kind) => {
    setCommandKind(kind);
    setMenuOpen(true);
    setSearchQuery('');
    setActiveCommandIndex(0);
    setTimeout(() => commandMenuRef.current?.focus(), 10);
  };

  const filteredCatalog = catalog.filter((item) => {
    const matchesKind = item.type === commandKind;
    const itemLabel = item.label || item.id || '';
    const matchesQuery = itemLabel.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProvider = commandKind !== 'model' || item.providerId === currentProvider?.id;
    return matchesKind && matchesQuery && matchesProvider;
  });

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandKind, searchQuery]);

  useEffect(() => {
    if (!menuOpen) return;
    const activeItem = commandMenuRef.current?.querySelector(`[data-command-index="${activeCommandIndex}"]`);
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [activeCommandIndex, menuOpen, filteredCatalog.length]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event) => {
      if (commandMenuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const handleItemClick = (item) => {
    if (item.type === 'provider') {
      setCurrentProvider(item);
      const firstModel = catalog.find((m) => m.type === 'model' && m.providerId === item.id);
      if (firstModel) setCurrentModel(firstModel);
    } else if (item.type === 'model') {
      setCurrentModel(item);
    }
    setInput((prev) => prev.replace(/\/(proveedor|modelo)$/i, '').trimStart());
    setMenuOpen(false);
    chatInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      handleCommandMenuKeyDown(e);
    }
  };

  const handleCommandMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      chatInputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCatalog.length === 0) return;
      setActiveCommandIndex((index) => Math.min(index + 1, filteredCatalog.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCatalog.length === 0) return;
      setActiveCommandIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (e.key === 'Enter' && filteredCatalog[activeCommandIndex]) {
      e.preventDefault();
      handleItemClick(filteredCatalog[activeCommandIndex]);
    }
  };

  const logPersistence = async (action, status, detail = {}) => {
    const entry = {
      at: new Date().toISOString(),
      action,
      status,
      ...detail,
    };

    console.info("[codeclub:persist]", entry);

    try {
      const { readTextFile, writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
      const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
      const appDataPath = await appLocalDataDir();
      const logPath = await join(appDataPath, 'persistence-log.jsonl');
      await mkdir(appDataPath, { recursive: true });
      const previous = (await exists(logPath)) ? await readTextFile(logPath) : '';
      await writeTextFile(logPath, `${previous}${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.error("[codeclub:persist] log failed", error);
    }
  };

  const appendToJsonl = async (msg) => {
    if (!activeChat) return;
    try {
      const { writeTextFile, readTextFile, exists } = await import('@tauri-apps/plugin-fs');
      const path = `${activeChat.projectPath}/.codeclub/chats/${activeChat.chatId}.jsonl`;
      let content = '';
      if (await exists(path)) {
        content = await readTextFile(path);
        if (content && !content.endsWith('\n')) content += '\n';
      }
      content += JSON.stringify(msg) + '\n';
      await writeTextFile(path, content);
      await logPersistence('append_chat_message', 'ok', {
        role: msg.role,
        chatId: activeChat.chatId,
        projectPath: activeChat.projectPath,
        path,
      });
    } catch (e) {
      console.error("FS Append Error:", e);
      await logPersistence('append_chat_message', 'error', {
        role: msg.role,
        chatId: activeChat?.chatId,
        projectPath: activeChat?.projectPath,
        error: e?.message || String(e),
      });
    }
  };

  const writeChatJsonl = async (nextMessages) => {
    if (!activeChat) return;
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = `${activeChat.projectPath}/.codeclub/chats`;
      const path = `${dir}/${activeChat.chatId}.jsonl`;
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, nextMessages.map((msg) => JSON.stringify(msg)).join('\n') + '\n');
      await logPersistence('rewrite_chat_history', 'ok', {
        chatId: activeChat.chatId,
        projectPath: activeChat.projectPath,
        path,
      });
    } catch (e) {
      await logPersistence('rewrite_chat_history', 'error', {
        chatId: activeChat?.chatId,
        projectPath: activeChat?.projectPath,
        error: e?.message || String(e),
      });
    }
  };

  const saveNote = async (content) => {
    if (!activeNote) return;
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = `${activeNote.projectPath}/.codeclub/notes`;
      const path = `${dir}/${activeNote.noteId}.md`;
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, content);
      await logPersistence('save_note', 'ok', { noteId: activeNote.noteId, projectPath: activeNote.projectPath, path });
    } catch (e) {
      await logPersistence('save_note', 'error', { noteId: activeNote?.noteId, error: e?.message || String(e) });
    }
  };

  const queueSaveNote = (content) => {
    setNoteContent(content);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => saveNote(content), 350);
  };

  const saveTable = async (nextTable) => {
    if (!activeTable) return;
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = `${activeTable.projectPath}/.codeclub/tables`;
      const path = `${dir}/${activeTable.tableId}.json`;
      await mkdir(dir, { recursive: true });
      await writeTextFile(path, JSON.stringify(nextTable));
      await logPersistence('save_table', 'ok', { tableId: activeTable.tableId, projectPath: activeTable.projectPath, path });
    } catch (e) {
      await logPersistence('save_table', 'error', { tableId: activeTable?.tableId, error: e?.message || String(e) });
    }
  };

  const updateTableCell = (rowIndex, columnIndex, value) => {
    const nextTable = tableData.map((row) => [...row]);
    nextTable[rowIndex][columnIndex] = value;
    setTableData(nextTable);
    if (tableSaveTimer.current) clearTimeout(tableSaveTimer.current);
    tableSaveTimer.current = setTimeout(() => saveTable(nextTable), 350);
  };

  const renameActiveArtifact = () => {
    const artifact = workspaceMode === 'note' ? activeNote : activeTable;
    if (!artifact) return;
    const name = titleDraft.trim() || (workspaceMode === 'note' ? 'Nota' : 'Tabla');
    const itemId = workspaceMode === 'note' ? artifact.noteId : artifact.tableId;
    window.dispatchEvent(new CustomEvent('codeclub:rename-artifact', {
      detail: { kind: workspaceMode, itemId, projectPath: artifact.projectPath, name },
    }));
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      renameActiveArtifact();
    }
    if (e.key === 'Escape') {
      setTitleDraft(workspaceMode === 'note' ? (activeNote?.name || 'Nota') : (activeTable?.name || 'Tabla'));
      e.currentTarget.blur();
    }
  };

  const sendMessage = async (content, baseMessages = messages, shouldRenameChat = messages.length === 0, replaceHistory = false) => {
    if (!activeChat) {
      window.dispatchEvent(new CustomEvent('codeclub:require-project'));
      return;
    }

    if (shouldRenameChat) {
      let title = content.trim();
      if (title.length > 20) title = title.substring(0, 20) + '...';
      window.dispatchEvent(new CustomEvent('codeclub:rename-chat', {
        detail: { chatId: activeChat.chatId, newName: title, projectPath: activeChat.projectPath }
      }));
    }

    const userMessage = { role: 'user', content };
    const newMessages = [...baseMessages, userMessage];
    setComposerDocked(true);
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    
    if (replaceHistory) {
      await writeChatJsonl(newMessages);
    } else {
      await appendToJsonl(userMessage);
    }

    try {
      let apiKey = localStorage.getItem(`${currentProvider.id}_api_key`);
      
      if (!apiKey || apiKey === 'dummy-key') {
        throw new Error(`API Key no configurada para ${currentProvider.label || currentProvider.id}. Por favor agregala en la configuración.`);
      }
      
      const provider = createOpenAICompatible({
        name: currentProvider.id,
        baseURL: currentProvider.api || 'https://api.openai.com/v1',
        apiKey,
      });

      const { textStream } = streamText({
        model: provider(currentModel.id),
        messages: newMessages,
      });

      let assistantContent = '';
      setMessages([...newMessages, { role: 'assistant', content: '' }]);

      for await (const chunk of textStream) {
        assistantContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
          return updated;
        });
      }
      
      const assistantMessage = { role: 'assistant', content: assistantContent };
      if (replaceHistory) {
        await writeChatJsonl([...newMessages, assistantMessage]);
      } else {
        await appendToJsonl(assistantMessage);
      }
    } catch (error) {
      console.error("Stream error:", error);
      // Delete the empty assistant message that was meant for streaming
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].content === '' && updated[updated.length - 1].role === 'assistant') {
          updated.pop();
        }
        return updated;
      });
      setInput(error.message);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    if (/\/proveedor$/i.test(input.trim())) {
      openCommandMenu('provider');
      return;
    }

    if (/\/modelo$/i.test(input.trim())) {
      openCommandMenu('model');
      return;
    }

    await sendMessage(input.trim());
  };

  const handleCopyMessage = async (content) => {
    await navigator.clipboard?.writeText(content);
  };

  const handleRetryMessage = async (messageIndex) => {
    if (isStreaming) return;
    const message = messages[messageIndex];
    if (!message || message.role !== 'user') return;
    await sendMessage(message.content, messages.slice(0, messageIndex), false, true);
  };

  if (workspaceMode === 'blank') {
    return (
      <div style={{ width: 'min(600px, calc(100% - 64px))', display: 'grid', placeItems: 'center', color: 'rgba(216, 216, 216, 0.42)', fontSize: '13px' }}>
        Seleccioná un chat, nota o tabla
      </div>
    );
  }

  if (workspaceMode === 'note') {
    return (
      <div className="note-panel" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '14px' }}>
        <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={handleTitleKeyDown} style={{ border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '28px', fontWeight: 600 }} />
        <textarea value={noteContent} onChange={(e) => queueSaveNote(e.target.value)} placeholder="Escribí una nota..." style={{ resize: 'none', border: 0, outline: 'none', background: 'transparent', color: '#d8d8d8', fontSize: '14px', lineHeight: 1.7, fontFamily: 'inherit', overflow: 'auto', scrollbarWidth: 'none' }} />
      </div>
    );
  }

  if (workspaceMode === 'table') {
    return (
      <div className="table-panel" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '14px' }}>
        <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={handleTitleKeyDown} style={{ border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '28px', fontWeight: 600 }} />
        <div style={{ overflow: 'auto', scrollbarWidth: 'none', border: '1px solid var(--color-surface-9, #2c2c2c)', borderRadius: '8px', background: '#121212' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <tbody>
              {tableData.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex} style={{ border: '1px solid #2b2b2b', padding: 0 }}>
                      <input value={cell} onChange={(e) => updateTableCell(rowIndex, columnIndex, e.target.value)} style={{ width: '100%', minHeight: '36px', boxSizing: 'border-box', border: 0, outline: 'none', background: 'transparent', color: '#d8d8d8', padding: '0 10px', fontSize: '12px' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface-container" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: composerDocked ? 'minmax(0, 1fr) auto' : '1fr', placeItems: composerDocked ? 'stretch' : 'center', gap: '10px', overflow: 'visible', paddingBottom: composerDocked ? '18px' : 0 }}>
      
      {/* Zona de mensajes */}
      <div className="messages-area" style={{ minHeight: 0, height: '100%', overflowY: 'auto', display: composerDocked ? 'flex' : 'none', flexDirection: 'column', gap: '1rem', paddingBottom: '10px', scrollbarWidth: 'none', overscrollBehavior: 'contain' }}>
        <div aria-hidden="true" style={{ flex: '1 0 auto' }} />
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', display: 'grid', justifyItems: m.role === 'user' ? 'end' : 'start', gap: '5px', maxWidth: '80%' }}>
            <div style={{ background: m.role === 'user' ? 'var(--color-surface-7, #2c2c2c)' : 'transparent', padding: '8px 12px', borderRadius: '8px', color: '#eee' }}>
              {m.content}
            </div>
            {m.role === 'user' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.72 }}>
                <button type="button" aria-label="Copiar mensaje" onClick={() => handleCopyMessage(m.content)} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: 'pointer' }}>
                  <Copy size={13} strokeWidth={2} />
                </button>
                <button type="button" aria-label="Reintentar desde este mensaje" onClick={() => handleRetryMessage(i)} disabled={isStreaming} style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '6px', background: 'transparent', color: 'rgba(216, 216, 216, 0.62)', cursor: isStreaming ? 'not-allowed' : 'pointer' }}>
                  <RotateCcw size={13} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-composer" style={{ width: 'min(600px, 100%)', justifySelf: 'center', position: 'relative', display: 'grid', gap: '10px', transform: composerDocked ? 'translateY(18px)' : 'translateY(0)', transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
        <div className="composer-status" style={{ display: 'flex', alignItems: 'center', justifyContent: composerDocked ? 'flex-start' : 'center', gap: '8px', color: composerDocked ? 'rgba(216, 216, 216, 0.42)' : undefined, fontSize: composerDocked ? '12px' : undefined }}>
          <span className="braille-spinner" aria-hidden="true" style={{ position: 'relative', color: '#c7cbff' }} />
          {composerDocked ? (
            <span style={{ color: 'rgba(216, 216, 216, 0.82)' }}>{isStreaming ? "Generando..." : "Listo cuando tú lo estés."}</span>
          ) : (
            <p style={{ margin: 0, color: 'rgba(216, 216, 216, 0.82)', fontSize: '16px' }}>{isStreaming ? "Generando..." : "Listo cuando tú lo estés."}</p>
          )}
          {composerDocked && (
            <>
              <span>{currentProvider?.label || 'Sin proveedor'}</span>
              <span style={{ color: 'rgba(216, 216, 216, 0.24)' }}>/</span>
              <span>{currentModel?.label || 'Sin modelo'}</span>
            </>
          )}
        </div>

        <div className="selection-status" style={{ display: composerDocked ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'rgba(216, 216, 216, 0.42)', fontSize: '12px' }}>
          <span>{currentProvider?.label || 'Sin proveedor'}</span>
          <span style={{ color: 'rgba(216, 216, 216, 0.24)' }}>/</span>
          <span>{currentModel?.label || 'Sin modelo'}</span>
        </div>

        <form onSubmit={handleSubmit} className="composer-box" style={{ minHeight: '40px', display: 'grid', gridTemplateColumns: '1fr 28px', alignItems: 'center', gap: '4px', padding: '5px', border: '1px solid var(--color-surface-9, #2f2f2f)', borderRadius: '8px', background: '#121212', boxShadow: '0 18px 52px rgba(0, 0, 0, 0.26)' }}>
          <input
            ref={chatInputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setMenuOpen(false)}
            placeholder="Preguntá, pedí código o describí una tarea"
            aria-label="Mensaje"
            style={{ appearance: 'none', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '12px', padding: '0 7px' }}
          />
          <button type="submit" disabled={isStreaming} className="send-button" aria-label="Enviar" style={{ width: '28px', height: '28px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '7px', background: 'var(--color-surface-8, #2c2c2c)', color: '#ffffff', cursor: isStreaming ? 'not-allowed' : 'pointer' }}>
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        </form>

        <div
          ref={commandMenuRef}
          tabIndex={-1}
          onKeyDown={handleCommandMenuKeyDown}
          className={`command-menu ${menuOpen ? 'is-open' : ''}`}
          style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 8px)', display: menuOpen ? 'grid' : 'none', gap: '8px', padding: '9px', border: '1px solid var(--color-surface-9, #2f2f2f)', borderRadius: '8px', background: '#121212', boxShadow: '0 20px 58px rgba(0, 0, 0, 0.34)', zIndex: 10, outline: 'none' }}
        >

          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={commandKind === 'provider' ? 'Buscar proveedor' : 'Buscar modelo del proveedor activo'}
            style={{ height: '30px', padding: '0 8px', borderRadius: '7px', background: 'var(--color-surface-3, #1c1c1c)', fontSize: '12px', color: '#eeeeee', border: 'none', outline: 'none' }}
          />
          <div className="command-list" style={{ display: 'grid', gap: '4px', maxHeight: '120px', overflow: 'auto', scrollbarWidth: 'none', paddingBottom: '12px', maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' }}>
            {filteredCatalog.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-command-index={index}
                onClick={() => handleItemClick(item)}
                onFocus={() => setActiveCommandIndex(index)}
                onMouseEnter={() => setActiveCommandIndex(index)}
                style={{ minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: 0, borderRadius: '7px', background: index === activeCommandIndex ? 'var(--color-surface-7, #2c2c2c)' : 'transparent', color: index === activeCommandIndex ? '#ffffff' : 'rgba(238, 238, 238, 0.78)', fontSize: '12px', padding: '0 9px', textAlign: 'left', cursor: 'pointer' }}
              >
                <span>{item.label}</span>
                <small style={{ color: 'rgba(216, 216, 216, 0.36)', fontSize: '11px' }}>
                  {item.type === 'provider' ? 'proveedor' : 'modelo'}
                </small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

