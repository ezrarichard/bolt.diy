import type { RepairContext } from './codeReviewTypes';

/**
 * Repair Prompt — Sprint 39 (Repair Engineer role).
 *
 * Builds the strict-JSON repair request sent through the existing `/api/generate-text`
 * contract (same `GenerateFn` every code-generation prompt already uses — see
 * app/lib/code-generation/prompts.ts). Deliberately asks for a PATCH (files to
 * create/update/delete), never a full regeneration — "repair only affected files" is the
 * sprint's own explicit requirement.
 */

export const REPAIR_SYSTEM_PROMPT = `You are the Repair Engineer on Builders, an AI engineering platform. You are given a generated React + TypeScript + Vite project that failed review or failed to build/run, along with the exact error(s). Your job is to propose the SMALLEST patch that fixes the problem.

Rules:
- Respond with ONLY a single JSON object matching this exact shape — no markdown code fences, no commentary before or after it:
  {
    "filesToCreate": [ { "path": string, "content": string } ],
    "filesToUpdate": [ { "path": string, "content": string } ],
    "filesToDelete": [ string ],
    "explanation": string,
    "confidence": number,
    "remainingRisks": [ string ]
  }
- Only touch files that are actually necessary to fix the reported error(s). Do not regenerate the whole app.
- Never delete "package.json". Never delete every file under "src/".
- Every path is relative to the project root (e.g. "src/pages/AboutPage.tsx"), matching the file tree given below exactly.
- If the error is a missing/incorrect import: check the full generated file tree below first. If the symbol is already defined and exported somewhere else in the project, fix the import (correct path, correct symbol name, or re-export it from the barrel file it's missing from) rather than inventing a new, possibly-inconsistent definition.
- Never weaken TypeScript safety just to make an error go away — do not add placeholder types like "type X = any" or "as any" casts, and do not delete a type that's genuinely needed elsewhere. A real, correctly-typed fix is required even if it takes touching one more file.
- "filesToUpdate" entries must contain the file's COMPLETE new content, not a diff/snippet.
- "confidence" is a number from 0 to 1 — your own estimate that this patch actually fixes the error.
- "remainingRisks" is a short list of anything you're not fully sure about after this patch (can be empty).`;

function formatFileList(paths: string[]): string {
  return paths.length > 0 ? paths.map((path) => `- ${path}`).join('\n') : 'None.';
}

function formatIssues(context: RepairContext): string {
  if (context.issues.length > 0) {
    return context.issues.map((issue) => `- [${issue.severity}] ${issue.filePath ?? ''} ${issue.message}`).join('\n');
  }

  if (context.buildError) {
    const { message, filePath, line, column, source, stack } = context.buildError;
    const location = [filePath, line, column].filter(Boolean).join(':');

    return [
      `Source: ${source}`,
      `Message: ${message}`,
      location ? `Location: ${location}` : undefined,
      stack ? `Stack:\n${stack}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return 'No specific issue text was provided.';
}

export function buildRepairPrompt(context: RepairContext): { system: string; prompt: string } {
  const affectedFilesBlock = context.affectedFiles.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n');

  const prompt = `Project: ${context.projectName}
Template: ${context.templateId}
Repair attempt ${context.attemptNumber} of ${context.maxAttempts} (stage: ${context.stage}, validator: ${context.validatorId})

Product Package Summary:
${context.productPackageSummary}

Full generated file tree:
${formatFileList(context.fileTree)}

Reported problem(s):
${formatIssues(context)}

Affected file(s) (full current content):
${affectedFilesBlock || 'None provided — infer from the file tree and error above.'}

Return the smallest patch that fixes the reported problem(s), following the JSON shape and rules exactly.`;

  return { system: REPAIR_SYSTEM_PROMPT, prompt };
}
