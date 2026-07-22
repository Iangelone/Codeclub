type Listener<T> = (val: T) => void;

function createStore<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => value,
    set: (newValue: T) => {
      value = newValue;
      listeners.forEach((l) => l(value));
    },
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const activeProjectStore = createStore<{ projectPath?: string; name?: string }>({});
export const activeChatStore = createStore<{ id?: string; kind?: string }>({});
export type GlobalChat = { id: string; name: string; projectPath: string; projectName: string };
export const chatsStore = createStore<GlobalChat[]>([]);

export type WhatsAppChatContext = { id: string; name: string; unreadCount?: number; timestamp?: number; pinned?: number };
export type WhatsAppMessageContext = { id: string; body: string; fromMe: boolean; timestamp?: number };
export const whatsappContextStore = createStore<{
  connected: boolean;
  account?: string;
  chats: WhatsAppChatContext[];
  messages: Record<string, WhatsAppMessageContext[]>;
}>({ connected: false, chats: [], messages: {} });
