import { createSignal } from 'solid-js';
import {
  getActiveContext,
  getUser,
  isImpersonating,
  getImpersonatorMeta,
} from '../auth/session.js';

export const [pageTitle, setPageTitle] = createSignal<string>('Cockpit');
export const [user, setUserSignal] = createSignal(getUser());
export const [activeContext, setActiveContextSignal] = createSignal(getActiveContext());
export const [impersonating, setImpersonatingSignal] = createSignal(isImpersonating());
export const [impersonatorMeta, setImpersonatorMetaSignal] = createSignal(getImpersonatorMeta());

/* IVA (IA conselheira) — desativada até implementação; evita botão sobre a barra de emulação.
export const [aiPanelOpen, setAiPanelOpen] = createSignal<boolean>(false);
*/

/**
 * Atualiza os sinais reativos com base no estado atual do localStorage/sessionStorage.
 * Chamado após login, logout, início ou fim de personificação.
 */
export function refreshSessionState() {
  setUserSignal(getUser());
  setActiveContextSignal(getActiveContext());
  setImpersonatingSignal(isImpersonating());
  setImpersonatorMetaSignal(getImpersonatorMeta());
}
