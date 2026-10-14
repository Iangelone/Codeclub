import { getDesktopBridge, fileExists as exists, makeDirectory as mkdir, readDesktopBytes as readFile, readDesktopText as readTextFile, writeDesktopText as writeTextFile } from './runtime';
/** Attachment encoding and legacy history adapters used by the chat controller. */

import { getProjectFilePath } from './persistence';

export type ChatAttachment = { path: string; name: string; mediaType: string; size?: number; previewUrl?: string; previewText?: string };
export const getAttachmentName = (path: string) => path.split(/[\\/]/).pop() || path;
export const readDesktopFile = async (path: string) => {
  const reader = getDesktopBridge()?.readFile;
  return reader ? new Uint8Array(await reader(path)) : readFile(path);
};
export const readDesktopTextFile = async (path: string) => {
  const reader = getDesktopBridge()?.readTextFile;
  return reader ? String(await reader(path)) : readTextFile(path);
};
export const readProjectChatHistory = async (projectPath: string, chatId: string) => {
  const desktopReader = getDesktopBridge()?.readProjectChat;
  if (desktopReader) {
    const content = String(await desktopReader(projectPath, chatId) || '');
    return content.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
  const path = await getProjectFilePath(projectPath, 'chats', `${chatId}.jsonl`);
  if (!(await exists(path))) return [];
  const content = await readTextFile(path);
  return content.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
};
export const writeProjectChatHistory = async (projectPath: string, chatId: string, messages: any[]) => {
  const content = messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : '');
  const desktopWriter = getDesktopBridge()?.writeProjectChat;
  if (desktopWriter) {
    await desktopWriter(projectPath, chatId, content);
    return;
  }
  const dir = await getProjectFilePath(projectPath, 'chats');
  await mkdir(dir, { recursive: true });
  await writeTextFile(await getProjectFilePath(projectPath, 'chats', `${chatId}.jsonl`), content);
};
export const getAttachmentMediaType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    txt: 'text/plain', md: 'text/markdown', mdx: 'text/markdown', json: 'application/json', csv: 'text/csv',
    js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', css: 'text/css',
    html: 'text/html', htm: 'text/html', rs: 'text/plain', py: 'text/x-python', sql: 'text/plain',
    svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[extension || ''] || 'application/octet-stream';
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

export const readAttachmentParts = async (attachments: ChatAttachment[]) => {
  const parts: any[] = [];
  for (const attachment of attachments) {
    try {
      if (attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json') {
        const text = await readTextFile(attachment.path);
        parts.push({ type: 'text', text: `Archivo ${attachment.name}:\n${text.slice(0, 120_000)}` });
      } else {
        const bytes = await readDesktopFile(attachment.path);
        const data = bytesToBase64(bytes);
        const dataUrl = `data:${attachment.mediaType};base64,${data}`;
        parts.push(attachment.mediaType.startsWith('image/')
          ? { type: 'image', image: dataUrl, mediaType: attachment.mediaType }
          : { type: 'file', data: dataUrl, mediaType: attachment.mediaType, filename: attachment.name });
      }
    } catch (error) {
      console.error(`No se pudo leer el archivo adjunto ${attachment.name}:`, error);
      parts.push({ type: 'text', text: `No se pudo leer el archivo adjunto: ${attachment.name}` });
    }
  }
  return parts;
};
