import type { Project } from '~/lib/stores/projects';
import type { MissingSection, ProductPackageSection } from './assemblyTypes';

/**
 * Rule-based Documentation/product-summary.md generator — Sprint 37, requirement #4.
 *
 * Deliberately no AI call: every existing engine's own draft content is already
 * AI-generated, so summarizing the ASSEMBLY itself (which sections exist, which are
 * missing, which versions were used) is plain, deterministic bookkeeping over data this
 * module already has in hand — an LLM call would add latency/cost for zero benefit here.
 */
export function buildProductSummaryMarkdown(
  project: Project,
  sections: ProductPackageSection[],
  missingSections: MissingSection[],
  assembledAt: string,
): string {
  const roleFiles = sections.filter((section) => section.id !== 'documentation').flatMap((section) => section.files);
  const approvedFiles = roleFiles.filter((file) => file.sourceStatus === 'approved');
  const draftFiles = roleFiles.filter((file) => file.sourceStatus === 'draft');

  const lines: string[] = [
    '# Product Summary',
    '',
    `**Project:** ${project.name}`,
    `**Original Requirement:** ${project.description ?? 'Not provided.'}`,
    `**Assembled:** ${assembledAt}`,
    '',
    '## Roles Included',
    roleFiles.length > 0
      ? roleFiles.map((file) => `- ${file.sourceRole} (${file.sourceStatus}, v${file.sourceVersion ?? 1})`).join('\n')
      : 'None yet — no role has produced approved or draft output.',
    '',
    '## Available Sections',
    roleFiles.length > 0 ? roleFiles.map((file) => `- ${file.path}`).join('\n') : 'None yet.',
    '',
    '## Missing Sections',
    missingSections.length > 0
      ? missingSections.map((entry) => `- ${entry.label}: ${entry.reason}`).join('\n')
      : 'None — every section is available.',
    '',
    '## Latest Approved Versions Used',
    approvedFiles.length > 0
      ? approvedFiles.map((file) => `- ${file.sourceRole} v${file.sourceVersion ?? 1}`).join('\n')
      : 'None yet.',
    '',
    '## Draft Versions Used',
    draftFiles.length > 0
      ? draftFiles.map((file) => `- ${file.sourceRole} v${file.sourceVersion ?? 1} (not yet approved)`).join('\n')
      : 'None — every included section came from an approved output.',
  ];

  /*
   * "Project Management" has no dedicated AI role/artifact in this codebase yet (see
   * assemblyTypes.ts's header comment) — noted explicitly here rather than silently
   * omitted, so this summary stays an honest description of what was actually
   * assembled.
   */
  lines.push(
    '',
    '## Note',
    'This project has no dedicated "Project Manager" AI role/output yet, so no Project Management section is included above. "API" is derived from the Backend Engineer\'s own output rather than a separate role.',
  );

  return lines.join('\n');
}
