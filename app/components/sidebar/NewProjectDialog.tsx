import { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogTitle } from '~/components/ui/Dialog';
import { classNames } from '~/utils/classNames';
import { addProject, PROJECT_COLOR_OPTIONS, PROJECT_ICON_OPTIONS } from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from './ProjectListItem';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewProjectDialog({ open, onClose }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string>(PROJECT_ICON_OPTIONS[0]);
  const [color, setColor] = useState<string>(PROJECT_COLOR_OPTIONS[0]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setIcon(PROJECT_ICON_OPTIONS[0]);
    setColor(PROJECT_COLOR_OPTIONS[0]);
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

    addProject({ name: name.trim(), description: description.trim() || undefined, icon, color });
    toast.success(`Project "${name.trim()}" created`);
    handleClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <Dialog onBackdrop={handleClose} onClose={handleClose}>
        <div className="p-6 bg-white dark:bg-gray-950">
          <DialogTitle className="text-gray-900 dark:text-white">New Project</DialogTitle>
          <DialogDescription className="mt-1 text-gray-600 dark:text-gray-400">
            Projects group related chats together. This is UI-only for now — chats aren&apos;t assigned automatically.
          </DialogDescription>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Name</label>
              <input
                autoFocus
                className="w-full bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-800"
                type="text"
                placeholder="e.g. LocalShop India"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Description (optional)
              </label>
              <input
                className="w-full bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-800"
                type="text"
                placeholder="What is this project for?"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Icon</label>
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
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Color</label>
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
        <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
          <DialogButton type="secondary" onClick={handleClose}>
            Cancel
          </DialogButton>
          <DialogButton type="primary" onClick={handleCreate}>
            Create Project
          </DialogButton>
        </div>
      </Dialog>
    </RadixDialog.Root>
  );
}
