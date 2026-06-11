import open from 'open';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SERVICE = 'betterproposals-cli';
const NAME = 'betterproposals-token';
const CRED_FILE = join(homedir(), '.config', 'betterproposals', 'credentials.json');

async function secretsSet(value) {
    try {
        await Bun.secrets.set({ service: SERVICE, name: NAME, value });
    } catch {
        await mkdir(join(homedir(), '.config', 'betterproposals'), { recursive: true });
        await writeFile(CRED_FILE, value, { mode: 0o600 });
    }
}

async function secretsGet() {
    try {
        return await Bun.secrets.get({ service: SERVICE, name: NAME }) ?? null;
    } catch {
        try {
            return await readFile(CRED_FILE, 'utf8');
        } catch {
            return null;
        }
    }
}

async function secretsDelete() {
    try { await Bun.secrets.delete({ service: SERVICE, name: NAME }); } catch { /* unavailable */ }
    try { await unlink(CRED_FILE); } catch { /* doesn't exist */ }
}

const APP_BASE = 'https://cli.dev.betterproposals.io/2/cli/'; //TODO: Replace with production URL

const LOGIN_BASE  = APP_BASE + 'login';   //TODO: Replace with production URL
const TOKEN_URL   = APP_BASE + 'token';   //TODO: Replace with production URL
const REFRESH_URL = APP_BASE + 'refresh'; //TODO: Replace with production URL

const BLOCKED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no">
<title>Account restricted - Better Proposals</title>
<link rel="preconnect" href="https://use.typekit.net">
<link rel="stylesheet" href="https://use.typekit.net/uci0kgk.css">
</head>
<body style="margin:0; padding:0; background:#fafafa; font-family: -apple-system, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif;">

<div style="display:flex; flex-direction: column; gap: 2rem; align-items:center; margin: 4rem auto; box-sizing:border-box; max-width: 75%">
    <div style="margin-bottom:32px;">
        <img src="https://betterproposals.io/2/img/logos/bp-logo-dark.svg" alt="Better Proposals" style="width:180px;" />
    </div>
    <div style="font-family: 'neue-haas-grotesk-display', -apple-system, system-ui, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif; color:#5C5C5C; font-size:2rem; font-weight:500; letter-spacing: 0.03rem; line-height:1.3; margin-bottom:-1rem;">Account restricted</div>
    <div style="font-family: 'neue-haas-grotesk-display', -apple-system, system-ui, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif; color:#5C5C5C; font-size:1rem; font-weight:500; letter-spacing: 0.03rem; line-height:1.3; margin-bottom:0;">Your account has been restricted. Please contact Better Proposals support.</div>
</div>

</body>
</html>`;

// Page shown in the browser when the user clicks Cancel on the BP login
// screen. Mirrors the success page.
const CANCELLED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no">
<title>Login cancelled - Better Proposals</title>
<link rel="preconnect" href="https://use.typekit.net">
<link rel="stylesheet" href="https://use.typekit.net/uci0kgk.css">
</head>
<body style="margin:0; padding:0; background:#fafafa; font-family: -apple-system, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif;">

<div style="display:flex; flex-direction: column; gap: 2rem; align-items:center; margin: 4rem auto; box-sizing:border-box; max-width: 75%">
    <div style="margin-bottom:32px;">
        <img src="https://betterproposals.io/2/img/logos/bp-logo-dark.svg" alt="Better Proposals" style="width:180px;" />
    </div>
    <div style="font-family: 'neue-haas-grotesk-display', -apple-system, system-ui, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif; color:#5C5C5C; font-size:2rem; font-weight:500; letter-spacing: 0.03rem; line-height:1.3; margin-bottom:-1rem;">Login cancelled</div>
    <div style="font-family: 'neue-haas-grotesk-display', -apple-system, system-ui, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif; color:#5C5C5C; font-size:1rem; font-weight:500; letter-spacing: 0.03rem; line-height:1.3; margin-bottom:0;">No problem. You can close this tab and re-run the CLI command whenever you're ready.</div>
</div>

</body>
</html>`;

/**
 * Browser-based login handshake.
 *
 * Flow:
 *   1. Spin up a one-shot local HTTP server on a free port.
 *   2. Open the user's browser to the BP login page, passing the port
 *      and a random `state` value for CSRF protection.
 *   3. The web app authenticates the user and redirects the browser to
 *      http://localhost:<port>/callback?token=...&state=...
 *   4. We verify `state`, capture the token, render a success page,
 *      shut the server down cleanly, and persist the token to the OS
 *      keychain via Bun.secrets.
 */
