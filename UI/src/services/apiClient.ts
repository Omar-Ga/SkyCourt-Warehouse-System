

// Define a custom error class for API errors
export class ApiError extends Error {
    status: number;
    data: any;

    constructor(message: string, status: number, data?: any) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

// Base configuration
// You can override this with an environment variable VITE_API_URL
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

type RequestOptions = RequestInit & {
    headers?: Record<string, string>;
};

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { headers, ...rest } = options;

    const config: RequestInit = {
        ...rest,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    };

    // Ensure endpoint starts with / if not present (optional safety)
    const url = `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const response = await fetch(url, config);

    if (!response.ok) {
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        let errorData = null;

        try {
            const errorBody = await response.json();
            errorData = errorBody;
            // Try to extract a meaningful message from common backend error formats
            if (errorBody.message) {
                errorMessage = errorBody.message;
            } else if (errorBody.error) {
                errorMessage = typeof errorBody.error === 'string' ? errorBody.error : JSON.stringify(errorBody.error);
            } else if (errorBody.detail) {
                errorMessage = errorBody.detail;
            }
        } catch (e) {
            // If response is not JSON, try text
            try {
                const text = await response.text();
                if (text) errorMessage = text;
            } catch (textError) {
                // Ignore text error
            }
        }

        throw new ApiError(errorMessage, response.status, errorData);
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return {} as T;
    }

    try {
        return await response.json();
    } catch (error) {
        // If we expect JSON but get something else (and it was OK), generic error or return text?
        // For this strict wrapper, we assume JSON.
        throw new Error('Invalid JSON response from server');
    }
}

export const apiClient = {
    get: <T>(endpoint: string, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'GET' }),

    post: <T>(endpoint: string, body: any, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),

    put: <T>(endpoint: string, body: any, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),

    patch: <T>(endpoint: string, body: any, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),

    delete: <T>(endpoint: string, options?: RequestOptions) =>
        request<T>(endpoint, { ...options, method: 'DELETE' }),
};
