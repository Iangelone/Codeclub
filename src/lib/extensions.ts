export type CodeclubExtension = {
  id: string;
  name: string;
  description: string;
  slash: string;
  instruction: string;
  protected?: boolean;
};

export const codeclubExtensions: CodeclubExtension[] = [
  {
    id: 'documents',
    name: 'Documents',
    description: 'Create and edit document artifacts',
    slash: '/documents',
    instruction: 'Trabajá con documentos usando archivos del proyecto, preservá estructura y formato, y verificá el contenido antes de informar éxito.',
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Read, create, and verify PDF files',
    slash: '/pdf',
    instruction: 'Trabajá con PDFs: inspeccioná el archivo real, creá o modificá el resultado solicitado y verificá que exista y sea legible.',
  },
  {
    id: 'spreadsheets',
    name: 'Spreadsheets',
    description: 'Create and edit spreadsheet files',
    slash: '/spreadsheets',
    instruction: 'Trabajá con planillas: mantené datos tabulares, fórmulas y encabezados claros; verificá rangos y resultados antes de responder.',
  },
  {
    id: 'presentations',
    name: 'Presentations',
    description: 'Create and edit presentation artifacts',
    slash: '/presentations',
    instruction: 'Trabajá con presentaciones: organizá el contenido por diapositivas, cuidá legibilidad y verificá que el archivo final exista.',
  },
  {
    id: 'template-creator',
    name: 'Template Creator',
    description: 'Create or update reusable templates from reference content',
    slash: '/template-creator',
    instruction: 'Creá plantillas reutilizables desde el contenido de referencia, separando estructura, variables y reglas de uso.',
  },
];
