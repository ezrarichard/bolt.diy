import { useEffect, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { profileStore, updateProfile } from '~/lib/stores/profile';
import { toast } from 'react-toastify';
import { debounce } from '~/utils/debounce';
import { useAuth } from '~/lib/auth/AuthProvider';

/**
 * Sprint 41.6 — "Account" section wired to the centralized `public.profiles` row via
 * AuthProvider's `updateCurrentUserProfile()` (no separate query here). Deliberately a
 * standalone component so its own save/error/success state doesn't get tangled up with the
 * unrelated local chat-display fields below.
 */
function AccountSection() {
  const { user, profile, updateCurrentUserProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /*
   * Only resync from the loaded profile when it actually changes underneath us (e.g. after
   * ensureUserProfile() resolves on login) — never while the user still has unsaved edits.
   */
  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setAvatarUrl(profile?.avatarUrl ?? '');
  }, [profile?.displayName, profile?.avatarUrl]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    const { error: saveError } = await updateCurrentUserProfile({
      displayName: displayName.trim(),
      avatarUrl: avatarUrl.trim(),
    });

    setSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    setSuccess(true);
  };

  return (
    <div className="mb-8 pb-8 border-b border-gray-200 dark:border-gray-700/50">
      <label className="block text-base font-medium text-gray-900 dark:text-gray-100 mb-1">Account</label>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Your display name is shown in the sidebar greeting and the profile menu.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSuccess(false);
          }}
          placeholder="Your name"
          className={classNames(
            'w-full px-4 py-2.5 rounded-xl',
            'bg-white dark:bg-gray-800/50',
            'border border-gray-200 dark:border-gray-700/50',
            'text-gray-900 dark:text-white',
            'placeholder-gray-400 dark:placeholder-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50',
            'transition-all duration-300 ease-out',
          )}
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Email</label>
        <input
          type="text"
          value={user?.email ?? ''}
          readOnly
          disabled
          className={classNames(
            'w-full px-4 py-2.5 rounded-xl cursor-not-allowed',
            'bg-gray-100 dark:bg-gray-900/50',
            'border border-gray-200 dark:border-gray-700/50',
            'text-gray-500 dark:text-gray-400',
          )}
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
          Avatar URL <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={avatarUrl}
          onChange={(event) => {
            setAvatarUrl(event.target.value);
            setSuccess(false);
          }}
          placeholder="https://example.com/avatar.png"
          className={classNames(
            'w-full px-4 py-2.5 rounded-xl',
            'bg-white dark:bg-gray-800/50',
            'border border-gray-200 dark:border-gray-700/50',
            'text-gray-900 dark:text-white',
            'placeholder-gray-400 dark:placeholder-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50',
            'transition-all duration-300 ease-out',
          )}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
      )}

      {success && !error && (
        <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm text-green-600 dark:text-green-400">
          Profile updated
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className={classNames(
          'px-5 py-2.5 rounded-xl text-sm font-medium',
          'bg-purple-600 text-white hover:bg-purple-700',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors duration-200',
        )}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

export default function ProfileTab() {
  const profile = useStore(profileStore);
  const [isUploading, setIsUploading] = useState(false);

  // Create debounced update functions
  const debouncedUpdate = useCallback(
    debounce((field: 'username' | 'bio', value: string) => {
      updateProfile({ [field]: value });
      toast.success(`${field.charAt(0).toUpperCase() + field.slice(1)} updated`);
    }, 1000),
    [],
  );

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsUploading(true);

      // Convert the file to base64
      const reader = new FileReader();

      reader.onloadend = () => {
        const base64String = reader.result as string;
        updateProfile({ avatar: base64String });
        setIsUploading(false);
        toast.success('Profile picture updated');
      };

      reader.onerror = () => {
        console.error('Error reading file:', reader.error);
        setIsUploading(false);
        toast.error('Failed to update profile picture');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading avatar:', error);
      setIsUploading(false);
      toast.error('Failed to update profile picture');
    }
  };

  const handleProfileUpdate = (field: 'username' | 'bio', value: string) => {
    // Update the store immediately for UI responsiveness
    updateProfile({ [field]: value });

    // Debounce the toast notification
    debouncedUpdate(field, value);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="space-y-6">
        <AccountSection />

        {/* Chat display (local only) — this is the avatar/name shown next to YOUR messages
            in the chat transcript (see app/components/chat/UserMessage.tsx). Unrelated to
            the Account section above; stored in localStorage, not public.profiles. */}
        <div>
          <label className="block text-base font-medium text-gray-900 dark:text-gray-100 mb-1">Chat Display</label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Shown next to your own messages in the chat transcript only.
          </p>

          {/* Avatar Upload */}
          <div className="flex items-start gap-6 mb-8">
            <div
              className={classNames(
                'w-24 h-24 rounded-full overflow-hidden',
                'bg-gray-100 dark:bg-gray-800/50',
                'flex items-center justify-center',
                'ring-1 ring-gray-200 dark:ring-gray-700',
                'relative group',
                'transition-all duration-300 ease-out',
                'hover:ring-purple-500/30 dark:hover:ring-purple-500/30',
                'hover:shadow-lg hover:shadow-purple-500/10',
              )}
            >
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt="Profile"
                  className={classNames(
                    'w-full h-full object-cover',
                    'transition-all duration-300 ease-out',
                    'group-hover:scale-105 group-hover:brightness-90',
                  )}
                />
              ) : (
                <div className="i-ph:robot-fill w-16 h-16 text-gray-400 dark:text-gray-500 transition-colors group-hover:text-purple-500/70 transform -translate-y-1" />
              )}

              <label
                className={classNames(
                  'absolute inset-0',
                  'flex items-center justify-center',
                  'bg-black/0 group-hover:bg-black/40',
                  'cursor-pointer transition-all duration-300 ease-out',
                  isUploading ? 'cursor-wait' : '',
                )}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  disabled={isUploading}
                />
                {isUploading ? (
                  <div className="i-ph:spinner-gap w-6 h-6 text-white animate-spin" />
                ) : (
                  <div className="i-ph:camera-plus w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-300 ease-out transform group-hover:scale-110" />
                )}
              </label>
            </div>

            <div className="flex-1 pt-1">
              <label className="block text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
                Profile Picture
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400">Upload a profile picture or avatar</p>
            </div>
          </div>

          {/* Username Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Username</label>
            <div className="relative group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                <div className="i-ph:user-circle-fill w-5 h-5 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-purple-500" />
              </div>
              <input
                type="text"
                value={profile.username}
                onChange={(e) => handleProfileUpdate('username', e.target.value)}
                className={classNames(
                  'w-full pl-11 pr-4 py-2.5 rounded-xl',
                  'bg-white dark:bg-gray-800/50',
                  'border border-gray-200 dark:border-gray-700/50',
                  'text-gray-900 dark:text-white',
                  'placeholder-gray-400 dark:placeholder-gray-500',
                  'focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50',
                  'transition-all duration-300 ease-out',
                )}
                placeholder="Enter your username"
              />
            </div>
          </div>

          {/* Bio Input */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Bio</label>
            <div className="relative group">
              <div className="absolute left-3.5 top-3">
                <div className="i-ph:text-aa w-5 h-5 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-purple-500" />
              </div>
              <textarea
                value={profile.bio}
                onChange={(e) => handleProfileUpdate('bio', e.target.value)}
                className={classNames(
                  'w-full pl-11 pr-4 py-2.5 rounded-xl',
                  'bg-white dark:bg-gray-800/50',
                  'border border-gray-200 dark:border-gray-700/50',
                  'text-gray-900 dark:text-white',
                  'placeholder-gray-400 dark:placeholder-gray-500',
                  'focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50',
                  'transition-all duration-300 ease-out',
                  'resize-none',
                  'h-32',
                )}
                placeholder="Tell us about yourself"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
