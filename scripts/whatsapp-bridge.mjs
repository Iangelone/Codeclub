import readline from 'node:readline';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const chats = new Map();
const messageStore = new Map();
const authDir = process.env.CODECLUB_WHATSAPP_DIR;
let socket;
let stopping = false;
let connectionTimer;
let resetRequested = false;
let refreshRequested = false;
let logoutRequested = false;
let persistTimer;
const chatCachePath = join(authDir, 'chats.json');
let webVersion;

const chatPayload = (chat) => ({
  id: chat.id,
  name: chat.notify || chat.verifiedName || chat.subject || chat.name || chat.pushName || chat.id.split('@')[0],
  unreadCount: chat.unreadCount || 0,
  timestamp: Number(chat.conversationTimestamp || chat.lastMessageRecvTimestamp || 0),
  pinned: Number(chat.pinned || 0),
});

const emitChats = () => emit({ type: 'chats', chats: [...chats.values()].slice(0, 100).map(chatPayload) });

const persistChats = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const payload = [...chats.values()].slice(0, 500).map(chatPayload);
    void writeFile(chatCachePath, JSON.stringify(payload), 'utf8').catch(() => undefined);
  }, 250);
};

const loadCachedChats = async () => {
  try {
    const payload = JSON.parse(await readFile(chatCachePath, 'utf8'));
    if (Array.isArray(payload)) {
      for (const chat of payload) {
        if (chat?.id) chats.set(chat.id, chat);
      }
    }
  } catch {
    // No hay caché todavía; la lista se poblará con la sincronización de WhatsApp.
  }
};

const messageText = (message) => message?.conversation
  || message?.extendedTextMessage?.text
  || message?.imageMessage?.caption
  || message?.videoMessage?.caption
  || '';

const rememberMessageChat = (message) => {
  const id = message?.key?.remoteJid;
  if (!id || id === 'status@broadcast') return;
  const current = chats.get(id) || { id };
  chats.set(id, {
    ...current,
    id,
    name: current.name || message.pushName || id.split('@')[0],
    unreadCount: current.unreadCount || 0,
    conversationTimestamp: Number(message.messageTimestamp || current.conversationTimestamp || 0),
  });
  persistChats();
};

const rememberMessage = (message) => {
  rememberMessageChat(message);
  const id = message?.key?.remoteJid;
  const body = messageText(message?.message);
  if (!id || !body) return null;
  const payload = { id: message.key.id, body, fromMe: Boolean(message.key.fromMe), timestamp: Number(message.messageTimestamp || 0) };
  const current = messageStore.get(id) || [];
  if (!current.some((item) => item.id === payload.id)) messageStore.set(id, [...current, payload].slice(-300));
  return { chat: chatPayload(chats.get(id)), message: payload };
};

const rememberContact = (contact) => {
  const id = contact?.id;
  if (!id || id === 'status@broadcast' || id.endsWith('@newsletter')) return;
  const current = chats.get(id) || { id };
  chats.set(id, { ...current, ...contact });
};

