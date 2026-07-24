import { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { addProject, PROJECT_COLOR_OPTIONS, PROJECT_ICON_OPTIONS } from '~/lib/stores/projects';
import { blueprintEngine, type ProjectBlueprint } from '~/lib/blueprints';
import { DEFAULT_GENERATION_PROFILE_ID } from '~/lib/generation-profiles/defaultProfiles';
import { saveSelectedProfileForProject } from '~/lib/generation-profiles/generationProfileRepository';
import { PROJECT_COLOR_CLASSES } from './ProjectListItem';
import { GenerationProfileSelector } from './GenerationProfileSelector';
import { BuildersInput } from '~/components/ui/builders';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

interface BlueprintCardProps {
  blueprint: ProjectBlueprint;
  isSelected: boolean;
  onSelect: () => void;
}

function BlueprintCard({ blueprint, isSelected, onSelect }: BlueprintCardProps) {
  const isDisabled = !blueprint.enabled;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isDisabled}
      aria-pressed={isSelected}
      className={classNames(
        'relative flex flex-col items-start text-left p-4 rounded-xl border',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        'transition-all duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50',
        isDisabled
          ? 'opacity-50 cursor-not-allowed border-bolt-elements-borderColor/30'
          : isSelected
            ? 'border-purple-500 shadow-lg shadow-purple-500/10 bg-purple-500/5 dark:bg-purple-500/10 -translate-y-0.5'
            : 'border-bolt-elements-borderColor/40 dark:border-white/[0.06] hover:border-purple-500/30 hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      {isSelected && !isDisabled && (
        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center shrink-0">
          <div className="i-ph:check-bold w-3 h-3 text-white" />
        </div>
      )}
      <span className="text-2xl leading-none mb-2">{blueprint.icon}</span>
      <div className="text-sm font-semibold text-bolt-elements-textPrimary pr-6">{blueprint.name}</div>
      <div className="text-xs text-bolt-elements-textTertiary mt-1 leading-relaxed">{blueprint.description}</div>
      {blueprint.comingSoon && (
        <span className="mt-2 text-[10px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">
          Coming soon
        </span>
      )}
    </button>
  );
}

export function NewProjectDialog({ open, onClose }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [blueprintId, setBlueprintId] = useState<string>(blueprintEngine.getDefaultBlueprint().id);
  const [icon, setIcon] = useState<string>(PROJECT_ICON_OPTIONS[0]);
  const [color, setColor] = useState<string>(PROJECT_COLOR_OPTIONS[0]);
  const [generationProfileId, setGenerationProfileId] = useState<string>(DEFAULT_GENERATION_PROFILE_ID);

  const resetForm = () => {
    setName('');
    setDescription('');
    setBlueprintId(blueprintEngine.getDefaultBlueprint().id);
    setIcon(PROJECT_ICON_OPTIONS[0]);
    setColor(PROJECT_COLOR_OPTIONS[0]);
    setGenerationProfileId(DEFAULT_GENERATION_PROFILE_ID);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error('Give your project a name first');
      return;
    }

    const project = addProject({
      name: name.trim(),
      description: description.trim() || undefined,
      icon,
      color,
      blueprintId,
      projectType: 'guided_engineering',
      createdFrom: 'guided_engineering',
    });
    saveSelectedProfileForProject(project.id, generationProfileId);
    toast.success(`Project "${name.trim()}" created`);
    handleClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[100] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={handleClose} className="relative z-[101]">
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
                      New Project
                    </RadixDialog.Title>
                    <RadixDialog.Description className="text-sm text-bolt-elements-textTertiary mt-1">
                      Describe your product and your AI engineering team takes it from requirements to a deployable
                      prototype.
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
              <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8">
                {/*
                  Builders Design System (Sprint 69) — Limited Adoption target #5 ("one
                  representative form control group"). Was two hand-rolled `<label>` +
                  `<input>` pairs hardcoding `bg-gray-50 dark:bg-gray-900` / `focus:ring-purple-500`;
                  now the shared BuildersInput primitive — same field order, placeholders, and
                  controlled value/onChange wiring, so behavior is unchanged.
                */}
                <div className="space-y-4">
                  <BuildersInput
                    autoFocus
                    label="Project Name"
                    placeholder="e.g. LocalShop India"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <BuildersInput
                    label="Description"
                    placeholder="What is this project for?"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>

                {/* Generation Profile — Sprint 39.5 */}
                <div>
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                    Generation Profile
                  </h2>
                  <GenerationProfileSelector
                    value={generationProfileId}
                    onChange={setGenerationProfileId}
                    className="max-w-xs"
                  />
                </div>

                {/* Blueprint selection */}
                <div>
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                    Choose a Blueprint
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {blueprintEngine.getAllBlueprints().map((blueprint) => (
                      <BlueprintCard
                        key={blueprint.id}
                        blueprint={blueprint}
                        isSelected={blueprintId === blueprint.id}
                        onSelect={() => setBlueprintId(blueprint.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* Appearance */}
                <div>
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                    Appearance
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-bolt-elements-textTertiary mb-1.5">
                        Project Icon
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {PROJECT_ICON_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setIcon(option)}
                            className={classNames(
                              'w-9 h-9 flex items-center justify-center rounded-full border transition-colors',
                              icon === option
                                ? 'border-purple-500 bg-purple-500/10'
                                : 'border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800',
                            )}
                          >
                            <span className="text-base leading-none">{option}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-bolt-elements-textTertiary mb-1.5">
                        Project Accent Color
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {PROJECT_COLOR_OPTIONS.map((option) => {
                          const classes = PROJECT_COLOR_CLASSES[option];
                          return (
                            <button
                              key={option}
                              type="button"
                              aria-label={option}
                              onClick={() => setColor(option)}
                              className={classNames(
                                'w-7 h-7 rounded-full ring-2 transition-all',
                                classes.bg,
                                color === option ? 'ring-purple-500 scale-110' : 'ring-transparent',
                              )}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
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
                  onClick={handleCreate}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600"
                >
                  Create Project
                </button>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
