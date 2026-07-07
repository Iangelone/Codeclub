import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export default function ChatInterface({ catalog, defaultProvider, defaultModel }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  
  const [currentProvider, setCurrentProvider] = useState(defaultProvider);
  const [currentModel, setCurrentModel] = useState(defaultModel);

  const [menuOpen, setMenuOpen] = useState(false);
  const [commandKind, setCommandKind] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<{chatId: string, projectPath: string} | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState('blank');
  const [activeNote, setActiveNote] = useState<{noteId: string, projectPath: string, name?: string} | null>(null);
  const [activeTable, setActiveTable] = useState<{tableId: string, projectPath: string, name?: string} | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [tableData, setTableData] = useState<string[][]>([]);
  const noteSaveTimer = useRef(null);
  const tableSaveTimer = useRef(null);
  const searchInputRef = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    const handleOpenChat = async (e: any) => {
      const chat = e.detail;
      setWorkspaceMode('chat');
      setActiveChat(chat);
      setMessages([]);
      try {
        const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
        const path = `${chat.projectPath}/.codeclub/chats/${chat.chatId}.jsonl`;
        if (await exists(path)) {
          const content = await readTextFile(path);
          const lines = content.split('\n').filter(l => l.trim() !== '');
          const parsed = lines.map(l => JSON.parse(l));
          setMessages(parsed);
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
    if (input.endsWith('/proveedor')) {
      setCommandKind('provider');
      setMenuOpen(true);
      setSearchQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 10);
    } else if (input.endsWith('/modelo')) {
      setCommandKind('model');
      setMenuOpen(true);
      setSearchQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 10);
    } else {
      setMenuOpen(false);
    }
  }, [input]);

  const filteredCatalog = catalog.filter((item) => {
    const matchesKind = item.type === commandKind;
    const itemLabel = item.label || item.id || '';
    const matchesQuery = itemLabel.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProvider = commandKind !== 'model' || item.providerId === currentProvider?.id;
    return matchesKind && matchesQuery && matchesProvider;
  });

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    
    if (!activeChat) {
      window.dispatchEvent(new CustomEvent('codeclub:require-project'));
      return;
    }

    if (messages.length === 0) {
      let title = input.trim();
      if (title.length > 20) title = title.substring(0, 20) + '...';
      window.dispatchEvent(new CustomEvent('codeclub:rename-chat', {
        detail: { chatId: activeChat.chatId, newName: title, projectPath: activeChat.projectPath }
      }));
    }

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    
    await appendToJsonl(userMessage);

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
      
      await appendToJsonl({ role: 'assistant', content: assistantContent });
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

  if (workspaceMode === 'blank') {
    return (
      <div style={{ width: 'min(600px, calc(100% - 64px))', display: 'grid', placeItems: 'center', color: 'rgba(216, 216, 216, 0.42)', fontSize: '13px' }}>
        Seleccioná un chat, nota o tabla
      </div>
    );
  }

  if (workspaceMode === 'note') {
    return (
      <div className="note-panel" style={{ width: 'min(760px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '14px' }}>
        <input value={activeNote?.name || 'Nota'} readOnly style={{ border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '28px', fontWeight: 600 }} />
        <textarea value={noteContent} onChange={(e) => queueSaveNote(e.target.value)} placeholder="Escribí una nota..." style={{ resize: 'none', border: 0, outline: 'none', background: 'transparent', color: '#d8d8d8', fontSize: '14px', lineHeight: 1.7, fontFamily: 'inherit', overflow: 'auto', scrollbarWidth: 'none' }} />
      </div>
    );
  }

  if (workspaceMode === 'table') {
    return (
      <div className="table-panel" style={{ width: 'min(860px, calc(100% - 64px))', height: 'min(720px, calc(100vh - 96px))', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '14px' }}>
        <input value={activeTable?.name || 'Tabla'} readOnly style={{ border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '28px', fontWeight: 600 }} />
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
    <div className="chat-interface-container" style={{ width: 'min(600px, calc(100% - 64px))', display: 'grid', gap: '10px' }}>
      
      {/* Zona de mensajes */}
      <div className="messages-area" style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1rem' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', background: m.role === 'user' ? 'var(--color-surface-7, #2c2c2c)' : 'transparent', padding: '8px 12px', borderRadius: '8px', color: '#eee', maxWidth: '80%' }}>
            {m.content}
          </div>
        ))}
      </div>

      <div className="chat-composer" style={{ position: 'relative', display: 'grid', gap: '10px' }}>
        <div className="composer-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <span className="braille-spinner" aria-hidden="true" style={{ position: 'relative', color: '#c7cbff' }} />
          <p style={{ margin: 0, color: 'rgba(216, 216, 216, 0.82)', fontSize: '16px' }}>
            {isStreaming ? "Generando..." : "Listo cuando tú lo estés."}
          </p>
        </div>
        
        <div className="selection-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'rgba(216, 216, 216, 0.42)', fontSize: '12px' }}>
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
            placeholder="Preguntá, pedí código o describí una tarea"
            aria-label="Mensaje"
            style={{ appearance: 'none', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: '12px', padding: '0 7px' }}
          />
          <button type="submit" disabled={isStreaming} className="send-button" aria-label="Enviar" style={{ width: '28px', height: '28px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '7px', background: 'var(--color-surface-8, #2c2c2c)', color: '#ffffff', cursor: isStreaming ? 'not-allowed' : 'pointer' }}>
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        </form>

        <div className={`command-menu ${menuOpen ? 'is-open' : ''}`} style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 8px)', display: menuOpen ? 'grid' : 'none', gap: '8px', padding: '9px', border: '1px solid var(--color-surface-9, #2f2f2f)', borderRadius: '8px', background: '#121212', boxShadow: '0 20px 58px rgba(0, 0, 0, 0.34)', zIndex: 10 }}>

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
            {filteredCatalog.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleItemClick(item)}
                style={{ minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: 0, borderRadius: '7px', background: 'transparent', color: 'rgba(238, 238, 238, 0.78)', fontSize: '12px', padding: '0 9px', textAlign: 'left', cursor: 'pointer' }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--color-surface-7, #2c2c2c)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(238, 238, 238, 0.78)'; }}
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
