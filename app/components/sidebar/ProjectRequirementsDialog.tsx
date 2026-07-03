import { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { getProjectKnowledge, updateProjectKnowledge, type Project } from '~/lib/stores/projects';
import { getProjectKnowledgeHints, type ProjectKnowledge } from '~/lib/projects/knowledge';

interface ProjectRequirementsDialogProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

/*
 * Phase 2 Sprint 9 — editable local form for a project's structured
 * Project Knowledge (see app/lib/projects/knowledge.ts). This is a plain
 * local form: no AI call, no generation, nothing here talks to GitHub,
 * Supabase, or any provider. Saving just calls updateProjectKnowledge(),
 * which merges into the project and persists to localStorage exactly like
 * every other project write.
 *
 * List-style fields (Core Features, Pages/Screens, User Roles,
 * Integrations, Payments, Compliance, Shipping, Languages) are edited as
 * comma-separated text for now, per spec ("allow comma-separated input for
 * now") — parsed into string[] only on save.
 */

/** In-progress form state — list fields are kept as raw comma-separated text while editing. */
interface RequirementsFormState {
  projectVision: string;
  targetUsers: string;
  coreFeatures: string;
  pagesOrScreens: string;
  userRoles: string;
  integrations: string;
  paymentNeeds: string;
  complianceNeeds: string;
  shippingNeeds: string;
  languages: string;
  location: string;
  notes: string;
}

const EMPTY_FORM_STATE: RequirementsFormState = {
  projectVision: '',
  targetUsers: '',
  coreFeatures: '',
  pagesOrScreens: '',
  userRoles: '',
  integrations: '',
  paymentNeeds: '',
  complianceNeeds: '',
  shippingNeeds: '',
  languages: '',
  location: '',
  notes: '',
};

function knowledgeToFormState(knowledge: ProjectKnowledge | undefined): RequirementsFormState {
  return {
    projectVision: knowledge?.projectVision ?? '',
    targetUsers: knowledge?.targetUsers ?? '',
    coreFeatures: (knowledge?.coreFeatures ?? []).join(', '),
    pagesOrScreens: (knowledge?.pagesOrScreens ?? []).join(', '),
    userRoles: (knowledge?.userRoles ?? []).join(', '),
    integrations: (knowledge?.integrations ?? []).join(', '),
    paymentNeeds: (knowledge?.paymentNeeds ?? []).join(', '),
    complianceNeeds: (knowledge?.complianceNeeds ?? []).join(', '),
    shippingNeeds: (knowledge?.shippingNeeds ?? []).join(', '),
    languages: (knowledge?.languages ?? []).join(', '),
    location: knowledge?.location ?? '',
    notes: knowledge?.notes ?? '',
  };
}

/** Splits "a, b,, c" into ['a', 'b', 'c'] — trims and drops empty entries. */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function formStateToKnowledge(form: RequirementsFormState): Partial<ProjectKnowledge> {
  return {
    projectVision: form.projectVision.trim() || undefined,
    targetUsers: form.targetUsers.trim() || undefined,
    coreFeatures: parseList(form.coreFeatures),
    pagesOrScreens: parseList(form.pagesOrScreens),
    userRoles: parseList(form.userRoles),
    integrations: parseList(form.integrations),
    paymentNeeds: parseList(form.paymentNeeds),
    complianceNeeds: parseList(form.complianceNeeds),
    shippingNeeds: parseList(form.shippingNeeds),
    languages: parseList(form.languages),
    location: form.location.trim() || undefined,
    notes: form.notes.trim() || undefined,
  };
}

const textInputClasses = classNames(
  'w-full bg-gray-50 dark:bg-bolt-elements-background-depth-2 px-3 py-2 rounded-lg',
  'focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm',
  'text-gray-900 dark:text-bolt-elements-textPrimary placeholder-gray-500 dark:placeholder-bolt-elements-textTertiary',
  'border border-gray-200 dark:border-bolt-elements-borderColor',
);

interface FieldProps {
  label: string;
  hint?: string;
}

function FieldLabel({ label, hint }: FieldProps) {
  return (
    <label className="block text-xs font-medium text-bolt-elements-textTertiary mb-1.5">
      {label}
      {hint && <span className="ml-2 normal-case font-normal text-bolt-elements-textTertiary/70">{hint}</span>}
    </label>
  );
}

export function ProjectRequirementsDialog({ project, open, onClose }: ProjectRequirementsDialogProps) {
  const [form, setForm] = useState<RequirementsFormState>(EMPTY_FORM_STATE);

  /*
   * Sprint 9 (Task 5) — blueprint-aware placeholder hints only. These are
   * never written into `form` automatically; they're passed as the
   * `placeholder` attribute so the user sees a helpful example and still
   * has to type (or the field stays empty on save) — nothing is prefilled
   * as a real value unless the user saves it themselves.
   */
  const hints = getProjectKnowledgeHints(project?.blueprintId);

  // Reset the form from the project's saved knowledge every time the dialog opens for a project.
  useEffect(() => {
    if (open) {
      setForm(knowledgeToFormState(project ? getProjectKnowledge(project) : undefined));
    }
  }, [open, project]);

  const handleClose = () => {
    // Cancel discards in-progress edits — nothing is persisted.
    onClose();
  };

  const handleSave = () => {
    if (!project) {
      return;
    }

    updateProjectKnowledge(project.id, formStateToKnowledge(form));
    toast.success('Requirements saved');
    onClose();
  };

  const update =
    (field: keyof RequirementsFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[110] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={handleClose} className="relative z-[111]">
            <div
              className={classNames(
                'w-[760px] max-w-[92vw] max-h-[85vh]',
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
                <div>
                  <FieldLabel label="Project Vision" />
                  <textarea
                    className={classNames(textInputClasses, 'min-h-[72px] resize-y')}
                    placeholder="What is this product, in a sentence or two?"
                    value={form.projectVision}
                    onChange={update('projectVision')}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <FieldLabel label="Target Users" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.targetUsers ?? 'Who is this for?'}
                      value={form.targetUsers}
                      onChange={update('targetUsers')}
                    />
                  </div>

                  <div>
                    <FieldLabel label="Region / Location" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder="e.g. India, Tamil Nadu, Global"
                      value={form.location}
                      onChange={update('location')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <FieldLabel label="Core Features" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.coreFeatures ?? 'e.g. Login, Search, Checkout'}
                      value={form.coreFeatures}
                      onChange={update('coreFeatures')}
                    />
                  </div>

                  <div>
                    <FieldLabel label="Pages / Screens" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.pagesOrScreens ?? 'e.g. Home, Dashboard, Settings'}
                      value={form.pagesOrScreens}
                      onChange={update('pagesOrScreens')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <FieldLabel label="User Roles" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.userRoles ?? 'e.g. Admin, Member'}
                      value={form.userRoles}
                      onChange={update('userRoles')}
                    />
                  </div>

                  <div>
                    <FieldLabel label="Integrations" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.integrations ?? 'e.g. WhatsApp, Google Maps'}
                      value={form.integrations}
                      onChange={update('integrations')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <FieldLabel label="Payments" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.paymentNeeds ?? 'e.g. Razorpay, UPI, PhonePe, Paytm, Cashfree'}
                      value={form.paymentNeeds}
                      onChange={update('paymentNeeds')}
                    />
                  </div>

                  <div>
                    <FieldLabel label="Compliance" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.complianceNeeds ?? 'e.g. GST, Invoice generation'}
                      value={form.complianceNeeds}
                      onChange={update('complianceNeeds')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <FieldLabel label="Shipping" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder={hints.shippingNeeds ?? 'e.g. Shiprocket, Delhivery'}
                      value={form.shippingNeeds}
                      onChange={update('shippingNeeds')}
                    />
                  </div>

                  <div>
                    <FieldLabel label="Languages" hint="(comma-separated)" />
                    <input
                      className={textInputClasses}
                      type="text"
                      placeholder="e.g. English, Hindi, Tamil, Malayalam"
                      value={form.languages}
                      onChange={update('languages')}
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel label="Notes" />
                  <textarea
                    className={classNames(textInputClasses, 'min-h-[72px] resize-y')}
                    placeholder={hints.notes ?? 'Anything else worth capturing.'}
                    value={form.notes}
                    onChange={update('notes')}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 px-8 py-4 border-t border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/40">
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
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
