import { getAccessToken, refreshAccessToken } from './auth.js';

// const BASE_URL = 'https://cli-api.staging.betterproposals.io'; // TODO: Replace with production URL
const BASE_URL = 'https://localapi.betterproposals:444'; // TODO: Replace with production URL

function fetchOptions(url, options) {
    const host = new URL(url).hostname;
    if (host.endsWith('.betterproposals') || host === 'localhost') {
        options.tls = { rejectUnauthorized: false };
    }
    return options;
}

async function request(method, path, { params = {}, body } = {}, retry = true) {
    const token = await getAccessToken();

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

    const response = await fetch(url.toString(), fetchOptions(url.toString(), options));

    if (response.status === 401 && retry) {
        await refreshAccessToken();
        return request(method, path, { params, body }, false);
    }

    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.status === 'error') {
        throw new Error(data.message);
    }

    return data;
}

export const settings = {
    get() {
        return request('GET', '/settings');
    },

    brand() {
        return request('GET', '/settings/brand');
    },

    mergeTags({ page = 1, perPage = 10 } = {}) {
        return request('GET', '/settings/merge_tag', { params: { page, per_page: perPage } });
    },
};

export const currencies = {
    list({ page = 1, perPage = 10 } = {}) {
        return request('GET', '/currency', { params: { page, per_page: perPage } });
    },

    get(id) {
        return request('GET', `/currency/${id}`);
    },
};

export const companies = {
    list({ page = 1, perPage = 10 } = {}) {
        return request('GET', '/company', { params: { page, per_page: perPage } });
    },

    get(id) {
        return request('GET', `/company/${id}`);
    },

    create({ companyName } = {}) {
        return request('POST', '/company/create', {
            body: { CompanyName: companyName },
        });
    },
};

export const documentTypes = {
    list({ page = 1, perPage = 10 } = {}) {
        return request('GET', '/doctype', { params: { page, per_page: perPage } });
    },

    create({ typeName, typeColour } = {}) {
        return request('POST', '/doctype/create', {
            body: { TypeName: typeName, TypeColour: typeColour },
        });
    },
};

export const templates = {
    list({ page = 1, perPage = 10 } = {}) {
        return request('GET', '/template', { params: { page, per_page: perPage } });
    },

    get(id) {
        return request('GET', `/template/${id}`);
    },
};

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

    listSent({ page = 1, perPage = 10, type } = {}) {
        return request('GET', '/proposal/sent', { params: { page, per_page: perPage, type } });
    },

    listSigned({ page = 1, perPage = 10, type } = {}) {
        return request('GET', '/proposal/signed', { params: { page, per_page: perPage, type } });
    },

    listPaid({ page = 1, perPage = 10, type } = {}) {
        return request('GET', '/proposal/paid', { params: { page, per_page: perPage, type } });
    },

    get(id) {
        return request('GET', `/proposal/${id}`);
    },

    count() {
        return request('GET', '/proposal/count');
    },

    createCover({ brandId, coverName, bgColour, headline, subheader, textColour, textAlign, buttonStyle, buttonText } = {}) {
        return request('POST', '/proposal/cover/create', {
            body: {
                BrandID: brandId,
                CoverName: coverName,
                BGColour: bgColour,
                Headline: headline,
                Subheader: subheader,
                TextColour: textColour,
                TextAlign: textAlign,
                ButtonStyle: buttonStyle,
                ButtonText: buttonText,
            },
        });
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
