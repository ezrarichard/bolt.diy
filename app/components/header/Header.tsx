import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { BuildersWordmark } from '~/components/branding/BuildersLogo';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header className="flex items-center gap-2 px-2.5 border-b border-bolt-elements-borderColor h-[var(--header-height)] bg-bolt-elements-background-depth-1">
      <a href="/" className="flex items-center z-logo cursor-pointer shrink-0">
        <BuildersWordmark iconSize={24} />
      </a>

      {chat.started && (
        <>
          <span className="text-bolt-elements-textTertiary text-sm shrink-0">/</span>
          <div className="min-w-0 flex-1 truncate text-sm text-bolt-elements-textSecondary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </div>
        </>
      )}

      {!chat.started && <div className="flex-1" />}

      {chat.started && (
        <div className="shrink-0">
          <ClientOnly>{() => <HeaderActionButtons chatStarted={chat.started} />}</ClientOnly>
        </div>
      )}
    </header>
  );
}
