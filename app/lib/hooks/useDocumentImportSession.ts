import { useCallback, useState } from 'react';
import { extractDocumentText, getDocumentExtension } from '~/lib/projects/documentTextExtraction';
import { recordDocumentImport } from '~/lib/projects/requirementsSessionOrchestrator';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import type { GenerateTextFn } from '~/lib/projects/discoveryAiEngine';
import type { Project } from '~/lib/stores/projects';

/**
 * Sprint 58 — Business Knowledge Completion (Document Discovery).
 *
 * Document Import's write-capable session hook, sibling to `useInterviewSession.ts` but simpler:
 * one file in, one `recordDocumentImport` call, no multi-turn conversation state. Reuses the same
 * `discovery-agent` Generation Profile role key `useInterviewSession` already resolves (both are
 * the same Discovery AI Engine, just a different `sourceType` — see
 * `discoveryAiEngine/contextBuilder.ts`), so no new Generation Profile registration is needed.
 */

const DISCOVERY_AGENT_ROLE_KEY = 'discovery-agent';

export type DocumentImportState =
  | { status: 'idle' }
  | { status: 'extracting'; fileName: string }
  | { status: 'analyzing'; fileName: string }
  | { status: 'success'; fileName: string; acceptedFactCount: number }
  | { status: 'error'; message: string };

export interface UseDocumentImportSessionResult {
  state: DocumentImportState;
  importDocument: (file: File) => Promise<void>;
  reset: () => void;
}

export function useDocumentImportSession(project: Project | null): UseDocumentImportSessionResult {
  const [state, setState] = useState<DocumentImportState>({ status: 'idle' });
  const { generate } = useGenerateText();

  const generateTextForDiscovery: GenerateTextFn = useCallback(
    (system, prompt, options) => {
      const roleOptions = project ? getRoleGenerateOptions(project, DISCOVERY_AGENT_ROLE_KEY) : {};

      return generate(system, prompt, {
        ...options,
        ...roleOptions,
        projectId: project?.id,
        roleKey: DISCOVERY_AGENT_ROLE_KEY,
        requestType: 'document_fact_extraction',
      });
    },
    [generate, project],
  );

  const importDocument = useCallback(
    async (file: File) => {
      if (!project) {
        return;
      }

      if (!getDocumentExtension(file.name)) {
        setState({ status: 'error', message: 'Unsupported file type. Use PDF, DOCX, TXT, or Markdown.' });
        return;
      }

      setState({ status: 'extracting', fileName: file.name });

      let text: string;

      try {
        text = await extractDocumentText(file);
      } catch (error) {
        console.error('[useDocumentImportSession] extraction failed:', error);
        setState({ status: 'error', message: "Couldn't read that file — is it a valid document?" });

        return;
      }

      if (!text.trim()) {
        setState({ status: 'error', message: 'No readable text found in that document.' });
        return;
      }

      setState({ status: 'analyzing', fileName: file.name });

      const result = await recordDocumentImport(project.id, file.name, text, {
        generateText: generateTextForDiscovery,
      });

      if (!result) {
        setState({ status: 'error', message: "Couldn't process that document — mind trying again?" });
        return;
      }

      if (result.extractionError) {
        setState({ status: 'error', message: "Couldn't process that document — mind trying again?" });
        return;
      }

      setState({ status: 'success', fileName: file.name, acceptedFactCount: result.acceptedFactCount });
    },
    [project, generateTextForDiscovery],
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, importDocument, reset };
}
