import { useEffect, useMemo, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { getProjectKnowledge, updateProjectKnowledge, type Project } from '~/lib/stores/projects';
import { getProjectKnowledgeHints, type ProjectKnowledge } from '~/lib/projects/knowledge';
import {
  projectKnowledgeEngine,
  KNOWLEDGE_SECTIONS,
  type KnowledgeFieldConfig,
  type KnowledgeFieldKey,
  type KnowledgeSectionId,
  type SectionCompletionStatus,
} from '~/lib/projects/projectKnowledgeEngine';
import { blueprintEngine } from '~/lib/blueprints';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '~/components/ui/Collapsible';
import { recordRequirementsFormSubmission } from '~/lib/projects/requirementsSessionOrchestrator';

interface ProjectRequirementsDialogProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;

  /**
   * Sprint 54.1 — called once `recordRequirementsFormSubmission`'s BuildersDB write settles
   * (success or failure — see that function's own doc comment; it never rejects). Purely a
   * "safe to re-fetch now" signal for `ProjectDashboard`'s Discovery Intelligence section;
   * never awaited before this dialog's own close/toast, which still happen immediately.
   */
  onSaved?: () => void;

  /** Sprint 56 — Interview Mode Foundation. Optional so this dialog still works standalone (e.g. in tests) without Interview Mode wired up. */
  onSwitchToInterview?: () => void;
}

/*
 * Phase 2 Sprint 10 — grouped, collapsible Requirements form driven entirely
 * by `projectKnowledgeEngine`/`KNOWLEDGE_SECTIONS` (see
 * app/lib/projects/projectKnowledgeEngine.ts). No section/field list is
 * hardcoded here — this component only renders whatever the engine
 * describes, computes completion/summary from the in-progress form state,
 * and saves via the same updateProjectKnowledge() used since Sprint 9. No
 * AI call, no generation, nothing here talks to GitHub, Supabase, or any
 * provider.
 */

type FormState = Record<KnowledgeFieldKey, string>;

function knowledgeToFormState(knowledge: ProjectKnowledge | undefined): FormState {
  const state = {} as FormState;

  for (const section of KNOWLEDGE_SECTIONS) {
    for (const field of section.fields) {
      const value = knowledge?.[field.key];
      state[field.key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }
  }

  return state;
}

/** Splits "a, b,, c" into ['a', 'b', 'c'] — trims and drops empty entries. */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function formStateToKnowledge(form: FormState): ProjectKnowledge {
  const knowledge: Record<string, unknown> = {};

  for (const section of KNOWLEDGE_SECTIONS) {
    for (const field of section.fields) {
      const raw = form[field.key] ?? '';
      knowledge[field.key] = field.kind === 'list' ? parseList(raw) : raw.trim() || undefined;
    }
  }

  return knowledge as ProjectKnowledge;
}

const SECTION_STATE_STORAGE_KEY = 'builder_requirements_section_state';

function defaultSectionState(): Record<KnowledgeSectionId, boolean> {
  return Object.fromEntries(KNOWLEDGE_SECTIONS.map((section) => [section.id, section.defaultExpanded])) as Record<
    KnowledgeSectionId,
    boolean
  >;
}

/** Task 2 — remembers which sections are expanded/collapsed across sessions, local only. */
function loadSectionState(): Record<KnowledgeSectionId, boolean> {
  const defaults = defaultSectionState();

  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const stored = localStorage.getItem(SECTION_STATE_STORAGE_KEY);

    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Failed to load requirements section state:', error);
  }

  return defaults;
}

function persistSectionState(state: Record<KnowledgeSectionId, boolean>) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SECTION_STATE_STORAGE_KEY, JSON.stringify(state));
  }
}

const textInputClasses = classNames(
  'w-full bg-gray-50 dark:bg-bolt-elements-background-depth-2 px-3 py-2 rounded-lg',
  'focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm',
  'text-gray-900 dark:text-bolt-elements-textPrimary placeholder-gray-500 dark:placeholder-bolt-elements-textTertiary',
  'border border-gray-200 dark:border-bolt-elements-borderColor',
);

function FieldLabel({ label, hint, recommended }: { label: string; hint?: string; recommended?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <label className="block text-xs font-medium text-bolt-elements-textTertiary">
        {label}
        {hint && <span className="ml-2 normal-case font-normal text-bolt-elements-textTertiary/70">{hint}</span>}
      </label>
      {recommended && (
        <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300 shrink-0">
          Recommended
        </span>
      )}
    </div>
  );
}

