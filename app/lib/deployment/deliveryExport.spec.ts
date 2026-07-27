import { describe, expect, it } from 'vitest';
import type { DeliveryPackage } from './deliveryPackageTypes';
import {
  DELIVERY_EXPORT_FORMATS,
  exportDeliveryPackage,
  isDeliveryExportAvailable,
  listDeliveryExportFormats,
} from './deliveryExport';

const pkg = {
  projectInformation: { projectId: 'proj-1', projectName: 'Riverside Dental Clinic' },
  completeness: { score: 92, level: 'almost_complete', dimensions: [] },
  packageMetadata: {
    packageVersion: '1.0.0',
    generatorVersion: '1.0.0',
    deliveredAt: '2026-08-08T12:00:00.000Z',
    sources: [],
  },
} as unknown as DeliveryPackage;

describe('delivery export model', () => {
  it('declares every planned format, with only JSON available in this sprint', () => {
    const formats = listDeliveryExportFormats();

    expect(formats.map((entry) => entry.format)).toEqual(['json', 'markdown', 'html', 'pdf', 'docx']);
    expect(formats.filter((entry) => entry.available).map((entry) => entry.format)).toEqual(['json']);
  });

  it('gives every unavailable format a stated reason for the disabled UI control', () => {
    for (const descriptor of DELIVERY_EXPORT_FORMATS.filter((entry) => !entry.available)) {
      expect(descriptor.unavailableReason).toBeTruthy();
    }
  });

  it('does not implement PDF generation in this sprint', () => {
    expect(isDeliveryExportAvailable('pdf')).toBe(false);
    expect(exportDeliveryPackage(pkg, 'pdf')).toMatchObject({ ok: false, format: 'pdf' });
  });

  it('refuses an unregistered format instead of emitting a half-rendered file', () => {
    const result = exportDeliveryPackage(pkg, 'docx');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/not implemented/i);
  });

  it('exports JSON as the persisted shape verbatim', () => {
    const result = exportDeliveryPackage(pkg, 'json', 'riverside-delivery');

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.result.filename).toBe('riverside-delivery.json');
      expect(result.result.mimeType).toBe('application/json');
      expect(JSON.parse(result.result.content)).toEqual(pkg);
    }
  });

  it('takes an already-assembled package — an exporter never re-collects anything', () => {
    const before = JSON.stringify(pkg);
    exportDeliveryPackage(pkg, 'json');

    expect(JSON.stringify(pkg)).toBe(before);
  });
});
