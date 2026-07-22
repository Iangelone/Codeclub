import { rm } from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';

const sessionDir = process.env.CODECLUB_WHATSAPP_DEBUG_DIR || path.join(process.cwd(), '.whatsapp-debug-session');
let socket;
let stopping = false;
const log = (message, details = '') => console.log(`[WhatsApp debug] ${message}`, details);

const start = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  socket = makeWASocket({ auth: state, browser: Browsers.appropriate('Chrome'), logger: pino({ level: 'silent' }), qrTimeout: 60000, syncFullHistory: true, shouldSyncHistoryMessage: () => true });
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.clear();
      log('Escaneá este QR desde WhatsApp > Dispositivos vinculados');
      console.log(await QRCode.toString(qr, { type: 'utf8' }));
    }
    if (connection) log(`Estado de conexión: ${connection}`);
    if (connection === 'open') log(`Conectado como ${socket.user?.name || socket.user?.verifiedName || socket.user?.id || 'cuenta desconocida'}`);
    if (connection === 'close' && !stopping) {
      const code = lastDisconnect?.error?.output?.statusCode;
      log(`Desconectado (${code || 'sin código'})`, JSON.stringify({ message: lastDisconnect?.error?.message, data: lastDisconnect?.error?.data, stack: lastDisconnect?.error?.stack }));
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.connectionClosed) await rm(sessionDir, { recursive: true, force: true });
      setTimeout(() => { if (!stopping) void start(); }, 1500);
    }
  });
  socket.ev.on('messaging-history.set', ({ chats = [], contacts = [], messages = [], syncType, progress }) => log(`Historial: ${chats.length} chats, ${contacts.length} contactos, ${messages.length} mensajes`, `tipo=${syncType ?? 'n/a'} progreso=${progress ?? 'n/a'}`));
  socket.ev.on('chats.upsert', (chats) => log(`Chats nuevos: ${chats.length}`));
  socket.ev.on('chats.update', (chats) => log(`Chats actualizados: ${chats.length}`));
  socket.ev.on('messages.upsert', ({ messages = [], type }) => log(`Mensajes recibidos: ${messages.length}`, `tipo=${type}`));
  socket.ev.on('messaging-history.status', (event) => log(`Estado del historial: ${event.status}`, JSON.stringify(event)));
};

if (process.argv.includes('--reset')) await rm(sessionDir, { recursive: true, force: true });
log(`Sesión: ${sessionDir}`);
void start().catch((error) => log('Error fatal', error));
process.on('SIGINT', () => { stopping = true; socket?.end(undefined); process.exit(0); });
process.on('SIGTERM', () => { stopping = true; socket?.end(undefined); process.exit(0); });
