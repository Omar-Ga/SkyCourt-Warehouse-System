// Define a custom error class for API errors
export class ApiError extends Error {
    status: number;
    data: any;
    code?: string;

    constructor(message: string, status: number, data?: any, code?: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
        this.code = code || (data && typeof data === 'object' ? data.code : undefined);
    }
}

// Base configuration
// You can override this with an environment variable VITE_API_URL
const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '/api';

export type RequestOptions = RequestInit & {
    headers?: Record<string, string>;
    skipCsrf?: boolean;
    skipAuthHandling?: boolean;
};

export function generateIdempotencyKey(): string {
    return crypto.randomUUID();
}

// CSRF Token Management
let currentCsrfToken: string | null = null;
let pendingCsrfPromise: Promise<string> | null = null;

// Session Tracking & Late Response Protection
let sessionEpoch = 0;
let sessionAbortController = new AbortController();

// Global 401 Unauthorized Handler
type UnauthorizedHandler = (error: ApiError) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

async function fetchCsrfToken(): Promise<string> {
    if (currentCsrfToken) return currentCsrfToken;
    if (pendingCsrfPromise) return pendingCsrfPromise;

    pendingCsrfPromise = (async () => {
        try {
            const url = `${BASE_URL}/auth/csrf`;
            const res = await fetch(url, {
                method: 'GET',
                credentials: 'same-origin',
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.csrf_token) {
                    currentCsrfToken = data.csrf_token;
                    return data.csrf_token;
                }
            }
        } catch (err) {
            console.warn('Failed to fetch CSRF token:', err);
        } finally {
            pendingCsrfPromise = null;
        }
        return '';
    })();

    return pendingCsrfPromise;
}

async function fetchWithProtection(endpoint: string, options: RequestOptions = {}): Promise<Response> {
    const thisEpoch = sessionEpoch;
    const method = (options.method || 'GET').toUpperCase();
    const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const headers: Record<string, string> = { ...options.headers };

    // Automatically attach CSRF token to state-changing requests
    if (isStateChanging && !options.skipCsrf) {
        if (!currentCsrfToken) {
            await fetchCsrfToken();
        }
        if (currentCsrfToken) {
            headers['X-CSRF-Token'] = currentCsrfToken;
        }
    }

    // Clean path for route matching (ignoring query strings and trailing slashes)
    const cleanEndpoint = endpoint.startsWith(BASE_URL)
        ? endpoint.slice(BASE_URL.length)
        : endpoint;
    const rawPath = cleanEndpoint.split('?')[0].replace(/\/+$/, '');
    const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const isItemCreate = method === 'POST' && cleanPath === '/items';
    const isStockAdjust = method === 'POST' && /^\/items\/\d+\/adjust$/.test(cleanPath);
    const isLeaveOrderCreate = method === 'POST' && cleanPath === '/leave-orders';
    const isLeaveOrderClose = method === 'POST' && /^\/leave-orders\/\d+\/close$/.test(cleanPath);
    const isTicketClose = method === 'POST' && /^\/tickets\/\d+\/close$/.test(cleanPath);
    const isTicketReturn = method === 'POST' && (/^\/tickets\/\d+\/return$/.test(cleanPath) || /^\/leave-orders\/\d+\/return$/.test(cleanPath));

    // Automatically attach Idempotency-Key for first-party creation, adjustment, closure, and return requests
    if ((isItemCreate || isStockAdjust || isLeaveOrderCreate || isLeaveOrderClose || isTicketClose || isTicketReturn) && !headers['Idempotency-Key']) {
        headers['Idempotency-Key'] = generateIdempotencyKey();
    }

    // Combine caller signal with session abort signal
    const callerSignal = options.signal;
    const effectiveSignal = callerSignal
        ? AbortSignal.any([sessionAbortController.signal, callerSignal])
        : sessionAbortController.signal;

    const url = `${BASE_URL}${cleanEndpoint.startsWith('/') ? '' : '/'}${cleanEndpoint}`;

    const config: RequestInit = {
        ...options,
        method,
        headers,
        credentials: 'same-origin',
        signal: effectiveSignal,
    };

    effectiveSignal.throwIfAborted();

    let response: Response;
    try {
        response = await fetch(url, config);
    } catch (err: any) {
        // If aborted because of session reset
        if (sessionEpoch !== thisEpoch) {
            throw new ApiError('انتهت صلاحية الجلسة.', 401, null, 'SESSION_ABORTED');
        }
        throw err;
    }

    // Late-response check: if session changed during network round-trip, discard response!
    if (sessionEpoch !== thisEpoch) {
        throw new ApiError('انتهت صلاحية الجلسة.', 401, null, 'SESSION_ABORTED');
    }

    if (!response.ok) {
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        let errorData: any = null;
        let errorCode: string | undefined = undefined;

        try {
            const errorBody = await response.json();
            errorData = errorBody;
            if (errorBody.message) {
                errorMessage = errorBody.message;
            } else if (errorBody.error) {
                errorMessage = typeof errorBody.error === 'string' ? errorBody.error : JSON.stringify(errorBody.error);
            } else if (errorBody.detail) {
                errorMessage = errorBody.detail;
            }
            if (errorBody.code) {
                errorCode = errorBody.code;
            }
        } catch {
            try {
                const text = await response.text();
                if (text) errorMessage = text;
            } catch {
                // Ignore text error
            }
        }

        const apiError = new ApiError(errorMessage, response.status, errorData, errorCode);

        // Global 401 Unauthorized handling
        if (response.status === 401 && !options.skipAuthHandling) {
            const isLoginRoute = endpoint.includes('/auth/login');
            if (!isLoginRoute && unauthorizedHandler) {
                unauthorizedHandler(apiError);
            }
        }

        throw apiError;
    }

    return response;
}

