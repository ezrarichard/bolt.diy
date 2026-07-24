/**
 * Document Text Extraction — Sprint 58 (Business Knowledge Completion).
 *
 * Client-side only: this app deploys to Cloudflare Pages/Workers (see wrangler.toml), which has
 * no `fs`/native Buffer support, so extraction cannot use Node-only libraries (`pdf-parse`, etc.)
 * — everything here runs in the browser, using the `File`/`ArrayBuffer` Web APIs and
 * browser-compatible builds of `pdfjs-dist` (PDF) and `mammoth` (DOCX). Plain text and Markdown
 * need no library at all.
 *
 * This module only extracts raw text — it knows nothing about Discovery, the Business
 * Understanding Model, or the Discovery AI Engine. `recordDocumentImport`
 * (requirementsSessionOrchestrator.ts) is the only caller, and treats whatever this returns as
 * one opaque block of `rawText` for fact extraction, exactly like an interview answer.
 */

export type SupportedDocumentExtension = 'pdf' | 'docx' | 'txt' | 'md';

const SUPPORTED_EXTENSIONS: SupportedDocumentExtension[] = ['pdf', 'docx', 'txt', 'md'];

export function getDocumentExtension(fileName: string): SupportedDocumentExtension | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  const extension = match?.[1]?.toLowerCase();

  return SUPPORTED_EXTENSIONS.includes(extension as SupportedDocumentExtension)
    ? (extension as SupportedDocumentExtension)
    : null;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = await file.arrayBuffer();
  const document = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });

  return result.value;
}

/** Extracts plain text from a PDF, DOCX, TXT, or Markdown file. Throws for any other file type — callers should check `getDocumentExtension` before calling this if they want to reject early with a nicer message. */
export async function extractDocumentText(file: File): Promise<string> {
  const extension = getDocumentExtension(file.name);

  switch (extension) {
    case 'pdf':
      return (await extractPdfText(file)).trim();
    case 'docx':
      return (await extractDocxText(file)).trim();
    case 'txt':
    case 'md':
      return (await file.text()).trim();
    default:
      throw new Error(`Unsupported document type: ${file.name}`);
  }
}
