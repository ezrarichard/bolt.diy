import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory, chatMetadata } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';
import {
  currentProjectIdStore,
  projectsStore,
  createQuickBuildLocalProject,
  persistQuickBuildProject,
  type Project,
} from '~/lib/stores/projects';
import { PROJECT_TYPE_REGISTRY } from '~/lib/project-types/projectTypeRegistry';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import {
  beginQuickBuildGeneration,
  failQuickBuildGenerationOnRequestError,
  finalizeQuickBuildGeneration,
} from '~/lib/quick-build/quickBuildOrchestrator';
import { resumeQuickBuildWorkspace } from '~/lib/quick-build/workspaceResumeOrchestrator';
import { QuickBuildGenerationStatus } from './QuickBuildGenerationStatus';
import { WorkspaceResumeStatus } from './WorkspaceResumeStatus';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat, started: chatStoreStarted } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    /*
     * Sprint 42.2 — AI usage-ledger attribution (see app/lib/ai-usage/). `chatMetadata`
     * (app/lib/persistence/useChatHistory.ts) is this chat's own authoritative
     * project link — set from the chat's persisted metadata on load, and to the
     * just-created/reused project on this chat's very first message (Sprint 39.7's
     * "every chat becomes a Project") — never `currentProjectIdStore`, which is shared
     * UI state for whichever project's dashboard happens to be open and can point at a
     * different project than the one this chat actually belongs to. `undefined` here
     * (nothing persisted yet, or a chat that predates Sprint 39.7) is passed straight
     * through as `null` server-side — never fabricated.
     */
    const activeChatMetadata = useStore(chatMetadata);

    /*
     * Sprint 43A — Quick Build generation lifecycle. Resolves the same project
     * `activeChatMetadata`/`recordAiUsage` already use (chat's own persisted project link,
     * falling back to `currentProjectIdStore` for the brand-new-chat window before
     * `chatMetadata.projectId` is set — see useChatHistory.ts's "reuse the active project if
     * one exists" comment). `useGenerateText().generate` is reused as-is for the repair loop's
     * own AI calls (see quickBuildOrchestrator.ts), the same `GenerateFn` shape
     * useCodeGeneration.ts already passes it as for Guided Engineering.
     */
    const allProjects = useStore(projectsStore);
    const activeProjectId = activeChatMetadata?.projectId ?? currentProjectIdStore.get();
    const quickBuildProject = allProjects.find(
      (candidate) => candidate.id === activeProjectId && candidate.projectType === 'quick_build',
    );
    const { generate: generateForRepair } = useGenerateText();
    const quickBuildTrackingStarted = useRef(false);

    /*
     * Urgent fix — holds the local project created for a not-yet-persisted Quick Build first
     * message across a failed-then-retried send. Cleared the moment persistence succeeds (see
     * ensureQuickBuildProjectPersisted below) so a later, unrelated chat never reuses a stale
     * reference.
     */
    const quickBuildPendingProjectRef = useRef<Project | null>(null);

    /*
     * Urgent regression fix — `onFinish`/`onError` (passed into `useChat({...})` below) are
     * plain closures created at render time; each captures whatever `quickBuildProject` was
     * during THAT render. For a brand-new Quick Build chat's first message, the project
     * doesn't exist yet at the moment the request starts (it's created asynchronously by
     * useChatHistory.ts's storeMessageHistory), so that request's `onFinish` instance is
     * permanently frozen with `quickBuildProject = undefined` — even though a LATER render
     * (once the project exists) computes it correctly for everything else, e.g. the
     * `useEffect` below that starts Engineering Timeline tracking, which is why the timeline
     * itself showed "Preparing…/Generating Files…" correctly while finalization silently
     * never ran. Reading directly from the stores at call time (not the React closure)
     * guarantees `onFinish`/`onError` always see the current project, regardless of when the
     * callback actually fires relative to the render that resolved it.
     */
    const resolveQuickBuildProject = () => {
      const freshProjectId = chatMetadata.get()?.projectId ?? currentProjectIdStore.get();
      return projectsStore
        .get()
        .find((candidate) => candidate.id === freshProjectId && candidate.projectType === 'quick_build');
    };

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        chatMode,
        designScheme,
        projectId: activeChatMetadata?.projectId ?? null,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');

        const projectForError = resolveQuickBuildProject();

        if (projectForError) {
          failQuickBuildGenerationOnRequestError(
            projectForError.id,
            e instanceof Error ? e.message : 'The chat request failed.',
          );
        }
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');

        /*
         * Sprint 43A — Part 3-12. Only engages for a Quick Build project (resolved fresh —
         * see resolveQuickBuildProject()'s comment); a no-op for Guided Engineering or a
         * project-less chat. Not awaited: this can take as long as install/build/repair
         * genuinely takes, and must never block the chat UI from accepting the next message —
         * its own progress is visible via the Engineering Timeline / QuickBuildGenerationStatus
         * instead.
         */
        const projectForFinalize = resolveQuickBuildProject();

        if (projectForFinalize) {
          finalizeQuickBuildGeneration({ project: projectForFinalize, message, generate: generateForRepair }).catch(
            (finalizeError) => logger.error('Quick Build generation finalization failed:', finalizeError),
          );
        }
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    /*
     * Sprint 43A — starts tracking a Quick Build generation the moment a request begins
     * (isLoading flips true), not only once it finishes — so the Engineering Timeline shows
     * "Preparing…"/"Generating Files…" for the whole duration of the LLM stream (see
     * beginQuickBuildGeneration()'s own comment). Guarded by a ref (not just `isLoading`
     * alone) so a single request only starts tracking once, even though this effect re-runs
     * on every `quickBuildProject` identity change during that same request.
     */
    useEffect(() => {
      if (isLoading && quickBuildProject && !quickBuildTrackingStarted.current) {
        quickBuildTrackingStarted.current = true;
        beginQuickBuildGeneration(quickBuildProject.id);
      }

      if (!isLoading) {
        quickBuildTrackingStarted.current = false;
      }
    }, [isLoading, quickBuildProject]);

    /*
     * Sprint 44 — reopening a chat for an already-generated Quick Build project (browser
     * refresh, sidebar click, Home Dashboard's "Continue Working" card, or navigating away
     * and back — all of these remount this component via a route change) must restart the
     * dev server so Preview isn't stuck on "No preview available" forever. Delegates
     * entirely to `resumeQuickBuildWorkspace()` (workspaceResumeOrchestrator.ts), which is
     * itself locked/idempotent and bounded-timeout end to end — this effect's own
     * `quickBuildResumeAttempted` ref only prevents firing a REDUNDANT new attempt on every
     * re-render (e.g. once this project's `workspaceState` updates and `quickBuildProject`
     * gets a new object identity from `projectsStore`), not correctness of the resume
     * itself. `initialMessages.length === 0` (a brand-new chat's first message) is excluded
     * so this never races the FIRST generation a project ever goes through.
     */
    const quickBuildResumeAttempted = useRef(false);

    useEffect(() => {
      if (quickBuildResumeAttempted.current || initialMessages.length === 0 || !quickBuildProject) {
        return;
      }

      quickBuildResumeAttempted.current = true;
      resumeQuickBuildWorkspace(quickBuildProject).catch((error) =>
        logger.error('Quick Build workspace resume failed:', error),
      );
    }, [initialMessages.length, quickBuildProject]);

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    /*
     * Code generation started from the Project Dashboard/Product Package flips
     * `chatStore.started` directly (see useCodeGeneration.ts) rather than going through
     * `runAnimation` below, since that flow never sends a chat message. Mirror it into
     * this component's local `chatStarted` state so BaseChat hides the landing hero the
     * same way it already does for a normal first chat message.
     */
    useEffect(() => {
      if (chatStoreStarted && !chatStarted) {
        setChatStarted(true);
      }
    }, [chatStoreStarted, chatStarted]);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });
        setData([]);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      try {
        /*
         * Urgent regression fix — `#intro` (the old plain intro block, replaced by
         * HomeWorkflows.tsx's video hero in Sprint 39.6/39.7 — see BaseChat.tsx's own
         * comment) no longer exists anywhere in the DOM. framer-motion's `animate()` throws
         * synchronously ("No valid elements provided") when a selector matches zero
         * elements. Sprint 43's `await runAnimation()` (added to fix the Hero/Workbench
         * overlap) turned that synchronous throw into an unhandled promise rejection with
         * nothing to catch it, which silently aborted `sendMessage()` before it ever reached
         * `reload()`/`append()` — clicking Send did nothing, with no visible error. Catching
         * it here means a failed/no-op fade never blocks submission; the Hero is still
         * hidden by the state flip below regardless of whether the animation itself ran.
         */
        await Promise.all([
          animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
          animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
        ]);
      } catch (error) {
        logger.warn('Hero fade-out animation failed — continuing without it', error);
      }

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    /*
     * Urgent fix — Quick Build's first message must create AND persist its project to
     * BuildersDB before generation is allowed to start (see the audit's "Correct Creation
     * Sequence"). A no-op when a project is already active — e.g. "Start Chat" from a Guided
     * Engineering project's dashboard already sets `currentProjectIdStore` before any message
     * is sent, and this must never touch that flow. Returns the persisted project on success,
     * or null (having already shown a retryable error) on failure — the SAME local project
     * (via `quickBuildPendingProjectRef`) is reused on retry rather than minting a new id.
     */
    const ensureQuickBuildProjectPersisted = async (promptText: string): Promise<boolean> => {
      if (currentProjectIdStore.get()) {
        return true;
      }

      const pendingProject =
        quickBuildPendingProjectRef.current ??
        createQuickBuildLocalProject({
          name: promptText.slice(0, 60) || PROJECT_TYPE_REGISTRY.quick_build.displayName,
          icon: PROJECT_TYPE_REGISTRY.quick_build.icon,
          color: PROJECT_TYPE_REGISTRY.quick_build.color,
        });

      quickBuildPendingProjectRef.current = pendingProject;

      const result = await persistQuickBuildProject(pendingProject);

      if (!result.ok) {
        setFakeLoading(false);
        setLlmErrorAlert({
          type: 'error',
          title: 'Project Could Not Be Saved',
          description:
            result.error ?? 'Project could not be saved to BuildersDB. Your prompt has been kept — try sending again.',
          provider: provider.name,
          errorType: 'unknown',
        });

        return false;
      }

      quickBuildPendingProjectRef.current = null;
      currentProjectIdStore.set(pendingProject.id);
      chatMetadata.set({ ...chatMetadata.get(), projectId: pendingProject.id });

      return true;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      /*
       * Sprint 43 — awaited (was fire-and-forget). The Hero (HomeWorkflows) only unmounts
       * once `chatStarted` flips true inside runAnimation(), after its fade-out finishes.
       * Firing the actual LLM request (reload()/append() below) before that flip lands lets
       * a fast-streaming response's first `<boltArtifact>` tag open the Workbench
       * (workbenchStore.showWorkbench, set independently by useMessageParser.ts's
       * onArtifactOpen) while the Hero is still mounted and visible — the overlap bug. This
       * `await` guarantees the Hero has already fully hidden before any request that could
       * open the Workbench is even sent.
       */
      await runAnimation();

      if (!chatStarted) {
        const canProceed = await ensureQuickBuildProjectPersisted(finalMessageContent);

        if (!canProceed) {
          return;
        }

        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);

              const reloadOptions =
                uploadedFiles.length > 0
                  ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                  : undefined;

              reload(reloadOptions);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    return (
      <>
        <BaseChat
          ref={animationScope}
          textareaRef={textareaRef}
          input={input}
          showChat={showChat}
          chatStarted={chatStarted}
          isStreaming={isLoading || fakeLoading}
          onStreamingChange={(streaming) => {
            streamingState.set(streaming);
          }}
          enhancingPrompt={enhancingPrompt}
          promptEnhanced={promptEnhanced}
          sendMessage={sendMessage}
          model={model}
          setModel={handleModelChange}
          provider={provider}
          setProvider={handleProviderChange}
          providerList={activeProviders}
          handleInputChange={(e) => {
            onTextareaChange(e);
            debouncedCachePrompt(e);
          }}
          handleStop={abort}
          description={description}
          importChat={importChat}
          exportChat={exportChat}
          messages={messages.map((message, i) => {
            if (message.role === 'user') {
              return message;
            }

            return {
              ...message,
              content: parsedMessages[i] || '',
            };
          })}
          enhancePrompt={() => {
            enhancePrompt(
              input,
              (input) => {
                setInput(input);
                scrollTextArea();
              },
              model,
              provider,
              apiKeys,
            );
          }}
          uploadedFiles={uploadedFiles}
          setUploadedFiles={setUploadedFiles}
          imageDataList={imageDataList}
          setImageDataList={setImageDataList}
          actionAlert={actionAlert}
          clearAlert={() => workbenchStore.clearAlert()}
          supabaseAlert={supabaseAlert}
          clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
          deployAlert={deployAlert}
          clearDeployAlert={() => workbenchStore.clearDeployAlert()}
          llmErrorAlert={llmErrorAlert}
          clearLlmErrorAlert={clearApiErrorAlert}
          data={chatData}
          chatMode={chatMode}
          setChatMode={setChatMode}
          append={append}
          designScheme={designScheme}
          setDesignScheme={setDesignScheme}
          selectedElement={selectedElement}
          setSelectedElement={setSelectedElement}
          addToolResult={addToolResult}
          onWebSearchResult={handleWebSearchResult}
        />
        <QuickBuildGenerationStatus project={quickBuildProject} onRetry={() => reload()} />
        <WorkspaceResumeStatus project={quickBuildProject} />
      </>
    );
  },
);
