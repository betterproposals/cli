import open from 'open';

const SERVICE = 'betterproposals-cli';
const NAME = 'betterproposals-token';

//const LOGIN_BASE = 'https://cli.dev.betterproposals.io/2/cli/login';
//const REFRESH_URL = 'https://cli.dev.betterproposals.io/2/cli/refresh';
const LOGIN_BASE = 'https://localdev.betterproposals/2/cli/login';
const REFRESH_URL = 'https://localdev.betterproposals/2/cli/refresh';

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
            const accessToken = url.searchParams.get('access_token');
            const refreshToken = url.searchParams.get('refresh_token');
            const errorParam = url.searchParams.get('error');

            // CSRF check first; applies to BOTH the success and the cancel
            // path, since both echo `state` back to us.
            if (returnedState !== state) {
                reject(new Error('State mismatch; possible CSRF attack'));
                return new Response('State mismatch.', {status: 400});
            }

            // User clicked "Cancel" on the BP login page.
            if (errorParam === 'access_denied') {
                resolve(null);
                return new Response(CANCELLED_HTML, {
                    headers: {'Content-Type': 'text/html', 'Connection': 'close'},
                });
            }

            if (!accessToken || !refreshToken) {
                reject(new Error('Missing access_token or refresh_token in callback'));
                return new Response('Missing tokens.', {status: 400});
            }

            resolve({ access_token: accessToken, refresh_token: refreshToken });

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
                
                <div style="display:flex; flex-direction: column; gap: 2rem; align-items:center; margin: 4rem auto; box-sizing:border-box; max-width: 75%">
                    <div style="margin-bottom:32px;">
                        <img src="https://betterproposals.io/2/img/logos/bp-logo-dark.svg" alt="Better Proposals" style="width:180px;" />
                    </div>
                    <div style="font-family: 'neue-haas-grotesk-display', -apple-system, system-ui, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif; color:#5C5C5C; font-size:2rem; font-weight:500; letter-spacing: 0.03rem; line-height:1.3; margin-bottom:-1rem;">You're logged in!</div>
                    <div style="font-family: 'neue-haas-grotesk-display', -apple-system, system-ui, BlinkMacSystemFont, Helvetica, Lato, 'Lucida Grande', sans-serif; color:#5C5C5C; font-size:1rem; font-weight:500; letter-spacing: 0.03rem; line-height:1.3; margin-bottom:0;">You've successfully authenticated with the Better Proposals CLI. You can close this tab and return to your terminal.</div>
                </div>
                
                </body>
                </html>`,
                // `Connection: close` tells the browser not to keep the
                // socket alive after this response; important because we're
                // about to shut the server down and don't want lingering
                // keep-alive sockets to drain.
                {headers: {'Content-Type': 'text/html', 'Connection': 'close'}}
            );
        },
    });

    // Bun assigned a real port now that the listener is bound. Build the
    // login URL the browser will visit.
    const port = server.port;
    const loginUrl = `${LOGIN_BASE}?port=${port}&state=${state}`;

    console.log('Opening browser for authentication…');
    await open(loginUrl);

    let result;
    try {
        result = await done;
    } finally {
        await server.stop();
    }

    if (result === null) {
        console.log('Login cancelled.');
        return;
    }

    const creds = {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
    };
    await Bun.secrets.set({service: SERVICE, name: NAME, value: JSON.stringify(creds)});
    console.log('Login successful!');
}

async function getCredentials() {
    const raw = await Bun.secrets.get({service: SERVICE, name: NAME});
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function refreshTokens(creds, retryOnce = true) {
    const form = new URLSearchParams();
    form.set('refresh_token', creds.refresh_token);

    const host = new URL(REFRESH_URL).hostname;
    const tlsOpts = (host.endsWith('.betterproposals') || host === 'localhost')
        ? { tls: { rejectUnauthorized: false } } : {};

    const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: form.toString(),
        ...tlsOpts,
    });

    if (response.ok) {
        const data = await response.json();
        const newCreds = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
        };
        await Bun.secrets.set({service: SERVICE, name: NAME, value: JSON.stringify(newCreds)});
        return newCreds.access_token;
    }

    if (response.status === 401) {
        throw new Error('Session expired. Please run `bp login` again.');
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

export async function getAccessToken() {
    const creds = await getCredentials();
    if (!creds) throw new Error('Not authenticated. Run `bp login` first.');
    return creds.access_token;
}

export async function refreshAccessToken() {
    const creds = await getCredentials();
    if (!creds) throw new Error('Not authenticated. Run `bp login` first.');
    return refreshTokens(creds);
}

export async function logout() {
    await Bun.secrets.delete({service: SERVICE, name: NAME});
    console.log('Logged out.');
}
