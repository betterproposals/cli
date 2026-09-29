import { getAccessToken, refreshAccessToken, onIdentityChange } from './auth.js';
import { assertParamLengths, readLimitsCache, writeLimitsCache, DEFAULT_LIMITS } from './limits.js';

const BASE_URL = 'https://api.betterproposals.io';

async function request(method, path, { params = {}, body, skipLimitCheck = false } = {}, retry = true) {
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
        // Single choke point for every write in the CLI: check the per-parameter
        // byte budget here rather than in each handler, so current and future
        // write tools are covered without repeating themselves.
        if (!skipLimitCheck) assertParamLengths(body, await getLimits());

        const form = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
            if (value !== undefined) form.set(key, value);
        }
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.body = form.toString();
    }

    const response = await fetch(url.toString(), options);

    if (response.status === 401 && retry) {
        await refreshAccessToken();
        return request(method, path, { params, body, skipLimitCheck }, false);
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

// Memoised for the life of the process. The authoritative value comes from a
// live call rather than the disk cache, because the limit is per-account and a
// single process may be driving a different account than the last one did
// (setOverrideToken, or a re-login). The disk cache is a warm start for the
// advisory prose in limits.js, not the basis for rejecting a request.
let limitsPromise = null;

/**
 * The parameter limits in force for the authenticated account.
 *
 * Never throws and never blocks a real operation: an API too old to serve
 * /settings/limits, a network failure, or an expired session all fall back to
 * the conservative default. Being wrong here costs an extra round trip and a
 * server-side 400; throwing here would break every write.
 */
export function getLimits() {
    if (limitsPromise) return limitsPromise;

    limitsPromise = (async () => {
        try {
            const response = await settings.limits();
            const limits = { ...DEFAULT_LIMITS, ...response.data, source: 'api' };
            writeLimitsCache(limits);
            return limits;
        } catch {
            return readLimitsCache() ?? { ...DEFAULT_LIMITS };
        }
    })();

    return limitsPromise;
}

// The override token swaps the acting account mid-process (the PHP web agent
// passes one per invocation), which invalidates anything we resolved for the
// previous one.
export function resetLimits() {
    limitsPromise = null;
}

onIdentityChange(resetLimits);

export const settings = {
    get() {
        return request('GET', '/settings');
    },

    // skipLimitCheck guards against recursion: getLimits() calls this, and the
    // check inside request() calls getLimits(). It is a GET with no body, so
    // the check would never fire anyway — but the guard makes that explicit.
    limits() {
        return request('GET', '/settings/limits', { skipLimitCheck: true });
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

    edit({ id, company, cover, documentType, brand, currency, tax, taxLabel, taxAmount, description, contacts, mergeTags } = {}) {
        return request('POST', '/proposal/edit', {
            body: {
                ID: id,
                Company: company,
                Cover: cover,
                DocumentType: documentType,
                Brand: brand,
                Currency: currency,
                Tax: tax,
                TaxLabel: taxLabel,
                TaxAmount: taxAmount,
                Description: description,
                Contacts: contacts,
                MergeTags: mergeTags,
            },
        });
    },

    editCover({ id, brandId, coverName, bgColour, headline, subheader, textColour, textAlign, buttonStyle, buttonText } = {}) {
        return request('POST', '/proposal/cover/edit', {
            body: {
                ID: id,
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

    populate({ id, sections } = {}) {
        return request('POST', '/proposal/populate', {
            body: {
                ID: id,
                Sections: sections,
            },
        });
    },

    send({ id, subject, message, recipients, signOrder, password, justLinkGeneration } = {}) {
        return request('POST', '/proposal/send', {
            body: {
                ID: id,
                Subject: subject,
                Message: message,
                Recipients: recipients,
                SignOrder: signOrder,
                Password: password,
                JustLinkGeneration: justLinkGeneration,
            },
        });
    },

    // Single block versions of populate(): one block of one type per request,
    // released one type at a time (see DISABLED_TOOLS in tools.js)
    block(type, { id, section, position, ...fields } = {}) {
        return request('POST', `/proposal/block/${type}`, {
            body: {
                ID: id,
                Section: section,
                Position: position,
                ...fields,
            },
        });
    },

    // Link generation only version of send()
    links({ id, recipients, signOrder, password } = {}) {
        return request('POST', '/proposal/links', {
            body: {
                ID: id,
                Recipients: recipients,
                SignOrder: signOrder,
                Password: password,
            },
        });
    },
};