export async function login() {
    // CSRF guard; a value only this process knows. The web app must
    // echo it back unchanged or we reject the callback.
    const state = crypto.randomUUID();

    // PKCE (Proof Key for Code Exchange):
    // Generate code_verifier (32 random bytes → base64url) and
    // code_challenge (base64url(SHA-256(verifier))). The verifier never
    // leaves this process; the challenge is sent to the server. Even if
    // the auth code is intercepted, it's useless without the verifier.
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const codeVerifier = btoa(String.fromCharCode(...verifierBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    // The callback request arrives on a different stack than this function,
    // so we bridge the two with a Promise that the fetch handler resolves
    // (or rejects) when /callback fires.
    let resolve, reject;
    const done = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    const server = Bun.serve({
        // port: 0 → let the OS assign a free ephemeral port. We read the
        // chosen port back from `server.port` after Bun.serve returns.
        port: 0,
        fetch(req) {
            const url = new URL(req.url);

            // The server only exists to receive a single callback; anything
            // else is either a stray probe or a misconfiguration.
            if (url.pathname !== '/callback') {
                return new Response('Not found', {status: 404});
            }

            const returnedState = url.searchParams.get('state');
            const code          = url.searchParams.get('code');
            const errorParam    = url.searchParams.get('error');

            // CSRF check first; applies to BOTH the success and the cancel
            // path, since both echo `state` back to us.
            if (returnedState !== state) {
                reject(new Error('State mismatch; possible CSRF attack'));
                return new Response('State mismatch.', {status: 400});
            }

            if (errorParam === 'access_denied') {
                resolve(null);
                return new Response(CANCELLED_HTML, {
                    headers: {'Content-Type': 'text/html', 'Connection': 'close'},
                });
            }

            if (errorParam === 'account_blocked') {
                reject(new Error('Your account has been restricted. Please contact support.'));
                return new Response(BLOCKED_HTML, {
                    status: 403,
                    headers: {'Content-Type': 'text/html', 'Connection': 'close'},
                });
            }

            if (!code) {
                reject(new Error('Missing code in callback'));
                return new Response('Missing code.', {status: 400});
            }

            resolve(code);

            return new Response(
                `<!DOCTYPE html>
                    <html lang="en">
                    <head>
                    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no">
                    <title>Authenticated - Better Proposals</title>
                    <link rel="preconnect" href="https://use.typekit.net">
                    <link rel="stylesheet" href="https://use.typekit.net/uci0kgk.css">
                    </head>
                    <body style="margin:0; padding:0; background:#fafafa; font-family: -apple-system, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif;">
                    <div style="display:flex; flex-direction:column; gap:2rem; align-items:center; margin:4rem auto; box-sizing:border-box; max-width:75%">
                        <div style="margin-bottom:32px;">
                            <img src="https://betterproposals.io/2/img/logos/bp-logo-dark.svg" alt="Better Proposals" style="width:180px;" />
                        </div>
                        <div style="font-family:'neue-haas-grotesk-display',-apple-system,system-ui,BlinkMacSystemFont,Helvetica,Lato,'Lucida Grande',sans-serif; color:#5C5C5C; font-size:2rem; font-weight:500; letter-spacing:0.03rem; line-height:1.3; margin-bottom:-1rem;">You're logged in!</div>
                        <div style="font-family:'neue-haas-grotesk-display',-apple-system,system-ui,BlinkMacSystemFont,Helvetica,Lato,'Lucida Grande',sans-serif; color:#5C5C5C; font-size:1rem; font-weight:500; letter-spacing:0.03rem; line-height:1.3;">You've successfully authenticated with the Better Proposals CLI. You can close this tab and return to your terminal.</div>
                    </div>
                    </body>
                    </html>`,
                {headers: {'Content-Type': 'text/html', 'Connection': 'close'}}
            );
        },
    });

    // Bun assigned a real port now that the listener is bound. Build the
    // login URL the browser will visit.
    const port = server.port;
    const loginUrl = `${LOGIN_BASE}?port=${port}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    console.log('Opening browser for authentication…');
    await open(loginUrl);

    let code;
    try {
        code = await done;
    } finally {
        await server.stop();
    }

    if (code === null) {
        console.log('Login cancelled.');
        return;
    }

    // Exchange the auth code for tokens via a direct POST (no browser, no URLs, no history).
    const form = new URLSearchParams();
    form.set('code', code);
    form.set('code_verifier', codeVerifier);

    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: form.toString(),
    });

    if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data.access_token || !data.refresh_token) {
        throw new Error('Invalid token response from server');
    }

    await secretsSet(JSON.stringify({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
    }));
    console.log('Login successful!');
}

async function getCredentials() {
    const raw = await secretsGet();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function refreshTokens(creds, retryOnce = true) {
    const form = new URLSearchParams();
    form.set('refresh_token', creds.refresh_token);

    const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: form.toString(),
    });

    if (response.ok) {
        const data = await response.json();
        const newCreds = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
        };
        await secretsSet(JSON.stringify(newCreds));
        return newCreds.access_token;
    }

    if (response.status === 401) {
        throw new Error('Session expired. Please run `betterproposals login` again.');
    }

    if (response.status === 400 || response.status === 405) {
        console.error(`Token refresh failed with status ${response.status}. This is a CLI bug.`);
        process.exit(1);
    }

    if (response.status === 500) {
        if (retryOnce) return refreshTokens(creds, false);
        throw new Error('Server error during token refresh. Please try again later.');
    }

    throw new Error(`Unexpected token refresh error: ${response.status}`);
}

// Server-side override: when a caller (e.g. the PHP web agent) passes a
// --token value, we skip local keychain/file lookup entirely.
let overrideToken = null;
export function setOverrideToken(token) {
    overrideToken = token || null;
}

export async function getAccessToken() {
    if (overrideToken) return overrideToken;
    const creds = await getCredentials();
    if (!creds) throw new Error('Not authenticated. Run `betterproposals login` first.');
    return creds.access_token;
}

export async function refreshAccessToken() {
    if (overrideToken) {
        // In server-side token mode, refresh is the caller's responsibility
        // (PHP rotates the CLI_User_Tokens row and passes a fresh token).
        throw new Error('Token expired. The caller must re-issue a token.');
    }
    const creds = await getCredentials();
    if (!creds) throw new Error('Not authenticated. Run `betterproposals login` first.');
    return refreshTokens(creds);
}

export async function logout() {
    await secretsDelete();
    console.log('Logged out.');
}
