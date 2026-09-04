export interface ApiClientOptions {
    baseUrl: string;
    getAccessToken: () => string | undefined;
}

export const createApiClient = ({ baseUrl, getAccessToken }: ApiClientOptions) => ({
    async request<T>(path: string, init?: RequestInit): Promise<T> {
        const token = getAccessToken();
        const response = await fetch(`${baseUrl}${path}`, {
            ...init,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
        });
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        return response.json() as Promise<T>;
    },
});