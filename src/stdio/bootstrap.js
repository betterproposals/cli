import { setDefaultContext } from '../core/context.js';
import { resetLimits } from '../core/api.js';
import { getAccessToken, refreshAccessToken, onIdentityChange } from './auth.js';

let configured = false;

// Wires the local credentials (keychain, credentials file or --token) into the
// shared API client. Called once by each stdio entry point.
export function configureStdioContext() {
    if (configured) return;
    configured = true;

    setDefaultContext({
        getAuthHeaders: async () => ({ Bptoken: await getAccessToken() }),
        refreshAuth: refreshAccessToken,
    });
    onIdentityChange(resetLimits);
}
