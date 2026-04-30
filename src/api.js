import { getToken } from './auth.js';

const BASE_URL = 'https://cli-api.staging.betterproposals.io'; // TODO: Replace with production URL

async function request(method, path, { params = {}, body } = {}) {
    const token = await getToken();
    if (!token) {
        throw new Error('Not authenticated. Run `betterproposals login` first.');
    }

    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
    }

    const options = {
        method,
        headers: { Bptoken: token },
    };

    if (body) {
        const form = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
            if (value !== undefined) form.set(key, value);
        }
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.body = form.toString();
    }

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.status === 'error') {
        throw new Error(data.message);
    }

    return data;
}

export const documents = {
    list({ page = 1, perPage = 10, type } = {}) {
        return request('GET', '/proposal/', { params: { page, per_page: perPage, type } });
    },

    listNew({ page = 1, perPage = 10, type } = {}) {
        return request('GET', '/proposal/new', { params: { page, per_page: perPage, type } });
    },

    listOpened({ page = 1, perPage = 10, type } = {}) {
        return request('GET', '/proposal/opened', { params: { page, per_page: perPage, type } });
    },

    create({ company, cover, template, documentType, brand, currency, tax, taxLabel, taxAmount, contacts, mergeTags } = {}) {
        return request('POST', '/proposal/create', {
            body: {
                Company: company,
                Cover: cover,
                Template: template,
                DocumentType: documentType,
                Brand: brand,
                Currency: currency,
                Tax: tax,
                TaxLabel: taxLabel,
                TaxAmount: taxAmount,
                Contacts: contacts,
                MergeTags: mergeTags,
            },
        });
    },
};
