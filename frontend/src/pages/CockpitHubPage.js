import { navigate } from '../router.js';
import { isAuthenticated, isGlobalSession } from '../auth/session.js';

export async function CockpitHubPage(_container) {
  if (!isAuthenticated()) {
    navigate('/login');
    return;
  }
  if (isGlobalSession()) {
    navigate('/cockpit/platform');
  } else {
    navigate('/cockpit/client');
  }
}
