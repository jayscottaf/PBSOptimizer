declare module 'pdf-parse' {
  interface PDFMetadata {
    [key: string]: unknown;
  }

  interface PDFPage {
    pageNumber: number;
    getTextContent(): Promise<any>;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: PDFMetadata;
    metadata?: PDFMetadata;
    version: string;
    text: string;
  }

  interface PDFParseOptions {
    max?: number;
    version?: string;
    pagerender?: (page: PDFPage) => string | Promise<string>;
    success?: (data: PDFData) => void;
    error?: (error: unknown) => void;
  }

  export default function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer | string,
    options?: PDFParseOptions
  ): Promise<PDFData>;
}