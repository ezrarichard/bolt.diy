import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import {
  addProjectArtifact,
  appendProjectDefinitionChatMessage,
  approveProjectDefinition,
  getProjectArtifacts,
  getProjectKnowledge,
  updateProjectKnowledge,
  type Project,
} from '~/lib/stores/projects';
import {
  ARTIFACT_TYPES,
  formatArtifactTimestamp,
  getLatestArtifact,
  parseArtifactContent,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import { businessAnalystEngine } from '~/lib/projects/businessAnalystEngine';
import { REQUIREMENTS_DRAFT_FIELDS, type RequirementsDraft } from '~/lib/projects/prompts/requirements';
import type { ProjectManagerChatTurn } from '~/lib/projects/prompts/projectManagerRevision';
import type { ProjectDefinitionChatMessage } from '~/lib/projects/projectDefinition';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import { useAuth } from '~/lib/auth/AuthProvider';

const ARTIFACT_TYPE = ARTIFACT_TYPES.REQUIREMENTS_DRAFT;

interface ProjectDefinitionWorkspaceProps {
  project: Project;
}

/**
 * Project Definition — the Business Overview/Goals/... grid, read straight off the latest
 * Project Definition artifact. Deliberately its own component (not shared with
 * RequirementsDraftPanel's preview grid) so future sections (Timeline, Risks, Attachments,
 * Stakeholders — explicitly out of scope for this sprint) can be added as additional
 * siblings inside ProjectDefinitionWorkspace without reworking a shared renderer.
 */
function ProjectDefinitionSection({ draft, version }: { draft: RequirementsDraft; version: number | undefined }) {
  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
          Project Definition
        </h3>
        {version !== undefined && (
          <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300">
            v{version}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {REQUIREMENTS_DRAFT_FIELDS.filter((field) => field.kind !== 'decisions').map((field) => {
          const value = draft[field.key];
          const display = Array.isArray(value) ? (value as string[]).join(', ') : (value as string | undefined);

          if (!display) {
            return null;
          }

          return (
            <div key={field.key}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                {field.label}
              </div>
              <div className="text-sm text-bolt-elements-textSecondary whitespace-pre-line">{display}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** AI Project Manager Chat — the only way to revise the Project Definition after its initial draft. */
function ProjectManagerChatSection({
  project,
  draft,
  onRevised,
  disabled,
}: {
  project: Project;
  draft: RequirementsDraft;
  onRevised: () => void;
  disabled: boolean;
}) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { generate } = useGenerateText();
  const messages = project.projectDefinitionChat ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = message.trim();

    if (!trimmed || isSending || disabled) {
      return;
    }

    setIsSending(true);
    setMessage('');

    const userMessage: ProjectDefinitionChatMessage = {
      id: `pm-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    appendProjectDefinitionChatMessage(project.id, userMessage);

    const chatHistory: ProjectManagerChatTurn[] = messages.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

    const { system, prompt } = businessAnalystEngine.buildRevisionPrompt(draft, chatHistory, trimmed);
    const generateOptions = getRoleGenerateOptions(project, ARTIFACT_TYPE);
    const result = await generate(system, prompt, {
      ...generateOptions,
      projectId: project.id,
      roleKey: ARTIFACT_TYPE,
      requestType: 'project_definition_revision',
    });

    if (!result.ok) {
      appendProjectDefinitionChatMessage(project.id, {
        id: `pm-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: `I couldn't process that request: ${result.error}`,
        createdAt: new Date().toISOString(),
      });
      setIsSending(false);

      return;
    }

    const parsed = businessAnalystEngine.parseRevisionResponse(result.text);

    if (!parsed.ok) {
      appendProjectDefinitionChatMessage(project.id, {
        id: `pm-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: `I couldn't process that request: ${parsed.error}`,
        createdAt: new Date().toISOString(),
      });
      setIsSending(false);

      return;
    }

    appendProjectDefinitionChatMessage(project.id, {
      id: `pm-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: parsed.reply,
      createdAt: new Date().toISOString(),
    });

    if (Object.keys(parsed.updatedFields).length > 0) {
      const artifacts = getProjectArtifacts(project);
      const latest = getLatestArtifact(artifacts, ARTIFACT_TYPE);
      const nextVersion = (latest?.version ?? 1) + 1;

      const { artifact, mergedDraft } = businessAnalystEngine.createRevisedDraftArtifact(
        draft,
        parsed.updatedFields,
        nextVersion,
        trimmed,
        parsed.changeSummary,
        generateOptions.model,
      );

      addProjectArtifact(project.id, artifact, 'manual');

      const knowledgeUpdate = businessAnalystEngine.summarizeRequirements(mergedDraft, getProjectKnowledge(project));
      updateProjectKnowledge(project.id, knowledgeUpdate);

      toast.success(`Project Definition updated to v${nextVersion}`);
      onRevised();
    }

    setIsSending(false);
  };

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] flex flex-col',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="px-5 pt-4 pb-3 border-b border-bolt-elements-borderColor/30">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
          AI Project Manager Chat
        </h3>
        <p className="text-[11px] text-bolt-elements-textTertiary mt-0.5">
          Tell the AI Project Manager what to change — e.g. "Remove online payment" or "Move Inventory to Phase 2."
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-[180px] max-h-[320px] overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-xs text-bolt-elements-textTertiary italic">
            No messages yet — ask for a change to get started.
          </div>
        ) : (
          messages.map((entry) => (
            <div key={entry.id} className={classNames('flex', entry.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={classNames(
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                  entry.role === 'user'
                    ? 'bg-purple-500 text-white'
                    : 'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary border border-bolt-elements-borderColor/40',
                )}
              >
                {entry.content}
              </div>
            </div>
          ))
        )}
        {isSending && (
          <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary">
            <span className="i-svg-spinners:90-ring-with-bg w-3.5 h-3.5 text-purple-500" />
            The AI Project Manager is updating the Project Definition…
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-bolt-elements-borderColor/30 flex gap-2">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled || isSending}
          rows={1}
          placeholder={disabled ? 'Project Definition is approved and locked.' : 'Ask for a change…'}
          className="flex-1 resize-none rounded-lg border border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || isSending || !message.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/** Version History — every Project Definition version, newest first, with its revision request/change summary when it came from a chat revision. */
function VersionHistorySection({ versions }: { versions: ProjectArtifact[] }) {
  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-3">
        Version History
      </h3>
      <ul className="space-y-3">
        {versions.map((version) => {
          const draft = parseArtifactContent<RequirementsDraft>(version.content);

          return (
            <li
              key={`${version.id}-${version.version}`}
              className="rounded-lg border border-bolt-elements-borderColor/30 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-bolt-elements-textPrimary">
                  Project Definition v{version.version ?? 1}
                </span>
                <span className="text-[11px] text-bolt-elements-textTertiary shrink-0">
                  {formatArtifactTimestamp(version.updatedAt)}
                </span>
              </div>
              {draft?.versionMeta?.revisionRequest && (
                <div className="text-xs text-bolt-elements-textTertiary mt-1">
                  Requested: "{draft.versionMeta.revisionRequest}"
                </div>
              )}
              {draft?.versionMeta?.changeSummary && (
                <div className="text-xs text-bolt-elements-textSecondary mt-0.5">{draft.versionMeta.changeSummary}</div>
              )}
              <div className="text-[11px] text-bolt-elements-textTertiary mt-1">
                {version.generatedBy ?? 'AI Project Manager'}
                {draft?.versionMeta?.modelUsed ? ` · ${draft.versionMeta.modelUsed}` : ''}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Project Definition Workspace — Guided Engineering's new "Project Definition" stage.
 *
 * Replaces the old flow (Requirements approved -> pipeline starts immediately) with a
 * dedicated review stage: PRD viewer, AI Project Manager chat, version history, and the one
 * action that actually starts the AI Engineering Team — "Approve Project Definition & Start
 * Engineering". Sections are deliberately separate, sibling components (not one monolithic
 * render) so future additions (Timeline, Risks, Attachments, Stakeholders — out of scope for
 * this sprint) can be appended without restructuring what's here.
 */
export function ProjectDefinitionWorkspace({ project }: ProjectDefinitionWorkspaceProps) {
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);

  const artifacts = getProjectArtifacts(project);
  const versions = artifacts
    .filter((artifact) => artifact.type === ARTIFACT_TYPE)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));

  const latest = versions[0];
  const latestDraft = latest ? parseArtifactContent<RequirementsDraft>(latest.content) : undefined;

  if (!latest || !latestDraft) {
    return null;
  }

  const handleApprove = () => {
    setIsApproving(true);
    approveProjectDefinition(project.id, user ? { id: user.id, displayName: user.email ?? user.id } : null);
    toast.success('Project Definition approved — starting your AI Engineering Team');
  };

  return (
    <div className="space-y-6">
      <ProjectDefinitionSection draft={latestDraft} version={latest.version} />

      <ProjectManagerChatSection
        project={project}
        draft={latestDraft}
        onRevised={() => setIsApproving(false)}
        disabled={isApproving}
      />

      <VersionHistorySection versions={versions} />

      <div
        className={classNames(
          'rounded-xl border border-purple-500/30 p-5 flex flex-wrap items-center justify-between gap-4',
          'bg-purple-50/70 dark:bg-purple-500/[0.08] backdrop-blur-md',
        )}
      >
        <div>
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Ready to start building?</div>
          <div className="text-xs text-bolt-elements-textTertiary mt-0.5">
            Approving locks the current Project Definition (v{latest.version ?? 1}) and starts your AI Engineering Team
            automatically — Architecture, Database, UI/UX, Backend, Frontend, QA, and Product Package.
          </div>
        </div>
        <button
          type="button"
          onClick={handleApprove}
          disabled={isApproving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 shrink-0"
        >
          <span className="i-ph:rocket-launch-duotone w-4 h-4" />
          {isApproving ? 'Starting Engineering Team…' : 'Approve Project Definition & Start Engineering'}
        </button>
      </div>
    </div>
  );
}
