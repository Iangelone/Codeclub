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
  const searchInputRef = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    const handleOpenChat = async (e: any) => {
      const chat = e.detail;
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
    } catch (e) {
      console.error("FS Append Error:", e);
    }
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
