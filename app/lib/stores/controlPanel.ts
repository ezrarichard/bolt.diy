import { atom } from 'nanostores';
import type { TabType } from '~/components/@settings/core/types';

/**
 * Cross-component request to open the Control Panel, optionally on a specific tab.
 *
 * The panel itself is owned by Menu.client.tsx's local state (it lives inside the sidebar), so
 * anything outside the sidebar — the header's Observability status widget, for example — has no
 * way to open it without prop-drilling through unrelated components. This mirrors the existing
 * `requestNewProjectDialogStore` pattern in app/lib/stores/projects.ts rather than inventing a
 * second mechanism.
 *
 * The counter is what makes it a REQUEST rather than a state: clicking the same target twice must
 * reopen the panel, which a plain `{ tab }` value could not express.
 */

export interface ControlPanelRequest {
  nonce: number;
  tab?: TabType;
}

export const controlPanelRequestStore = atom<ControlPanelRequest>({ nonce: 0 });

export function requestControlPanel(tab?: TabType): void {
  controlPanelRequestStore.set({ nonce: controlPanelRequestStore.get().nonce + 1, tab });
}
