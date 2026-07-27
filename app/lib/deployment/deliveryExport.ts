import type { DeliveryPackage } from '~/lib/deployment/deliveryPackageTypes';

/**
 * Delivery Export Model — Sprint 93, Part 11.
 *
 * NO PDF IS GENERATED IN THIS SPRINT, by instruction. What exists here is the seam that lets a
 * later sprint add PDF/HTML/Markdown/DOCX **without changing the package model**:
 *
 *   DeliveryPackage  →  DeliveryExporter  →  DeliveryExportResult
 *
 * An exporter is a pure function of an already-assembled package. It never re-collects anything,
 * never reads BuildersDB, and never adds a field to `DeliveryPackage` — if a future format needs
 * information the package does not carry, that information belongs in the MODEL (and therefore in
 * every format), not in one renderer. Adding a format is one registry entry plus one pure
 * function; nothing else in the domain changes.
 *
 * Only `json` is implemented, and deliberately so: it is the exact persisted shape, so it needs no
 * renderer, no dependency and no layout decisions. Every other format is declared `available:
 * false` with a reason, which is what the dashboard's disabled Export control renders — the UI
 * reads this registry rather than hard-coding "coming soon" itself.
 */

export type DeliveryExportFormat = 'json' | 'markdown' | 'html' | 'pdf' | 'docx';

export interface DeliveryExportDescriptor {
  format: DeliveryExportFormat;
  label: string;
  mimeType: string;
  fileExtension: string;

  /** `false` means no exporter is registered yet — the UI disables it and shows `unavailableReason`. */
  available: boolean;
  unavailableReason?: string;
}

export interface DeliveryExportResult {
  format: DeliveryExportFormat;
  mimeType: string;
  filename: string;
  content: string;
}

/** A pure renderer. Takes an assembled package, returns bytes-as-text. Never async, never I/O. */
export type DeliveryExporter = (pkg: DeliveryPackage, filenameBase: string) => DeliveryExportResult;

export const DELIVERY_EXPORT_FORMATS: DeliveryExportDescriptor[] = [
  { format: 'json', label: 'JSON', mimeType: 'application/json', fileExtension: 'json', available: true },
  {
    format: 'markdown',
    label: 'Markdown',
    mimeType: 'text/markdown',
    fileExtension: 'md',
    available: false,
    unavailableReason: 'Markdown export is not implemented yet.',
  },
  {
    format: 'html',
    label: 'HTML',
    mimeType: 'text/html',
    fileExtension: 'html',
    available: false,
    unavailableReason: 'HTML export is not implemented yet.',
  },
  {
    format: 'pdf',
    label: 'PDF',
    mimeType: 'application/pdf',
    fileExtension: 'pdf',
    available: false,
    unavailableReason: 'PDF generation is out of scope for this sprint.',
  },
  {
    format: 'docx',
    label: 'Word',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileExtension: 'docx',
    available: false,
    unavailableReason: 'DOCX export is not implemented yet.',
  },
];

/** JSON is the persisted shape verbatim — no transformation, so an export can never disagree with what BuildersDB holds. */
const exportJson: DeliveryExporter = (pkg, filenameBase) => ({
  format: 'json',
  mimeType: 'application/json',
  filename: `${filenameBase}.json`,
  content: JSON.stringify(pkg, null, 2),
});

const EXPORTERS: Partial<Record<DeliveryExportFormat, DeliveryExporter>> = { json: exportJson };

export function listDeliveryExportFormats(): DeliveryExportDescriptor[] {
  return DELIVERY_EXPORT_FORMATS;
}

export function isDeliveryExportAvailable(format: DeliveryExportFormat): boolean {
  return EXPORTERS[format] !== undefined;
}

export type DeliveryExportOutcome =
  | { ok: true; result: DeliveryExportResult }
  | { ok: false; format: DeliveryExportFormat; message: string };

/** Refuses an unregistered format rather than emitting an empty or half-rendered file. */
export function exportDeliveryPackage(
  pkg: DeliveryPackage,
  format: DeliveryExportFormat,
  filenameBase = 'delivery-package',
): DeliveryExportOutcome {
  const exporter = EXPORTERS[format];

  if (!exporter) {
    const descriptor = DELIVERY_EXPORT_FORMATS.find((entry) => entry.format === format);

    return {
      ok: false,
      format,
      message: descriptor?.unavailableReason ?? `No exporter is registered for "${format}".`,
    };
  }

  return { ok: true, result: exporter(pkg, filenameBase) };
}
