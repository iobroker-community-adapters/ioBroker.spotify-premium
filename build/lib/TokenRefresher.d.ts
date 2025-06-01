export interface AccessTokens {
    access_token: string;
    expires_in: number;
    access_token_expires_on: string;
    ext_expires_in: number;
    token_type: 'Bearer';
    scope: string;
    refresh_token: string;
}
export declare class TokenRefresher {
    private readonly adapter;
    private readonly stateName;
    private refreshTokenTimeout;
    private accessToken;
    private readonly url;
    private readonly readyPromise;
    private readonly name;
    constructor(adapter: ioBroker.Adapter, serviceName: string, stateName?: string);
    destroy(): void;
    onStateChange(id: string, state: ioBroker.State | null | undefined): void;
    getAccessToken(): Promise<string | undefined>;
    private refreshTokens;
}
