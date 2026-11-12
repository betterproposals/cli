import { setDefaultContext } from '../core/context.js';
import { getAccessToken, refreshAccessToken, onIdentityChange } from './auth.js';
import { createStdioLimitsStore } from './limits-cache.js';

let configured = false;

// Wires the local credentials (keychain, credentials file or --token) and the
// limits memory into the shared API client. Called once by each stdio entry
// point.
export function configureStdioContext() {
    if (configured) return;
    configured = true;

    const limitsStore = createStdioLimitsStore();
    setDefaultContext({
        getAuthHeaders: async () => ({ Bptoken: await getAccessToken() }),
        refreshAuth: refreshAccessToken,
        limitsStore,
    });
    onIdentityChange(() => limitsStore.clear());
}
