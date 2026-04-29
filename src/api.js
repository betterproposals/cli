import { getToken } from './auth.js';

const BASE_URL = 'https://localapi.betterproposals'; // TODO: Replace with production URL
const IS_LOCAL = BASE_URL.includes('localapi.');

async function request(path, params = {}) {
    const token = await getToken();
    if (!token) {
        throw new Error('Not authenticated. Run `betterproposals login` first.');
    }

    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
        headers: { Bptoken: token },
        tls: IS_LOCAL ? { rejectUnauthorized: false } : undefined,
    });

    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return response.json();
}

export const documents = {
    list({ page = 1, perPage = 10, type } = {}) {
        return request('/proposal/', { page, per_page: perPage, type });
    },
};