const SECTION_STATUS_META: Record<SectionCompletionStatus, { label: (percent: number) => string; className: string }> =
  {
    'not-started': {
      label: () => 'Not Started',
      className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
    },
    'in-progress': {
      label: (percent) => `${percent}%`,
      className: 'text-amber-600 dark:text-amber-400 border-amber-500/30',
    },
    completed: {
      label: () => '✔ Completed',
      className: 'text-green-600 dark:text-green-400 border-green-500/30',
    },
  };

function SectionCompletionBadge({ status, percent }: { status: SectionCompletionStatus; percent: number }) {
  const meta = SECTION_STATUS_META[status];

  return (
    <span className={classNames('text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0', meta.className)}>
      {meta.label(percent)}
    </span>
  );
}

export function ProjectRequirementsDialog({
  project,
  open,
  onClose,
  onSaved,
  onSwitchToInterview,
}: ProjectRequirementsDialogProps) {
  const [form, setForm] = useState<FormState>(() => knowledgeToFormState(undefined));
  const [expandedSections, setExpandedSections] = useState<Record<KnowledgeSectionId, boolean>>(() =>
    loadSectionState(),
  );

  const hints = getProjectKnowledgeHints(project?.blueprintId);
  const blueprint = project
    ? (blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint())
    : undefined;
  const recommendedFields = projectKnowledgeEngine.getRecommendedFields(project?.blueprintId);

  // Reset the form from the project's saved knowledge every time the dialog opens for a project.
  useEffect(() => {
    if (open) {
      setForm(knowledgeToFormState(project ? getProjectKnowledge(project) : undefined));
    }
  }, [open, project]);

  const liveKnowledge = useMemo(() => formStateToKnowledge(form), [form]);
  const completion = useMemo(() => projectKnowledgeEngine.getCompletion(liveKnowledge), [liveKnowledge]);
  const missingFields = useMemo(
    () => projectKnowledgeEngine.getMissingFields(liveKnowledge, project?.blueprintId),
    [liveKnowledge, project],
  );
  const summary = useMemo(
    () => projectKnowledgeEngine.getSummary(liveKnowledge, blueprint?.name),
    [liveKnowledge, blueprint],
  );

  const toggleSection = (id: KnowledgeSectionId, next: boolean) => {
    setExpandedSections((prev) => {
      const updated = { ...prev, [id]: next };
      persistSectionState(updated);

      return updated;
    });
  };

  const handleClose = () => {
    // Cancel discards in-progress edits — nothing is persisted.
    onClose();
  };

  const handleSave = () => {
    if (!project) {
      return;
    }

    const knowledge = formStateToKnowledge(form);
    updateProjectKnowledge(project.id, knowledge);

    /*
     * Sprint 51 — best-effort; never blocks or affects this save/close action, which both
     * happen synchronously below regardless of how long (or whether) this settles. Sprint
     * 54.1 — `onSaved` fires once it does, so `ProjectDashboard` knows it's safe to re-fetch
     * the Discovery Intelligence this write just produced.
     */
    recordRequirementsFormSubmission(project.id, knowledge).then(() => onSaved?.());

    toast.success('Requirements saved');
    onClose();
  };

  const update = (key: KnowledgeFieldKey) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  function renderField(field: KnowledgeFieldConfig) {
    const hintText = (hints as Partial<Record<KnowledgeFieldKey, string>>)[field.key];
    const placeholder = hintText ?? field.placeholder;
    const isRecommended = recommendedFields.includes(field.key);
    const listHint = field.kind === 'list' ? '(comma-separated)' : undefined;

    return (
      <div key={field.key} className={field.kind === 'textarea' ? 'sm:col-span-2' : undefined}>
        <FieldLabel label={field.label} hint={listHint} recommended={isRecommended} />
        {field.kind === 'textarea' ? (
          <textarea
            className={classNames(textInputClasses, 'min-h-[72px] resize-y')}
            placeholder={placeholder}
            value={form[field.key] ?? ''}
            onChange={update(field.key)}
          />
        ) : (
          <input
            className={textInputClasses}
            type="text"
            placeholder={placeholder}
            value={form[field.key] ?? ''}
            onChange={update(field.key)}
          />
        )}
      </div>
    );
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[110] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={handleClose} className="relative z-[111]">
            <div
              className={classNames(
                'w-[900px] max-w-[94vw] max-h-[88vh]',
                'bg-bolt-elements-background-depth-1',
                'rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor',
                'flex flex-col overflow-hidden relative',
                'transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              {/* Header */}
              <div className="px-8 pt-7 pb-5 border-b border-bolt-elements-borderColor/60">
                <div className="flex items-start justify-between">
                  <div>
                    <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary">
                      Requirements & Knowledge
                    </RadixDialog.Title>
                    <RadixDialog.Description className="text-sm text-bolt-elements-textTertiary mt-1">
                      Capture what this product should do before generating anything. Nothing here is sent to AI yet —
                      it's saved locally to this project.
                    </RadixDialog.Description>
                  </div>
                  <button
                    onClick={handleClose}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200 shrink-0"
                  >
                    <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
                {/* Task 3/6 — overall completion + live, auto-generated summary. */}
                <div
                  className={classNames(
                    'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                    'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                    'grid grid-cols-1 md:grid-cols-2 gap-6',
                  )}
                >
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                      Requirements Completion
                    </div>
                    <div className="h-2 w-full rounded-full bg-bolt-elements-background-depth-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all duration-300 ease-out"
                        style={{ width: `${completion.overall}%` }}
                      />
                    </div>
                    <div className="text-xs text-bolt-elements-textTertiary mt-2">{completion.overall}% Overall</div>

                    {missingFields.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {missingFields.map((field) => (
                          <span
                            key={field.key}
                            className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-600 dark:text-amber-400"
                          >
                            {field.label} recommended
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                      Live Summary{summary.productType ? ` — ${summary.productType}` : ''}
                    </div>
                    <div className="space-y-1 text-xs text-bolt-elements-textSecondary">
                      <div>
                        <span className="text-bolt-elements-textTertiary">Target: </span>
                        {summary.target || 'Not set'}
                      </div>
                      <div>
                        <span className="text-bolt-elements-textTertiary">Audience: </span>
                        {summary.audience || 'Not set'}
                      </div>
                      <div>
                        <span className="text-bolt-elements-textTertiary">Languages: </span>
                        {summary.languages.length > 0 ? summary.languages.join(', ') : 'Not set'}
                      </div>
                      <div>
                        <span className="text-bolt-elements-textTertiary">Pages: </span>
                        {summary.pages.length > 0 ? summary.pages.join(', ') : 'Not set'}
                      </div>
                      <div>
                        <span className="text-bolt-elements-textTertiary">Payments: </span>
                        {summary.payments.length > 0 ? summary.payments.join(', ') : 'None'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Task 1/2 — grouped, collapsible sections. */}
                {KNOWLEDGE_SECTIONS.map((section) => {
                  const sectionCompletion = completion.sections.find((entry) => entry.id === section.id);
                  const expanded = expandedSections[section.id];

                  return (
                    <Collapsible
                      key={section.id}
                      open={expanded}
                      onOpenChange={(next) => toggleSection(section.id, next)}
                    >
                      <div
                        className={classNames(
                          'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
                          'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                        )}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3 bg-transparent text-left appearance-none focus:outline-none"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={classNames(
                                  'i-ph:caret-right w-3.5 h-3.5 text-bolt-elements-textTertiary transition-transform duration-150',
                                  expanded && 'rotate-90',
                                )}
                              />
                              <span className="text-sm font-semibold text-bolt-elements-textPrimary">
                                {section.label}
                              </span>
                            </div>
                            {sectionCompletion && (
                              <SectionCompletionBadge
                                status={sectionCompletion.status}
                                percent={sectionCompletion.percent}
                              />
                            )}
                          </button>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4">
                            {section.fields.map((field) => renderField(field))}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-8 py-4 border-t border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/40">
                {/* Sprint 56 — Interview Mode escape hatch, symmetric to InterviewChatDialog's "Switch to Form" (UX spec §10: "never a trap"). */}
                {onSwitchToInterview ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSwitchToInterview();
                      onClose();
                    }}
                    className="flex gap-1.5 items-center text-xs text-bolt-elements-textTertiary hover:text-purple-500 transition-colors"
                  >
                    <span className="i-ph:chat-circle-dots h-4 w-4" />
                    Talk it through instead
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleClose}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-transparent text-bolt-elements-textSecondary hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-bolt-elements-textPrimary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!project}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save Requirements
                  </button>
                </div>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
