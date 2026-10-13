import type en from './en.js';

export default {
  tray: { open: 'Abrir', widget: 'Widget', quit: 'Salir' },
  overlay: { title: 'Codeclub está usando tu computadora', cancel: 'Esc para cancelar' },
  computerMenu: { select: 'Seleccionar elemento', coordinate: 'Usar coordenada', screenshot: 'Capturar pantalla' },
  tasks: { completed: 'Tarea completada', attention: 'La tarea requiere atención' },
} satisfies typeof en;
