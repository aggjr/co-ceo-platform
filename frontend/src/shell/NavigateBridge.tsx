import { onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { bindSolidNavigate } from '../router.js';

/** Liga navigate() legado ao router Solid. */
export function NavigateBridge() {
  const navigate = useNavigate();
  onMount(() => {
    bindSolidNavigate((path: string) => navigate(path));
  });
  return null;
}
