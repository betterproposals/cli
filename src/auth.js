import open from 'open';

// Identifies our credential entry in the OS keychain (macOS Keychain,
// Windows Credential Manager, libsecret on Linux). The (service, name)
// pair is the lookup key.
const SERVICE = 'betterproposals-cli';
const NAME = 'betterproposals-token';

// Web endpoint that issues a CLI token for the signed-in user and
// redirects back to our local callback.
const LOGIN_BASE = 'https://cli.dev.betterproposals.io/2/cli/login'; //TODO: Replace with production URL

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
            const token = url.searchParams.get('token');
            const errorParam = url.searchParams.get('error');

            // CSRF check first; applies to BOTH the success and the cancel
            // path, since both echo `state` back to us.
            if (returnedState !== state) {
                reject(new Error('State mismatch; possible CSRF attack'));
                return new Response('State mismatch.', {status: 400});
            }

            // User clicked "Cancel" on the BP login page. The web app
            // redirects here with `?error=access_denied` so the CLI doesn't
            // hang forever waiting on a callback that will never come.
            // Resolve with `null` to signal cancellation; login() handles
            // the no-token case cleanly without throwing.
            if (errorParam === 'access_denied') {
                resolve(null);
                return new Response(CANCELLED_HTML, {
                    headers: {'Content-Type': 'text/html', 'Connection': 'close'},
                });
            }

            if (!token) {
                reject(new Error('No token received from server'));
                return new Response('No token received.', {status: 400});
            }

            // Hand the token off to the awaiting login() body. The Response
            // returned below is what the user actually sees in the browser.
            resolve(token);

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

    let token;
    try {
        // Suspend until /callback fires (or the handler rejects on bad input).
        // `token` is null if the user clicked Cancel on the BP login page.
        token = await done;
    } finally {
        // Graceful stop: stops accepting new connections and resolves only
        // once active ones have drained.
        await server.stop();
    }

    // Cancellation path: nothing to store, nothing went wrong. Exit quietly.
    if (token === null) {
        console.log('Login cancelled.');
        return;
    }

    // Persist to the OS keychain. Subsequent CLI commands will read this back
    // via getToken() instead of re-running the browser flow.
    await Bun.secrets.set({service: SERVICE, name: NAME, value: token});
    console.log('Login successful!');
    console.log('Token:', token); //TODO: Remove this, only for debugging
}

/**
 * Read the stored CLI token, or `null` if the user has never logged in.
 */
export async function getToken() {
    return Bun.secrets.get({service: SERVICE, name: NAME});
}

/**
 * Remove the stored token from the OS keychain. The next command that
 * needs auth will have to trigger login() again.
 */
export async function logout() {
    await Bun.secrets.delete({service: SERVICE, name: NAME});
    console.log('Logged out.');
}