function serializeBody(body: any): BodyInit | undefined {
    if (body === undefined) return undefined;
    if (typeof body === 'string') return body;
    if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return body;
    return JSON.stringify(body);
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { headers = {}, body, method = 'GET', ...rest } = options;
    const requestHeaders: Record<string, string> = { ...headers };

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (!isFormData && !requestHeaders['Content-Type'] && method !== 'GET' && body !== undefined) {
        requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetchWithProtection(endpoint, {
        ...rest,
        method,
        headers: requestHeaders,
        body,
    });

    // Handle 204 No Content
    if (response.status === 204) {
        return {} as T;
    }

    try {
        return await response.json();
    } catch {
        throw new Error('Invalid JSON response from server');
    }
}

async function requestBlob(endpoint: string, options: RequestOptions = {}): Promise<Blob> {
    const response = await fetchWithProtection(endpoint, options);
    return await response.blob();
}

async function requestText(endpoint: string, options: RequestOptions = {}): Promise<string> {
    const response = await fetchWithProtection(endpoint, options);
    return await response.text();
}

export const apiClient = {
    get: <T>(endpoint: string, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'GET' }),

    post: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
        request<T>(endpoint, {
            ...options,
            method: 'POST',
            body: serializeBody(body),
        }),

    put: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
        request<T>(endpoint, {
            ...options,
            method: 'PUT',
            body: serializeBody(body),
        }),

    patch: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
        request<T>(endpoint, {
            ...options,
            method: 'PATCH',
            body: serializeBody(body),
        }),

    delete: <T>(endpoint: string, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'DELETE' }),

    getBlob: (endpoint: string, options?: RequestOptions) =>
        requestBlob(endpoint, { ...options, method: 'GET' }),

    getText: (endpoint: string, options?: RequestOptions) =>
        requestText(endpoint, { ...options, method: 'GET' }),

    setCsrfToken: (token: string | null) => {
        currentCsrfToken = token;
    },

    getCsrfToken: () => currentCsrfToken,

    refreshCsrfToken: () => {
        currentCsrfToken = null;
        return fetchCsrfToken();
    },

    startSession: (newCsrfToken?: string) => {
        sessionAbortController.abort();
        sessionEpoch++;
        sessionAbortController = new AbortController();
        if (newCsrfToken) {
            currentCsrfToken = newCsrfToken;
        }
    },

    resetSession: () => {
        sessionAbortController.abort();
        sessionEpoch++;
        sessionAbortController = new AbortController();
        currentCsrfToken = null;
        pendingCsrfPromise = null;
    },

    setOnUnauthorized: (handler: UnauthorizedHandler | null) => {
        unauthorizedHandler = handler;
    },
};