const connect = async () => {
  await loadCachedChats();
  if (!webVersion) {
    const latest = await fetchLatestWaWebVersion();
    webVersion = latest.version;
    if (!latest.isLatest) emit({ type: 'warning', message: 'No se pudo consultar la versión actual de WhatsApp; usando la versión incluida en Baileys.' });
  }
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  socket = makeWASocket({
    auth: state,
    version: webVersion,
    browser: Browsers.appropriate('Chrome'),
    logger: pino({ level: 'silent' }),
    qrTimeout: 60000,
    markOnlineOnConnect: false,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
  });
  const currentSocket = socket;
  connectionTimer = setTimeout(async () => {
    if (stopping || socket !== currentSocket) return;
    resetRequested = true;
    currentSocket.end(undefined);
    await rm(authDir, { recursive: true, force: true });
    chats.clear();
    emit({ type: 'session_reset', reason: 'La sesión no respondió. Generando un nuevo QR...' });
    if (!stopping) await connect();
  }, 15000);

  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('messaging-history.set', ({ chats: historyChats = [], contacts = [], messages = [] }) => {
    for (const chat of historyChats) chats.set(chat.id, chat);
    for (const contact of contacts) {
      const current = chats.get(contact.id) || { id: contact.id };
      chats.set(contact.id, { ...current, ...contact });
    }
    for (const message of messages) rememberMessage(message);
    persistChats();
    emitChats();
  });
  socket.ev.on('chats.upsert', (chatList) => {
    for (const chat of chatList) {
      const current = chats.get(chat.id) || { id: chat.id };
      chats.set(chat.id, { ...current, ...chat });
    }
    persistChats();
    emitChats();
  });
  socket.ev.on('chats.update', (chatUpdates) => {
    for (const update of chatUpdates) {
      const current = chats.get(update.id) || { id: update.id };
      chats.set(update.id, { ...current, ...update });
    }
    persistChats();
    emitChats();
  });
  socket.ev.on('contacts.upsert', (contacts) => {
    for (const contact of contacts) rememberContact(contact);
    persistChats();
    emitChats();
  });
  socket.ev.on('contacts.update', (contacts) => {
    for (const contact of contacts) rememberContact(contact);
    persistChats();
    emitChats();
  });
  socket.ev.on('messages.upsert', ({ messages = [] }) => {
    for (const message of messages) {
      const event = rememberMessage(message);
      const id = message.key.remoteJid;
      if (!id || id === 'status@broadcast') continue;
      if (event) emit({ type: 'message', ...event });
    }
    persistChats();
    emitChats();
  });
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) emit({ type: 'qr', dataUrl: await QRCode.toDataURL(qr, { margin: 1, width: 280 }) });
    if (connection === 'open') {
      clearTimeout(connectionTimer);
      emit({
        type: 'ready',
        name: socket.user?.name || socket.user?.verifiedName || '',
        phone: socket.user?.id?.split(':')[0] || '',
      });
      emitChats();
    }
    if (connection === 'close' && !stopping) {
      clearTimeout(connectionTimer);
      if (resetRequested) {
        resetRequested = false;
        return;
      }
      if (logoutRequested) return;
      if (refreshRequested) {
        refreshRequested = false;
        await delay(500);
        if (!stopping) await connect();
        return;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const detail = lastDisconnect?.error?.message || 'sin detalle';
      if (statusCode === 405) {
        await rm(authDir, { recursive: true, force: true });
        chats.clear();
        messageStore.clear();
        emit({ type: 'session_reset', reason: 'WhatsApp rechazó la sesión (405). Se limpió la sesión y se generará un nuevo QR.' });
        await delay(1500);
        if (!stopping) await connect();
        return;
      }
      if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.connectionClosed) {
        await rm(authDir, { recursive: true, force: true });
        chats.clear();
        emit({ type: 'session_reset', reason: `Conexión reiniciada en WhatsApp (${statusCode})` });
        await delay(500);
        if (!stopping) await connect();
        return;
      }
      emit({ type: 'disconnected', reason: `WhatsApp desconectado (${statusCode || 'sin código'}): ${detail}` });
      await delay(2000);
      if (!stopping) await connect();
    }
  });
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  try {
    const command = JSON.parse(line);
    if (command.type === 'list_chats') emitChats();
    if (command.type === 'get_messages' && command.chatId) emit({ type: 'chat_messages', chatId: command.chatId, messages: messageStore.get(command.chatId) || [] });
    if (command.type === 'refresh') {
      refreshRequested = true;
      socket?.end(undefined);
    }
    if (command.type === 'logout') {
      logoutRequested = true;
      stopping = true;
      await socket?.logout();
      await rm(authDir, { recursive: true, force: true });
      emit({ type: 'logged_out' });
      setTimeout(() => process.exit(0), 100);
    }
    if (command.type === 'send' && command.chatId && command.body) {
      await socket?.sendMessage(command.chatId, { text: command.body });
    }
  } catch (error) {
    emit({ type: 'error', message: String(error) });
  }
});

process.on('SIGTERM', () => { stopping = true; socket?.end(undefined); process.exit(0); });
process.on('SIGINT', () => { stopping = true; socket?.end(undefined); process.exit(0); });

connect().catch((error) => emit({ type: 'error', message: String(error) }));
