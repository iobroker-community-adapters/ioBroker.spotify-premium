import http from 'node:http';
import url from 'node:url';

import axios from 'axios';
import { lookup } from 'dns-lookup-cache';
import querystring from 'node:querystring';
import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';

import type { SpotifyPremiumAdapterConfig } from './types';
import * as cache from './lib/cache';
import { isEmpty, removeNameSpace } from './lib/utils';

type TokenObject = {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    expiresInSec: number;
    expiresAtMs: number;
};

// Request queue to prevent rate limiting (429 errors)
class RequestQueue {
    private queue: { fn: () => Promise<any>; resolve: (result: any) => void; reject: (error: Error) => void }[] = [];
    private isProcessing = false;
    private minDelayMs = 2500; // Minimum delay between requests in milliseconds (~0.4 req/sec = ~24 req/min, ultra-conservative for Spotify)

    add(fn: () => Promise<any>): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    process(): void {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        const item = this.queue.shift();
        const { fn, resolve, reject } = item!;

        fn()
            .then(result => {
                resolve(result);
                // Small delay to prevent rate limiting
                setTimeout(() => {
                    this.isProcessing = false;
                    this.process();
                }, this.minDelayMs);
            })
            .catch(error => {
                reject(error);
                // Small delay even on error to prevent rate limiting
                setTimeout(() => {
                    this.isProcessing = false;
                    this.process();
                }, this.minDelayMs);
            });
    }
}

const TOKEN_REFRESH_SKEW_MS = 10 * 60 * 1000; // Refresh 10 minutes before expiry
const TOKEN_REFRESH_MIN_DELAY_MS = 30 * 1000; // Avoid immediate refresh loops
const TOKEN_REFRESH_RETRY_DELAY_MS = 60 * 1000; // Retry quickly on transient network failures

function getErrorMessage(error: any): string {
    if (!error) {
        return '';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error.message) {
        return error.message;
    }
    return `${error}`;
}

function isTransientNetworkError(error: any): boolean {
    if (!error) {
        return false;
    }

    const code = error.code || error.cause?.code;
    const message = getErrorMessage(error).toUpperCase();
    const transientCodes = new Set([
        'EAI_AGAIN',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'ENETUNREACH',
    ]);

    if (code && transientCodes.has(code)) {
        return true;
    }

    return (
        message.includes('EAI_AGAIN') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('ENOTFOUND') ||
        message.includes('EHOSTUNREACH') ||
        message.includes('ENETUNREACH') ||
        message.includes('SOCKET HANG UP') ||
        message.includes('TIMEOUT')
    );
}

export class SpotifyPremiumAdapter extends Adapter {
    declare config: SpotifyPremiumAdapterConfig;
    private readonly application: {
        userId: string;
        baseUrl: string;
        clientId: string;
        clientSecret: string;
        deleteDevices: boolean;
        deletePlaylists: boolean;
        keepShuffleState: boolean;
        redirect_uri: string;
        token: string;
        refreshToken: string;
        code: string;
        statusInternalTimer: ReturnType<typeof setTimeout> | undefined;
        statusPollingHandle: ReturnType<typeof setTimeout> | undefined;
        statusPollingDelaySeconds: number;
        devicePollingHandle: ReturnType<typeof setTimeout> | undefined;
        deviceInternalTimer: ReturnType<typeof setTimeout> | undefined;
        devicePollingDelaySeconds: number;
        playlistPollingHandle: ReturnType<typeof setTimeout> | undefined;
        playlistInternalTimer: ReturnType<typeof setTimeout> | undefined;
        playlistPollingDelaySeconds: number;
        error202shown: boolean;
        cacheClearHandle: ReturnType<typeof setTimeout> | undefined;
        callbackServer: http.Server | null;
        callbackPort: number;
        lastTrackId: string;
        lastPlaylistId: string;
        tokenRefreshTimer: ReturnType<typeof setTimeout> | undefined;
        tokenExpiresAtMs: number;
    } = {
        userId: '',
        baseUrl: 'https://api.spotify.com',
        clientId: '',
        clientSecret: '',
        deleteDevices: false,
        deletePlaylists: false,
        keepShuffleState: true,
        redirect_uri: '',
        token: '',
        refreshToken: '',
        code: '',
        statusInternalTimer: undefined,
        statusPollingHandle: undefined,
        statusPollingDelaySeconds: 10,
        devicePollingHandle: undefined,
        deviceInternalTimer: undefined,
        devicePollingDelaySeconds: 300,
        playlistPollingHandle: undefined,
        playlistInternalTimer: undefined,
        playlistPollingDelaySeconds: 1800,
        error202shown: false,
        cacheClearHandle: undefined,
        callbackServer: null,
        callbackPort: 80,
        lastTrackId: '',
        lastPlaylistId: '',
        tokenRefreshTimer: undefined,
        tokenExpiresAtMs: 0,
    };
    private artistImageUrlCache: Record<string, string> = {};
    private playlistCache: Record<
        string,
        {
            id: string;
            name: string;
            images: [{ url: string }];
            owner: { id: string };
            tracks: { total: string };
        }
    > = {};

    private readonly deviceData = {
        lastActiveDeviceId: '',
        lastSelectDeviceId: '',
    };
    private stopped = false;
    private tooManyRequests = false;
    private refreshTokenInFlight: Promise<TokenObject> | null = null;
    private requestQueue: RequestQueue = new RequestQueue();

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'spotify-premium',
            stateChange: (id: string, state: ioBroker.State | null | undefined) => cache.setExternal(id, state),
            objectChange: (id: string, obj: ioBroker.Object | null | undefined) =>
                cache.setExternalObj(id, obj as ioBroker.StateObject),
            ready: () => {
                cache.on(
                    'authorization.authorizationReturnUri',
                    (obj: any) => this.listenOnAuthorizationReturnUri(obj),
                    true,
                );
                cache.on('authorization.getAuthorization', () => this.listenOnGetAuthorization());
                cache.on('authorization.authorized', (obj: any) => this.listenOnAuthorized(obj));
                cache.on(/\.useForPlayback$/, (obj: any) => this.listenOnUseForPlayback(obj));
                cache.on(/\.trackList$/, (obj: any) => this.listenOnTrackList(obj), true);
                cache.on(/\.playThisList$/, (obj: any) => this.listenOnPlayThisList(obj));
                cache.on('devices.deviceList', (obj: any) => this.listenOnDeviceList(obj), true);
                cache.on('playlists.playlistList', (obj: any) => this.listenOnPlaylistList(obj), true);
                cache.on('player.play', () => this.listenOnPlay());
                cache.on('player.playUri', (obj: any) => this.listenOnPlayUri(obj));
                cache.on('player.pause', () => this.listenOnPause());
                cache.on('player.skipPlus', () => this.listenOnSkipPlus());
                cache.on('player.skipMinus', () => this.listenOnSkipMinus());
                cache.on('player.repeat', (obj: any) => this.listenOnRepeat(obj), true);
                cache.on('player.repeatTrack', () => this.listenOnRepeatTrack());
                cache.on('player.repeatContext', () => this.listenOnRepeatContext());
                cache.on('player.repeatOff', () => this.listenOnRepeatOff());
                cache.on('player.volume', (obj: any) => this.listenOnVolume(obj), true);
                cache.on('player.progressMs', (obj: any) => this.listenOnProgressMs(obj), true);
                cache.on('player.progressPercentage', (obj: any) => this.listenOnProgressPercentage(obj), true);
                cache.on('player.shuffle', (obj: any) => this.listenOnShuffle(obj), this.config.defaultShuffle || 'on');
                cache.on('player.shuffleOff', () => this.listenOnShuffleOff());
                cache.on('player.shuffleOn', () => this.listenOnShuffleOn());
                cache.on('player.trackId', (obj: any) => this.listenOnTrackId(obj), true);
                cache.on('player.playlist.id', (obj: any) => this.listenOnPlaylistId(obj), true);
                cache.on('player.playlist.owner', (obj: any) => this.listenOnPlaylistOwner(obj), true);
                cache.on('player.playlist.trackNo', (obj: any) => this.listenOnPlaylistTrackNo(obj), true);
                cache.on('getPlaylists', () => this.reloadUsersPlaylist());
                cache.on('getPlaybackInfo', () => this.listenOnGetPlaybackInfo());
                cache.on('getDevices', () => this.listenOnGetDevices());
                cache.on(['playlists.playlistList', 'playlists.playlistListIds', 'playlists.playlistListString'], () =>
                    this.listenOnHtmlPlaylists(),
                );
                cache.on(['player.playlist.trackList', 'player.playlist.trackListArray'], () =>
                    this.listenOnHtmlTracklist(),
                );
                cache.on(['devices.deviceList', 'devices.deviceListIds', 'devices.availableDeviceListString'], () =>
                    this.listenOnHtmlDevices(),
                );

                void cache.init().then(() => this.main());
            },
            unload: callback => {
                this.stopped = true;

                // Close the OAuth callback server
                if (this.application.callbackServer) {
                    this.application.callbackServer.close();
                    this.log.debug('OAuth callback server closed');
                }

                if (this.application.statusPollingHandle) {
                    clearTimeout(this.application.statusPollingHandle);
                }
                if (this.application.statusInternalTimer) {
                    clearTimeout(this.application.statusInternalTimer);
                }
                if (this.application.devicePollingHandle) {
                    clearTimeout(this.application.devicePollingHandle);
                }
                if (this.application.playlistPollingHandle) {
                    clearTimeout(this.application.playlistPollingHandle);
                }
                if (this.application.cacheClearHandle) {
                    clearTimeout(this.application.cacheClearHandle);
                }
                if (this.application.tokenRefreshTimer) {
                    clearTimeout(this.application.tokenRefreshTimer);
                }
                void Promise.all([
                    cache.setValue('authorization.authorizationUrl', ''),
                    cache.setValue('authorization.authorizationReturnUri', ''),
                    cache.setValue('authorization.userId', ''),
                    cache.setValue('player.trackId', ''),
                    cache.setValue('player.playlist.id', ''),
                    cache.setValue('player.playlist.trackNo', 0),
                    cache.setValue('player.playlist.owner', ''),
                    cache.setValue('authorization.authorized', false),
                    cache.setValue('info.connection', false),
                ]).then(() => {
                    callback();
                });
            },
        });
    }

    async request(options: any): Promise<any> {
        this.log.debug(`[HTTP Request] ${options.method} ${options.url}`);
        if (options.headers) {
            this.log.debug(`[HTTP Headers] ${JSON.stringify(options.headers)}`);
        }
        if (options.data) {
            this.log.debug(
                `[HTTP Data] ${typeof options.data === 'string' ? options.data : JSON.stringify(options.data)}`,
            );
        }

        try {
            const response = await axios(options);
            this.log.debug(`[HTTP Response] Status ${response.status} from ${options.method} ${options.url}`);
            if (response.data) {
                const dataStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                this.log.debug(`[HTTP Response Data] ${dataStr.substring(0, 500)}`);
            }
            return {
                status: response.status,
                statusCode: response.status,
                body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                data: response.data,
            };
        } catch (error) {
            this.log.error(`[HTTP Error] ${error.message} for ${options.method} ${options.url}`);
            if (error.response) {
                this.log.error(`[HTTP Error Status] ${error.response.status}`);
                this.log.error(
                    `[HTTP Error Data] ${typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)}`,
                );
            }
            throw error;
        }
    }

    main(): void {
        this.application.clientId = this.config.client_id;
        this.application.clientSecret = this.config.client_secret;
        this.application.redirect_uri ||= 'http://127.0.0.1:80';
        this.application.deleteDevices = this.config.delete_devices;
        this.application.deletePlaylists = this.config.delete_playlists;
        this.application.statusPollingDelaySeconds = parseInt(this.config.status_interval as string, 10);
        this.application.keepShuffleState = this.config.keep_shuffle_state;
        let deviceInterval: number = parseInt(String(this.config.device_interval), 10) || 0;
        let playlistInterval: number = parseInt(String(this.config.playlist_interval), 10) || 0;
        if (isEmpty(this.application.clientId)) {
            return this.log.error('Client_ID is not filled');
        }
        if (isEmpty(this.application.clientSecret)) {
            return this.log.error('Client_Secret is not filled');
        }
        if (isEmpty(this.application.deleteDevices)) {
            this.application.deleteDevices = false;
        }
        if (isEmpty(this.application.deletePlaylists)) {
            this.application.deletePlaylists = false;
        }
        if (isEmpty(this.application.keepShuffleState)) {
            this.application.keepShuffleState = false;
        }
        if (isEmpty(this.application.statusPollingDelaySeconds)) {
            this.application.statusPollingDelaySeconds = 5;
        } else if (this.application.statusPollingDelaySeconds < 1 && this.application.statusPollingDelaySeconds != 0) {
            this.application.statusPollingDelaySeconds = 1;
        }
        if (deviceInterval < 1 && deviceInterval != 0) {
            deviceInterval = 1;
        }
        if (playlistInterval < 1 && playlistInterval != 0) {
            playlistInterval = 1;
        }
        this.application.devicePollingDelaySeconds = deviceInterval * 60;
        this.application.playlistPollingDelaySeconds = playlistInterval * 60;
        this.subscribeStates('*');
        this.startCallbackServer();
        void this.start();
    }

    startCallbackServer(): void {
        // Try to start the callback server on the configured port or fallback to other ports
        const portsToTry = [80, 8080, 8888];
        let portIndex = 0;

        const tryStartServer = (): void => {
            if (portIndex >= portsToTry.length) {
                this.log.error(`Could not start OAuth callback server on any port: ${portsToTry.join(', ')}`);
                return;
            }

            const currentPort = portsToTry[portIndex];

            // Create a fresh HTTP server for each port attempt
            const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
                try {
                    const parsedUrl = url.parse(req.url || '', true);
                    const queryParams = parsedUrl.query;

                    this.log.debug(`OAuth callback received from Spotify: ${req.url}`);

                    // Extract code and state from query parameters
                    if (queryParams.code) {
                        const code = Array.isArray(queryParams.code) ? queryParams.code[0] : queryParams.code;
                        this.log.debug(`Authorization code received: ${code.substring(0, 20)}...`);
                        this.application.code = code;

                        // Simulate the trigger for listenOnAuthorizationReturnUri
                        const callbackObj = {
                            state: {
                                val: req.url,
                            },
                        };

                        // Generate a proper response
                        const responseHtml = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Spotify Authorization</title>
                            <meta charset="utf-8">
                            <style>
                                body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1DB954; }
                                .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                                h1 { color: #1DB954; margin: 0; }
                                p { color: #666; font-size: 16px; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>✓ Spotify Authorization Successful!</h1>
                                <p>You can now close this window and return to ioBroker.</p>
                                <p>The adapter will process the authorization automatically.</p>
                            </div>
                        </body>
                        </html>
                    `;

                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(responseHtml);

                        // Process the callback after a short delay to ensure a response is sent
                        setTimeout(() => {
                            void this.listenOnAuthorizationReturnUri(callbackObj);
                        }, 100);
                    } else if (queryParams.error) {
                        this.log.error(`Spotify OAuth error: ${queryParams.error.toString()}`);
                        const errorHtml = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Spotify Authorization Error</title>
                            <meta charset="utf-8">
                            <style>
                                body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #ff4444; }
                                .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                                h1 { color: #ff4444; margin: 0; }
                                p { color: #666; font-size: 16px; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>✗ Spotify Authorization Failed</h1>
                                <p>Error: ${queryParams.error.toString()}</p>
                                <p>Please try again.</p>
                            </div>
                        </body>
                        </html>
                    `;
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(errorHtml);
                    } else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found');
                    }
                } catch (error) {
                    this.log.error(`Error in OAuth callback handler: ${(error as Error).message}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal Server Error');
                }
            });

            server.listen(currentPort, '127.0.0.1', () => {
                this.log.info(`OAuth callback server listening on http://127.0.0.1:${currentPort}`);

                // Store reference to the server
                this.application.callbackServer = server;
                // Update the port in application config
                this.application.callbackPort = currentPort;

                // If port is not 80, warn the user that redirect URI might need adjustment
                if (currentPort !== 80) {
                    this.log.warn(
                        `WARNING: OAuth callback server is running on port ${currentPort}, but configured URI may use port 80. Make sure your Spotify App is configured with the correct Redirect URI: http://127.0.0.1:${currentPort}`,
                    );
                }
            });

            server.on('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE') {
                    this.log.debug(`Port ${currentPort} is in use, trying next port...`);
                    portIndex++;
                    tryStartServer();
                } else {
                    this.log.error(`OAuth callback server error on port ${currentPort}: ${error.message}`);
                }
            });
        };

        tryStartServer();
    }

    async start(): Promise<void> {
        this.clearCache();

        try {
            const tokenObj = this.readTokenStates();
            this.application.token = tokenObj.accessToken;
            this.application.refreshToken = tokenObj.refreshToken;
            this.scheduleTokenRefresh(this.getTokenExpiresAtMs(tokenObj), 'startup');
            const data = await this.sendRequest('/v1/me', 'GET', '');
            await this.setUserInformation(data);
            await Promise.all([
                cache.setValue('authorization.authorized', true),
                cache.setValue('info.connection', true),
            ]);
            try {
                await this.listenOnGetPlaybackInfo();
            } catch {
                // ignore
            }
            try {
                await this.reloadUsersPlaylist();
            } catch {
                // ignore
            }
            try {
                return await this.listenOnGetDevices();
            } catch {
                // ignore
            }
        } catch (err) {
            this.log.warn(err);
            await Promise.all([
                cache.setValue('authorization.authorized', false),
                cache.setValue('info.connection', false),
            ]);
        }
    }

    readTokenStates(): TokenObject {
        const state = cache.getValue('authorization.token')!;

        if (state) {
            let tokenObj: TokenObject = {} as TokenObject;
            if (typeof state.val === 'string') {
                try {
                    tokenObj = JSON.parse(state.val);
                } catch (e) {
                    // empty
                    this.log.info(`Error: ${e}`);
                }
            }
            const validAccessToken = !isEmpty(this.loadOrDefault<string>(tokenObj, 'accessToken', ''));
            const validRefreshToken = !isEmpty(this.loadOrDefault<string>(tokenObj, 'refreshToken', ''));
            const validClientId =
                !isEmpty(this.loadOrDefault<string>(tokenObj, 'clientId', '')) &&
                tokenObj.clientId === this.application.clientId;
            const validClientSecret =
                !isEmpty(this.loadOrDefault<string>(tokenObj, 'clientSecret', '')) &&
                tokenObj.clientSecret === this.application.clientSecret;

            if (validAccessToken && validRefreshToken && validClientId && validClientSecret) {
                this.log.debug('spotify token read');
                return tokenObj;
            }
            throw new Error('invalid or no spotify token');
        }
        throw new Error('invalid or no spotify token');
    }

    getTokenExpiresAtMs(tokenObj: TokenObject): number {
        const expiresAtMs = this.loadOrDefault<number>(tokenObj, 'expiresAtMs', 0);
        if (expiresAtMs > 0) {
            return expiresAtMs;
        }
        const expiresInSec = Number(this.loadOrDefault<number>(tokenObj, 'expiresInSec', 0)) || 3600;
        return Date.now() + expiresInSec * 1000;
    }

    scheduleTokenRefresh(expiresAtMs: number, source: string): void {
        if (!expiresAtMs || !this.application.refreshToken) {
            return;
        }

        clearTimeout(this.application.tokenRefreshTimer);

        const now = Date.now();
        const refreshAtMs = Math.max(expiresAtMs - TOKEN_REFRESH_SKEW_MS, now + TOKEN_REFRESH_MIN_DELAY_MS);
        const delayMs = Math.max(refreshAtMs - now, TOKEN_REFRESH_MIN_DELAY_MS);

        this.application.tokenExpiresAtMs = expiresAtMs;
        this.log.debug(`Scheduling token refresh in ${Math.round(delayMs / 1000)}s (${source})`);

        this.application.tokenRefreshTimer = setTimeout(() => {
            if (this.stopped) {
                return;
            }
            this.log.debug('Starting proactive token refresh...');
            this.refreshToken()
                .then(() => this.log.info('Proactive token refresh successful'))
                .catch(err => {
                    this.log.error(`Proactive token refresh failed: ${err}`);

                    if (isTransientNetworkError(err)) {
                        this.log.warn(
                            `Proactive token refresh failed due temporary network issue; retrying in ${Math.round(TOKEN_REFRESH_RETRY_DELAY_MS / 1000)}s`,
                        );
                        clearTimeout(this.application.tokenRefreshTimer);
                        this.application.tokenRefreshTimer = setTimeout(() => {
                            if (this.stopped) {
                                return;
                            }
                            this.log.debug('Retrying proactive token refresh after transient network error...');
                            this.refreshToken()
                                .then(() => this.log.info('Proactive token refresh retry successful'))
                                .catch(retryErr => this.log.error(`Proactive token refresh retry failed: ${retryErr}`));
                        }, TOKEN_REFRESH_RETRY_DELAY_MS);
                    }
                });
        }, delayMs);
    }

    sendRequest(
        endpoint: string,
        method: string,
        sendBody: string,
        delayAccepted?: boolean,
        tokenRefreshAttempted?: boolean,
    ): Promise<any> {
        // Queue all requests to prevent Spotify rate limiting (429 errors)
        return this.requestQueue.add(() =>
            this.sendRequestDirect(endpoint, method, sendBody, delayAccepted, tokenRefreshAttempted),
        );
    }

    async sendRequestDirect(
        endpoint: string,
        method: string,
        sendBody: string,
        delayAccepted?: boolean,
        tokenRefreshAttempted?: boolean,
    ): Promise<any> {
        const options = {
            url: this.application.baseUrl + endpoint,
            method,
            lookup, // DNS caching
            headers: {
                Authorization: `Bearer ${this.application.token}`,
            },
            form: sendBody,
        };
        this.log.debug(`spotify api call... ${endpoint}; ${options.form}`);
        const callStack = new Error().stack;
        void this.setState('authorization.error', '', true);

        if (this.tooManyRequests) {
            // We are currently blocked because of too many requests. Do not send out a new request.
            this.log.debug(`TooManyRequests: ${this.tooManyRequests} endpoint: ${endpoint}`);
            return Promise.reject(new Error('429'));
        }

        try {
            const response = await this.request(options);
            const body = typeof response.body !== 'undefined' ? response.body : response.data;
            const statusCode = typeof response.statusCode !== 'undefined' ? response.statusCode : response.status;
            const headers = response.headers || {};
            let ret;
            let parsedBody;

            if (body && typeof body === 'object') {
                parsedBody = body;
            } else {
                try {
                    parsedBody = body ? JSON.parse(body) : { error: { message: 'no active device' } };
                } catch (e) {
                    parsedBody = {
                        error: { message: `no active device ${e?.message ? `: ${e.message}` : ''}` },
                    };
                }
            }

            switch (statusCode) {
                case 200:
                    // OK
                    ret = parsedBody;
                    break;
                case 202:
                    // Accepted, processing has not been completed.
                    this.log.debug(`http response: ${JSON.stringify(response)}`);
                    if (delayAccepted) {
                        ret = null;
                    } else {
                        throw new Error(statusCode.toString());
                    }
                    break;
                case 204:
                    // OK, No Content
                    ret = null;
                    break;
                case 400: // Bad Request, message body will contain more information
                case 500: // Server Error
                case 503: // Service Unavailable
                case 404: // Not Found
                case 502:
                    // Bad Gateway
                    throw new Error(statusCode.toString());
                case 403:
                case 401:
                    // Unauthorized or Forbidden
                    // For 401 (Unauthorized), try to refresh token automatically (only once)
                    if (statusCode === 401 && !tokenRefreshAttempted) {
                        this.log.warn(`Received 401 Unauthorized on ${endpoint} - attempting automatic token refresh`);
                        try {
                            await Promise.all([
                                cache.setValue('authorization.authorized', false),
                                cache.setValue('info.connection', false),
                            ]);
                            this.log.debug('Starting token refresh...');
                            await this.refreshToken();
                            this.log.info('Token refresh successful - reconnecting');
                            await Promise.all([
                                cache.setValue('authorization.authorized', true),
                                cache.setValue('info.connection', true),
                            ]);
                            const data = await this.sendRequest(endpoint, method, sendBody, delayAccepted, true);
                            this.log.info(`Request retry after token refresh successful for ${endpoint}`);
                            return data;
                        } catch (err) {
                            if (err.toString().includes('202')) {
                                this.log.debug(`${err} request accepted but no data, try again`);
                            } else {
                                this.log.error(`Token refresh or retry failed for ${endpoint}: ${err}`);
                            }
                            throw err;
                        }
                    } else if (
                        statusCode === 403 &&
                        parsedBody.error &&
                        parsedBody.error.message === 'The access token expired'
                    ) {
                        // 403 - try refresh only if it looks like token expiration
                        this.log.debug('access token expired (403)!');
                        try {
                            await Promise.all([
                                cache.setValue('authorization.authorized', false),
                                cache.setValue('info.connection', false),
                            ]);
                            await this.refreshToken();
                            await Promise.all([
                                cache.setValue('authorization.authorized', true),
                                cache.setValue('info.connection', true),
                            ]);
                            const result = await this.sendRequest(endpoint, method, sendBody, delayAccepted, true);
                            this.log.debug('data with new token');
                            return result;
                        } catch (err) {
                            if (err.toString().includes('202')) {
                                this.log.debug(`${err} request accepted but no data, try again`);
                            } else {
                                this.log.error(`error on request data again. ${err}`);
                            }
                            throw err;
                        }
                    } else {
                        if (statusCode === 401 && tokenRefreshAttempted) {
                            this.log.error(
                                `Authentication failed (401) on endpoint: ${endpoint} - Token refresh did not resolve the issue`,
                            );
                        } else if (statusCode === 403) {
                            this.log.warn('Seems that the token is expired or permissions are insufficient!');
                            this.log.warn(`status code: ${statusCode}`);
                            this.log.warn(`endpoint: ${endpoint}`);
                            this.log.warn(`error message: ${parsedBody.error?.message || 'unknown'}`);
                            this.log.debug(`body: ${body}`);
                        }

                        await Promise.all([
                            cache.setValue('authorization.authorized', false),
                            cache.setValue('info.connection', false),
                        ]);
                        this.log.error(`${statusCode} response: ${parsedBody.error?.message || 'unknown error'}`);
                        throw new Error(statusCode.toString());
                    }

                case 429: {
                    // Too Many Requests
                    let wait = 1;
                    if (headers?.['retry-after'] && Number(headers['retry-after']) > 0) {
                        wait = Number(headers['retry-after']);
                        this.tooManyRequests = true;
                        this.log.warn(`too many requests, wait ${wait}s`);
                    }
                    try {
                        await new Promise<void>(resolve => setTimeout(() => !this.stopped && resolve(), wait * 1000));
                        this.tooManyRequests = false;
                        return await this.sendRequest(endpoint, method, sendBody, delayAccepted);
                    } catch (error) {
                        this.log.debug(error);
                    }
                    break;
                }

                default: {
                    this.log.warn('http request error not handled, please debug');
                    this.log.debug(`status code: ${statusCode}`);
                    this.log.warn(callStack || '');
                    this.log.warn(new Error().stack || '');
                    const safeBody =
                        typeof body !== 'undefined' && body !== null
                            ? body
                            : response?.data
                              ? JSON.stringify(response.data)
                              : 'unknown error';
                    this.log.debug(`body: ${safeBody}`);
                    ret = Promise.reject(new Error(statusCode.toString()));
                    try {
                        await this.setStateAsync('authorization.error', safeBody, true);
                    } catch (err) {
                        this.log.warn(`Could not set authorization.error state: ${err?.message || err}`);
                    }
                }
            }
            return ret;
        } catch (axiosError) {
            // Handle AxiosError - when axios throws an error with no response or error response
            if (!axiosError.response) {
                // Network error, DNS error, timeout, etc. - not Spotify's fault
                this.log.error(`network request error on ${endpoint}: ${axiosError.message}`);
                if (isTransientNetworkError(axiosError)) {
                    return Promise.reject(new Error('503'));
                }
                return Promise.reject(axiosError as Error);
            }

            // AxiosError with response status - process like normal error
            const errorStatusCode = axiosError.response.status;
            const body = axiosError.response.data;

            this.log.debug(`spotify api error response: ${errorStatusCode} on ${endpoint}`);

            // Handle 401 specifically - try token refresh
            if (errorStatusCode === 401 && !tokenRefreshAttempted) {
                this.log.warn(
                    `Received 401 Unauthorized on ${endpoint} (via error) - attempting automatic token refresh`,
                );
                try {
                    await Promise.all([
                        cache.setValue('authorization.authorized', false),
                        cache.setValue('info.connection', false),
                    ]);
                    this.log.debug('Starting token refresh (from error handler)...');
                    await this.refreshToken();
                    this.log.info('Token refresh successful - reconnecting');
                    await Promise.all([
                        cache.setValue('authorization.authorized', true),
                        cache.setValue('info.connection', true),
                    ]);
                    const result = await this.sendRequest(endpoint, method, sendBody, delayAccepted, true);
                    this.log.info(`Request retry after token refresh successful for ${endpoint}`);
                    return result;
                } catch (err) {
                    this.log.error(`Token refresh or retry failed for ${endpoint}: ${err}`);
                    throw err;
                }
            }
            if (errorStatusCode === 403 && endpoint.includes('/playlists/') && endpoint.includes('/tracks')) {
                this.log.debug(`playlist tracks access denied (403) on ${endpoint}; skipping`);
                throw new Error(errorStatusCode.toString());
            }

            // For other error codes - just reject
            this.log.error(
                `request failed with status ${errorStatusCode} on ${endpoint}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
            );
            throw new Error(errorStatusCode.toString());
        }
    }

    loadOrDefault<T>(obj: any, name: string, defaultVal: T): T {
        let t;
        try {
            const f = new Function('obj', 'name', `return obj.${name}`);
            t = f(obj, name);
        } catch (e) {
            if (!obj) {
                this.log.error(`loadOrDefault error: ${e}`);
            }
        }
        if (t === undefined) {
            t = defaultVal;
        }
        return t;
    }

    createOrDefault(
        obj: any,
        name: string,
        stateId: string,
        defaultVal: ioBroker.StateValue,
        description: string,
        type: ioBroker.CommonType,
        states?: Record<string, string>,
    ): Promise<void> {
        const t = this.loadOrDefault(obj, name, defaultVal);
        const object: ioBroker.StateObject = {
            _id: stateId,
            type: 'state',
            common: {
                name: description,
                type,
                role: 'value',
                write: false,
                read: true,
            },
            native: {},
        };
        if (states) {
            object.common.states = states;
        }
        return cache.setValue(stateId, t, object);
    }

    setOrDefault(obj: any, name: string, state: string, defaultVal: ioBroker.StateValue): Promise<void> {
        const t = this.loadOrDefault(obj, name, defaultVal);
        return cache.setValue(state, t);
    }

    shrinkStateName(v: string): string {
        let n = v.replace(/[\s."`'*,\\?<>[\];:]+/g, '');
        if (isEmpty(n)) {
            n = 'onlySpecialCharacters';
        }
        return n;
    }

    getArtistArrayOrDefault(data: any, name: string): { id: string; name: string }[] {
        const ret: { id: string; name: string }[] = [];
        for (let i = 0; i < 100; i++) {
            const artistName = this.loadOrDefault<string>(data, `${name}[${i}].name`, '');
            const artistId = this.loadOrDefault<string>(data, `${name}[${i}].id`, '');
            if (!isEmpty(artistName) && !isEmpty(artistId)) {
                ret.push({ id: artistId, name: artistName });
            } else {
                break;
            }
        }
        return ret;
    }

    getArtistNamesOrDefault(
        data: {
            item?: { artists: { name: string }[] };
            tracks?: { artists: { name: string }[] };
        },
        name: string,
    ): string {
        let ret = '';
        for (let i = 0; i < 100; i++) {
            const artist = this.loadOrDefault<string>(data, `${name}[${i}].name`, '');
            if (!isEmpty(artist)) {
                if (i > 0) {
                    ret += ', ';
                }
                ret += artist;
            } else {
                break;
            }
        }
        return ret;
    }

    setObjectStatesIfChanged(id: string, states: any): Promise<void> {
        let obj = cache.getObj(id);
        if (obj == null) {
            obj = {
                common: {
                    name: '',
                    type: 'string',
                    role: 'value',
                    states: null,
                    read: true,
                    write: true,
                },
                type: 'state',
            };
        }

        return cache.setValue(id, null, {
            _id: `${this.namespace}.${id}`,
            type: obj.type,
            common: {
                name: obj.common.name,
                type: obj.common.type,
                role: obj.common.role,
                states,
                read: obj.common.read,
                write: obj.common.write,
            },
            native: {},
        });
    }

    copyState(src: string, dst: string): Promise<void> {
        // return cache.setValue(dst, cache.getValue(src).val);
        const tmp_src = cache.getValue(src);
        if (tmp_src) {
            return cache.setValue(dst, tmp_src.val);
        }
        this.log.debug('bei copyState: fehlerhafte Playlists-Daten src');
        return Promise.resolve();
    }

    copyObjectStates(src: string, dst: string): Promise<void> {
        // return setObjectStatesIfChanged(dst, cache.getObj(src).common.states);
        const tmpSrc = cache.getObj(src);
        if (tmpSrc?.common) {
            return this.setObjectStatesIfChanged(dst, tmpSrc.common.states);
        }
        this.log.debug('bei copyObjectStates: fehlerhafte Playlists-Daten src');
        return Promise.resolve();
    }

    async createPlaybackInfo(data: {
        device?: {
            id: string;
            is_active: boolean;
            is_restricted: boolean;
            name: string;
            type: string;
            volume_percent: number;
        };
        is_playing?: boolean;
        item?: {
            duration_ms: number;
            type: string;
            album: {
                name: string;
                images: { url: string }[];
            };
            artists: { name: string }[];
        };
        context?: {
            type: string;
        };
        progress_ms?: number;
        shuffle_state?: boolean;
    }): Promise<void> {
        data ||= {};
        const deviceId = this.loadOrDefault<string>(data, 'device.id', '');
        const isDeviceActive = this.loadOrDefault<boolean>(data, 'device.is_active', false);
        const isDeviceRestricted = this.loadOrDefault<boolean>(data, 'device.is_restricted', false);
        const deviceName = this.loadOrDefault<string>(data, 'device.name', '');
        const deviceType = this.loadOrDefault<string>(data, 'device.type', '');
        const deviceVolume = this.loadOrDefault<number>(data, 'device.volume_percent', 100);
        const isPlaying = this.loadOrDefault<boolean>(data, 'is_playing', false);
        const duration = this.loadOrDefault<number>(data, 'item.duration_ms', 0);
        let type = this.loadOrDefault<string>(data, 'context.type', '');
        if (!type) {
            type = this.loadOrDefault<string>(data, 'item.type', '');
        }
        const progress = this.loadOrDefault<number>(data, 'progress_ms', 0);
        let progressPercentage = 0;
        if (duration > 0) {
            progressPercentage = Math.floor((progress / duration) * 100);
        }
        let contextDescription = '';
        let contextImage = '';
        const album = this.loadOrDefault<string>(data, 'item.album.name', '');
        const albumUrl = this.loadOrDefault<string>(data, 'item.album.images[0].url', '');
        const artist = this.getArtistNamesOrDefault(data, 'item.artists');
        if (type === 'album') {
            contextDescription = `Album: ${album}`;
            contextImage = albumUrl;
        } else if (type === 'artist') {
            contextDescription = `Artist: ${artist}`;
        } else if (type === 'track') {
            contextDescription = 'Track';
            // tracks has no images
            contextImage = albumUrl;
        }

        const shuffle = this.loadOrDefault<boolean>(data, 'shuffle_state', false);
        await Promise.all([
            cache.setValue('player.device.id', deviceId),
            cache.setValue('player.device.isActive', isDeviceActive),
            cache.setValue('player.device.isRestricted', isDeviceRestricted),
            cache.setValue('player.device.name', deviceName),
            cache.setValue('player.device.type', deviceType),
            cache.setValue('player.device.volume', { val: deviceVolume, ack: true }),
            cache.setValue('player.device.isAvailable', !isEmpty(deviceName)),
            cache.setValue('player.device', null, {
                _id: `${this.namespace}.player.device`,
                type: 'device',
                common: {
                    name: isEmpty(deviceName)
                        ? 'Commands to control playback related to the current active device'
                        : deviceName,
                    icon: this.getIconByType(deviceType),
                },
                native: {},
            }),
            cache.setValue('player.isPlaying', isPlaying),
            this.setOrDefault(data, 'item.id', 'player.trackId', ''),
            cache.setValue('player.artistName', artist),
            cache.setValue('player.album', album),
            cache.setValue('player.albumImageUrl', albumUrl),
            this.setOrDefault(data, 'item.name', 'player.trackName', ''),
            cache.setValue('player.durationMs', duration),
            cache.setValue('player.duration', this.convertToDigiClock(duration)),
            cache.setValue('player.type', type),
            cache.setValue('player.progressMs', progress),
            cache.setValue('player.progressPercentage', progressPercentage),
            cache.setValue('player.progress', this.convertToDigiClock(progress)),
            cache.setValue('player.shuffle', shuffle ? 'on' : 'off'),
            this.setOrDefault(data, 'repeat_state', 'player.repeat', 'off'),
            this.setOrDefault(data, 'device.volume_percent', 'player.device.volume', 100),
        ]);
        if (deviceName) {
            this.deviceData.lastActiveDeviceId = deviceId;
            const states = cache.getValues('devices.*');

            const keys = Object.keys(states);
            const fn1 = async (key: string): Promise<void> => {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                key = removeNameSpace(key);
                let name: string;
                if (deviceId != null) {
                    name = this.shrinkStateName(deviceId);
                } else {
                    name = this.shrinkStateName(deviceName);
                }
                if (key !== `devices.${name}.isActive`) {
                    await cache.setValue(key, false);
                }
            };

            await Promise.all(keys.map(fn1));
            await this.createDevices({
                devices: [
                    {
                        id: deviceId,
                        is_active: isDeviceActive,
                        is_restricted: isDeviceRestricted,
                        name: deviceName,
                        type: deviceType,
                        volume_percent: deviceVolume,
                    },
                ],
            });
            await this.refreshDeviceList();
        }
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn2 = async (key: string): Promise<void> => {
            if (!key.endsWith('.isActive')) {
                return;
            }
            key = removeNameSpace(key);
            await cache.setValue(key, false);
        };

        await Promise.all(keys.map(fn2).filter((p): p is Promise<void> => p !== undefined));

        if (progress && isPlaying && this.application.statusPollingDelaySeconds > 0) {
            this.scheduleStatusInternalTimer(
                duration,
                progress,
                Date.now(),
                this.application.statusPollingDelaySeconds - 1,
            );
        }
        const currentTrackId = this.loadOrDefault<string>(data, 'item.id', '');
        if (currentTrackId === this.application.lastTrackId && currentTrackId !== '') {
            // Same track, skip artist loading
            await Promise.resolve();
        }
        this.application.lastTrackId = currentTrackId;
        const artists = [];
        for (let i = 0; i < 100; i++) {
            const id = this.loadOrDefault<string>(data, `item.artists[${i}].id`, '');
            if (isEmpty(id)) {
                break;
            }
            artists.push(id);
        }
        const urls: string[] = [];
        const fn = async (artist: string): Promise<void> => {
            if (artist in this.artistImageUrlCache) {
                urls.push(this.artistImageUrlCache[artist]);
                return;
            }
            try {
                const parseJson = await this.sendRequest(`/v1/artists/${artist}`, 'GET', '');
                const artistUrl = this.loadOrDefault<string>(parseJson, 'images[0].url', '');
                if (!isEmpty(artistUrl)) {
                    this.artistImageUrlCache[artist] = artistUrl;
                    urls.push(artistUrl);
                }
            } catch (error) {
                this.log.debug(error);
            }
        };
        await artists.reduce((promise, artist) => promise.then(() => fn(artist)), Promise.resolve());
        let set = '';
        if (urls.length !== 0) {
            set = urls[0];
        }
        if (type === 'artist') {
            contextImage = set;
        }
        await cache.setValue('player.artistImageUrl', set);
        const uri = this.loadOrDefault<string>(data, 'context.uri', '');
        if (type === 'playlist' && uri) {
            const indexOfUser = uri.indexOf('user:') + 5;
            const endIndexOfUser = uri.indexOf(':', indexOfUser);
            const indexOfPlaylistId = uri.indexOf('playlist:') + 9;
            const playlistId = uri.slice(indexOfPlaylistId);
            const userId = uri.substring(indexOfUser, endIndexOfUser);
            const query = {
                fields: 'name,id,owner.id,tracks.total,images',
            };
            await cache.setValue('player.playlist.id', playlistId);
            const refreshPlaylist = async (parseJson: {
                id: string;
                name: string;
                images: [{ url: string }];
                owner: { id: string };
                tracks: { total: string };
            }): Promise<void> => {
                const playlistName = this.loadOrDefault<string>(parseJson, 'name', '');
                contextDescription = `Playlist: ${playlistName}`;
                const songId = this.loadOrDefault<string>(data, 'item.id', '');
                const playlistImage = this.loadOrDefault<string>(parseJson, 'images[0].url', '');
                contextImage = playlistImage;
                const ownerId = this.loadOrDefault<string>(parseJson, 'owner.id', '');
                const trackCount = this.loadOrDefault<string>(parseJson, 'tracks.total', '');
                const prefix = this.shrinkStateName(`${ownerId}-${playlistId}`);
                this.playlistCache[`${ownerId}-${playlistId}`] = {
                    id: playlistId,
                    name: playlistName,
                    images: [{ url: playlistImage }],
                    owner: { id: ownerId },
                    tracks: { total: trackCount },
                };

                const trackList = cache.getValue(`playlists.${prefix}.trackList`);
                await Promise.all([
                    cache.setValue('player.playlist.owner', ownerId),
                    cache.setValue('player.playlist.tracksTotal', parseInt(trackCount, 10)),
                    cache.setValue('player.playlist.imageUrl', playlistImage),
                    cache.setValue('player.playlist.name', playlistName),
                    cache.setValue('player.playlist', null, {
                        _id: `${this.namespace}.player.playlist`,
                        type: 'channel',
                        common: {
                            name: isEmpty(playlistName)
                                ? 'Commands to control playback related to the playlist'
                                : playlistName,
                        },
                        native: {},
                    }),
                ]);
                if (cache.getValue(`playlists.${prefix}.trackListIds`) === null) {
                    await this.createPlaylists({
                        items: [parseJson],
                    });
                }
                await this.refreshPlaylistList();
                const promises: Promise<void>[] = [
                    this.copyState(`playlists.${prefix}.trackListNumber`, 'player.playlist.trackListNumber'),
                    this.copyState(`playlists.${prefix}.trackListString`, 'player.playlist.trackListString'),
                    this.copyState(`playlists.${prefix}.trackListStates`, 'player.playlist.trackListStates'),
                    this.copyObjectStates(`playlists.${prefix}.trackList`, 'player.playlist.trackList'),
                    this.copyState(`playlists.${prefix}.trackListIdMap`, 'player.playlist.trackListIdMap'),
                    this.copyState(`playlists.${prefix}.trackListIds`, 'player.playlist.trackListIds'),
                    this.copyState(`playlists.${prefix}.trackListArray`, 'player.playlist.trackListArray'),
                ];
                if (trackList) {
                    promises.push(cache.setValue('player.playlist.trackNo', parseInt(trackList.val as string, 10) + 1));
                }
                await Promise.all(promises);
                const state = cache.getValue(`playlists.${prefix}.trackListIds`);
                const ids: string = this.loadOrDefault<string>(state, 'val', '');
                if (isEmpty(ids)) {
                    return Promise.reject(new Error('no ids in trackListIds'));
                }
                const stateName = ids.split(';');
                const stateArr: Record<string, string> = {};
                for (let i = 0; i < stateName.length; i++) {
                    const ele = stateName[i].split(':');
                    stateArr[ele[1]] = ele[0];
                }
                if (stateArr[songId] !== '' && stateArr[songId] !== null) {
                    const no = stateArr[songId];
                    await Promise.all([
                        cache.setValue(`playlists.${prefix}.trackList`, no),
                        cache.setValue('player.playlist.trackList', no),
                        cache.setValue('player.playlist.trackNo', parseInt(no, 10) + 1),
                    ]);
                    return;
                }
            };

            // Only load playlist details if playlist ID has changed (same logic as artist caching)
            if (playlistId === this.application.lastPlaylistId && playlistId !== '') {
                // Same playlist, skip loading playlist details
                await Promise.resolve();
            }

            // Playlist changed, update lastPlaylistId and load details
            this.application.lastPlaylistId = playlistId;

            // Check cache first using proper syntax
            if (`${userId}-${playlistId}` in this.playlistCache) {
                await refreshPlaylist(this.playlistCache[`${userId}-${playlistId}`]);
            }
            try {
                const parseJson = await this.sendRequest(
                    `/v1/users/${userId}/playlists/${playlistId}?${querystring.stringify(query)}`,
                    'GET',
                    '',
                );
                await refreshPlaylist(parseJson);
            } catch (error) {
                this.log.debug(error);
            }
        }
        this.log.debug(`context type: "${type}"`);
        await Promise.all([
            cache.setValue('player.playlist.id', ''),
            cache.setValue('player.playlist.name', ''),
            cache.setValue('player.playlist.owner', ''),
            cache.setValue('player.playlist.tracksTotal', 0),
            cache.setValue('player.playlist.imageUrl', ''),
            cache.setValue('player.playlist.trackList', ''),
            cache.setValue('player.playlist.trackListNumber', ''),
            cache.setValue('player.playlist.trackListString', ''),
            cache.setValue('player.playlist.trackListStates', ''),
            cache.setValue('player.playlist.trackListIdMap', ''),
            cache.setValue('player.playlist.trackListIds', ''),
            cache.setValue('player.playlist.trackListArray', ''),
            cache.setValue('player.playlist.trackNo', 0),
            cache.setValue('playlists.playlistList', ''),
            cache.setValue('player.playlist', null, {
                _id: `${this.namespace}.player.playlist`,
                type: 'channel',
                common: {
                    name: 'Commands to control playback related to the playlist',
                },
                native: {},
            }),
        ]);
        this.listenOnHtmlTracklist();
        await this.listenOnHtmlPlaylists();
        await Promise.all([
            cache.setValue('player.contextImageUrl', contextImage),
            cache.setValue('player.contextDescription', contextDescription),
        ]);
    }

    convertToDigiClock(ms: number): string {
        // milliseconds to digital time, e.g. 3:59=238759
        ms ||= 0;
        const min = Math.floor(ms / 60000);
        const sec = Math.floor(((ms % 360000) % 60000) / 1000);
        return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
    }

    async setUserInformation(data: any): Promise<void> {
        this.application.userId = data.id;
        await cache.setValue('authorization.userId', data.id);
    }

    async reloadUsersPlaylist(): Promise<void> {
        const addedList = await this.getUsersPlaylist(0);
        if (this.application.deletePlaylists) {
            await this.deleteUsersPlaylist(addedList);
        }
        await this.refreshPlaylistList();
    }

    deleteUsersPlaylist(addedList: string[]): Promise<(void | undefined)[]> {
        const states = cache.getValues('playlists.*');
        const keys = Object.keys(states);
        const fn = (key: string): Promise<void> | undefined => {
            key = removeNameSpace(key);
            let found = false;
            if (addedList) {
                for (let i = 0; i < addedList.length; i++) {
                    if (key.startsWith(addedList[i])) {
                        found = true;
                        break;
                    }
                }
            }

            if (
                !found &&
                key !== 'playlists.playlistList' &&
                key !== 'playlists.playlistListIds' &&
                key !== 'playlists.playlistListString' &&
                key !== 'playlists.yourPlaylistListIds' &&
                key !== 'playlists.yourPlaylistListString'
            ) {
                return cache.delObject(key).then(() => {
                    if (key.endsWith('.id')) {
                        return cache.delObject(key.substring(0, key.length - 3));
                    }
                });
            }
        };
        return Promise.all(keys.map(fn).filter((p): p is Promise<void> => p !== undefined));
    }

    async createPlaylists(
        parseJson: {
            items: {
                id: string;
                owner: { id: string };
                tracks: { total: string };
                images: { url: string }[];
            }[];
            offset?: number;
            next?: string;
            limit?: number;
        },
        autoContinue?: boolean,
        addedList?: string[],
    ): Promise<undefined | string[]> {
        if (isEmpty(parseJson) || isEmpty(parseJson.items)) {
            this.log.debug('no playlist content');
            return Promise.reject(new Error('no playlist content'));
        }
        const fn = async (item: {
            id: string;
            owner: { id: string };
            tracks: { total: string };
            images: { url: string }[];
        }): Promise<void> => {
            const playlistName = this.loadOrDefault<string>(item, 'name', '');
            if (isEmpty(playlistName)) {
                this.log.warn('empty playlist name');
                throw new Error('empty playlist name');
            }
            const playlistId = this.loadOrDefault<string>(item, 'id', '');
            const ownerId = this.loadOrDefault<string>(item, 'owner.id', '');
            const trackCount = this.loadOrDefault<string>(item, 'tracks.total', '');
            const imageUrl = this.loadOrDefault<string>(item, 'images[0].url', '');
            this.playlistCache[`${ownerId}-${playlistId}`] = {
                id: playlistId,
                name: playlistName,
                images: [{ url: imageUrl }],
                owner: { id: ownerId },
                tracks: { total: trackCount },
            };

            const prefix = `playlists.${this.shrinkStateName(`${ownerId}-${playlistId}`)}`;
            addedList ||= [];
            addedList.push(prefix);

            await Promise.all([
                cache.setValue(prefix, null, {
                    _id: `${this.namespace}.${prefix}`,
                    type: 'channel',
                    common: { name: playlistName },
                    native: {},
                }),
                cache.setValue(`${prefix}.playThisList`, false, {
                    _id: `${this.namespace}.${prefix}.playThisList`,
                    type: 'state',
                    common: {
                        name: 'press to play this playlist',
                        type: 'boolean',
                        role: 'button',
                        read: false,
                        write: true,
                        icon: 'icons/play_black.png',
                    },
                    native: {},
                }),
                this.createOrDefault(item, 'id', `${prefix}.id`, '', 'playlist id', 'string'),
                this.createOrDefault(item, 'owner.id', `${prefix}.owner`, '', 'playlist owner', 'string'),
                this.createOrDefault(item, 'name', `${prefix}.name`, '', 'playlist name', 'string'),
                this.createOrDefault(item, 'tracks.total', `${prefix}.tracksTotal`, '', 'number of songs', 'number'),
                this.createOrDefault(item, 'images[0].url', `${prefix}.imageUrl`, '', 'image url', 'string'),
            ]);
            const playlistObject = await this.getPlaylistTracks(ownerId, playlistId);
            let trackListValue = '';
            const currentPlaylistId = cache.getValue('player.playlist.id')?.val;
            const currentPlaylistOwnerId = cache.getValue('player.playlist.owner')?.val;
            const songId = cache.getValue('player.trackId')?.val as string;
            if (`${ownerId}-${playlistId}` === `${currentPlaylistOwnerId}-${currentPlaylistId}`) {
                const stateName = playlistObject.trackIds.split(';');
                const stateArr: Record<string, string> = {};
                for (let i = 0; i < stateName.length; i++) {
                    const ele = stateName[i].split(':');
                    stateArr[ele[1]] = ele[0];
                }
                if (stateArr[songId] !== '' && stateArr[songId] !== null) {
                    trackListValue = stateArr[songId];
                }
            }
            const stateObj: Record<string, string> = {};
            const states = this.loadOrDefault<string>(playlistObject, 'stateString', '').split(';');
            states.forEach((state: string) => {
                const el = state.split(':');
                if (el.length === 2) {
                    stateObj[el[0]] = el[1];
                }
            });
            await Promise.all([
                cache.setValue(`${prefix}.trackList`, trackListValue, {
                    _id: `${this.namespace}.${prefix}.trackList`,
                    type: 'state',
                    common: {
                        name: 'Tracks of the playlist saved in common part. Change this value to a track position number to start this playlist with this track. First track is 0',
                        type: 'mixed',
                        role: 'value',
                        states: stateObj,
                        read: true,
                        write: true,
                    },
                    native: {},
                }),

                this.createOrDefault(
                    playlistObject,
                    'listNumber',
                    `${prefix}.trackListNumber`,
                    '',
                    'contains list of tracks as string, patter: 0;1;2;...',
                    'string',
                ),
                this.createOrDefault(
                    playlistObject,
                    'listString',
                    `${prefix}.trackListString`,
                    '',
                    'contains list of tracks as string, patter: title - artist;title - artist;title - artist;...',
                    'string',
                ),
                this.createOrDefault(
                    playlistObject,
                    'stateString',
                    `${prefix}.trackListStates`,
                    '',
                    'contains list of tracks as string with position, pattern: 0:title - artist;1:title - artist;2:title - artist;...',
                    'string',
                ),
                this.createOrDefault(
                    playlistObject,
                    'trackIdMap',
                    `${prefix}.trackListIdMap`,
                    '',
                    'contains list of track ids as string with position, pattern: 0:id;1:id;2:id;...',
                    'string',
                ),
                this.createOrDefault(
                    playlistObject,
                    'trackIds',
                    `${prefix}.trackListIds`,
                    '',
                    'contains list of track ids as string, pattern: id;id;id;...',
                    'string',
                ),
                this.createOrDefault(
                    playlistObject,
                    'songs',
                    `${prefix}.trackListArray`,
                    '',
                    'contains list of tracks as array object, pattern:\n[{id: "id",\ntitle: "title",\nartistName: "artistName1, artistName2",\nartistArray: [{id: "artistId", name: "artistName"}, {id: "artistId", name: "artistName"}, ...],\nalbum: {id: "albumId", name: "albumName"},\ndurationMs: 253844,\nduration: 4:13,\naddedAt: 15395478261235,\naddedBy: "userId",\ndiscNumber: 1,\nepisode: false,\nexplicit: false,\npopularity: 56\n}, ...]',
                    'object',
                ),
            ]);
        };

        for (let i = 0; i < parseJson.items.length; i++) {
            await new Promise<void>(resolve => setTimeout(() => !this.stopped && resolve(), 1000));
            await fn(parseJson.items[i]);
        }

        if (autoContinue && parseJson.items.length !== 0 && parseJson.next !== null) {
            return this.getUsersPlaylist(parseJson.offset! + parseJson.limit!, addedList);
        }
        return addedList;
    }

    async getUsersPlaylist(offset: number, addedList?: string[]): Promise<any> {
        addedList ||= [];

        const query = {
            limit: 30,
            offset,
        };
        // Nutze /v1/me/playlists für alle Playlists, auf die der Nutzer Zugriff hat
        try {
            const parsedJson = await this.sendRequest(`/v1/me/playlists?${querystring.stringify(query)}`, 'GET', '');
            return await this.createPlaylists(parsedJson, true, addedList);
        } catch (err) {
            // Improved error handling with different status codes
            const errStr = err.toString();
            if (errStr.includes('403')) {
                this.log.error(
                    `Playlist API returned 403 (Forbidden) at offset ${offset} - Token may be expired or insufficient permissions`,
                );
            } else if (errStr.includes('401')) {
                this.log.warn(
                    `Playlist API returned 401 (Unauthorized) at offset ${offset} - Token refresh should be in progress`,
                );
            } else if (errStr.includes('429')) {
                this.log.debug(
                    `Playlist API returned 429 (Too Many Requests) at offset ${offset} - Rate limited, will retry later`,
                );
            } else {
                this.log.error(`Playlist error: ${err} at offset ${offset}`);
            }
            return { items: [], next: null };
        }
    }

    getSelectedDevice(deviceData: { lastSelectDeviceId: string; lastActiveDeviceId: string }): string {
        if (deviceData.lastSelectDeviceId === '') {
            return deviceData.lastActiveDeviceId;
        }
        return deviceData.lastSelectDeviceId;
    }

    cleanState(str: string): string {
        str = str.replace(/:/g, ' ');
        str = str.replace(/;/g, ' ');
        let old;
        do {
            old = str;
            str = str.replace('  ', ' ');
        } while (old !== str);
        return str.trim();
    }

    async getPlaylistTracks(
        owner: string,
        id: string,
    ): Promise<{
        stateString: string;
        listString: string;
        listNumber: string;
        trackIdMap: string;
        trackIds: string;
        songs: any[];
    }> {
        const playlistObject = {
            stateString: '',
            listString: '',
            listNumber: '',
            trackIdMap: '',
            trackIds: '',
            songs: [] as any[],
        };
        let offset = 0;
        const regParam = `${owner}/playlists/${id}/tracks`;

        while (true) {
            const query = {
                limit: 50,
                offset: offset,
            };
            try {
                // Wait 1s between Playlist updates to avoid getting rate limited
                await new Promise(resolve => setTimeout(resolve, 1000));
                const data = await this.sendRequest(`/v1/users/${regParam}?${querystring.stringify(query)}`, 'GET', '');
                let i = offset;
                const no = i.toString();
                data.items.forEach((item: any) => {
                    const trackId = this.loadOrDefault<string>(item, 'track.id', '');
                    if (isEmpty(trackId)) {
                        return this.log.debug(
                            `There was a playlist track ignored because of missing id; playlist: ${id}; track no: ${no}`,
                        );
                    }
                    const artist = this.getArtistNamesOrDefault(item, 'track.artists');
                    const artistArray = this.getArtistArrayOrDefault(item, 'track.artists');
                    const trackName = this.loadOrDefault<string>(item, 'track.name', '');
                    const trackDuration = this.loadOrDefault<string>(item, 'track.duration_ms', '');
                    const addedAt = this.loadOrDefault<string>(item, 'addedAt', '');
                    const addedBy = this.loadOrDefault<string>(item, 'addedBy', '');
                    const trackAlbumId = this.loadOrDefault<string>(item, 'track.album.id', '');
                    const trackAlbumName = this.loadOrDefault<string>(item, 'track.album.name', '');
                    const trackDiscNumber = this.loadOrDefault<number>(item, 'track.disc_number', 1);
                    const trackEpisode = this.loadOrDefault<boolean>(item, 'track.episode', false);
                    const trackExplicit = this.loadOrDefault<boolean>(item, 'track.explicit', false);
                    const trackPopularity = this.loadOrDefault<number>(item, 'track.popularity', 0);
                    if (playlistObject.songs.length > 0) {
                        playlistObject.stateString += ';';
                        playlistObject.listString += ';';
                        playlistObject.trackIdMap += ';';
                        playlistObject.trackIds += ';';
                        playlistObject.listNumber += ';';
                    }
                    playlistObject.stateString += `${no}:${this.cleanState(trackName)} - ${this.cleanState(artist)}`;
                    playlistObject.listString += `${this.cleanState(trackName)} - ${this.cleanState(artist)}`;
                    playlistObject.trackIdMap += this.cleanState(trackId);
                    playlistObject.trackIds += `${no}:${this.cleanState(trackId)}`;
                    playlistObject.listNumber += no;
                    const a = {
                        id: trackId,
                        title: trackName,
                        artistName: artist,
                        artistArray: artistArray,
                        album: { id: trackAlbumId, name: trackAlbumName },
                        durationMs: trackDuration,
                        duration: this.convertToDigiClock(parseFloat(trackDuration)),
                        addedAt: addedAt,
                        addedBy: addedBy,
                        discNumber: trackDiscNumber,
                        episode: trackEpisode,
                        explicit: trackExplicit,
                        popularity: trackPopularity,
                    };
                    playlistObject.songs.push(a);
                    i++;
                });
                if (offset + 50 < data.total) {
                    offset += 50;
                } else {
                    break;
                }
                //.catch(err => this.log.warn('error on load tracks: ' + err));
            } catch (err) {
                if (err.toString().includes('403')) {
                    this.log.debug(`playlist tracks access denied (403) owner: ${owner} id: ${id}`);
                } else {
                    this.log.warn(`error on load tracks(getPlaylistTracks): ${err} owner: ${owner} id: ${id}`);
                }
                break;
            }
        }
        return playlistObject;
    }

    async reloadDevices(data: any): Promise<void> {
        const addedList = await this.createDevices(data);
        if (this.application.deleteDevices) {
            await this.deleteDevices(addedList);
        } else {
            await this.disableDevices(addedList);
        }
        await this.refreshDeviceList();
    }

    disableDevices(addedList: string[]): Promise<(void | undefined)[]> {
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn = (key: string): Promise<void> | undefined => {
            key = removeNameSpace(key);
            let found = false;
            if (addedList) {
                for (let i = 0; i < addedList.length; i++) {
                    if (key.startsWith(addedList[i])) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found && key.endsWith('.isAvailable')) {
                return cache.setValue(key, false);
            }
        };
        return Promise.all(keys.map(fn).filter((p): p is Promise<void> => p !== undefined));
    }

    deleteDevices(addedList: string[]): Promise<(void | undefined)[]> {
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn = (key: string): Promise<void> | undefined => {
            key = removeNameSpace(key);
            let found = false;
            if (addedList) {
                for (let i = 0; i < addedList.length; i++) {
                    if (key.startsWith(addedList[i])) {
                        found = true;
                        break;
                    }
                }
            }

            if (
                !found &&
                key !== 'devices.deviceList' &&
                key !== 'devices.deviceListIds' &&
                key !== 'devices.deviceListString' &&
                key !== 'devices.availableDeviceListIds' &&
                key !== 'devices.availableDeviceListString'
            ) {
                return cache.delObject(key).then(() => {
                    if (key.endsWith('.id')) {
                        return cache.delObject(key.substring(0, key.length - 3));
                    }
                });
            }
        };
        return Promise.all(keys.map(fn).filter((p): p is Promise<void> => p !== undefined));
    }

    getIconByType(type: string): string {
        if (type === 'Computer') {
            return 'icons/computer_black.png';
        } else if (type === 'Smartphone') {
            return 'icons/smartphone_black.png';
        }
        // Speaker
        return 'icons/speaker_black.png';
    }

    async createDevices(data: {
        devices: {
            id: string;
            is_active: boolean;
            is_restricted: boolean;
            name: string;
            type: string;
            volume_percent: number;
        }[];
    }): Promise<string[]> {
        if (!data?.devices) {
            data = { devices: [] };
        }
        const addedList: string[] = [];
        const fn = async (device: {
            id: string;
            is_active: boolean;
            is_restricted: boolean;
            name: string;
            type: string;
            volume_percent: number;
        }): Promise<void> => {
            const deviceId = this.loadOrDefault<string>(device, 'id', '');
            const deviceName = this.loadOrDefault<string>(device, 'name', '');
            if (isEmpty(deviceName)) {
                this.log.warn('empty device name');
                return Promise.reject(new Error('empty device name'));
            }
            let name: string;
            if (deviceId != null) {
                name = this.shrinkStateName(deviceId);
            } else {
                name = this.shrinkStateName(deviceName);
            }
            const prefix = `devices.${name}`;
            addedList.push(prefix);

            const isRestricted = this.loadOrDefault<boolean>(device, 'is_restricted', false);
            let useForPlayback;
            if (!isRestricted) {
                useForPlayback = cache.setValue(`${prefix}.useForPlayback`, false, {
                    _id: `${this.namespace}.${prefix}.useForPlayback`,
                    type: 'state',
                    common: {
                        name: 'press to use device for playback (only for non restricted devices)',
                        type: 'boolean',
                        role: 'button',
                        read: false,
                        write: true,
                        icon: 'icons/play_black.png',
                    },
                    native: {},
                });
            } else {
                useForPlayback = cache.delObject(`${prefix}.useForPlayback`);
            }
            await Promise.all([
                cache.setValue(prefix, null, {
                    _id: `${this.namespace}.${prefix}`,
                    type: 'device',
                    common: {
                        name: deviceName,
                        icon: this.getIconByType(this.loadOrDefault<string>(device, 'type', 'Computer')),
                    },
                    native: {},
                }),
                this.createOrDefault(device, 'id', `${prefix}.id`, '', 'device id', 'string'),
                this.createOrDefault(
                    device,
                    'is_active',
                    `${prefix}.isActive`,
                    false,
                    'current active device',
                    'boolean',
                ),
                this.createOrDefault(
                    device,
                    'is_restricted',
                    `${prefix}.isRestricted`,
                    false,
                    'it is not possible to control restricted devices with the adapter',
                    'boolean',
                ),
                this.createOrDefault(device, 'name', `${prefix}.name`, '', 'device name', 'string'),
                this.createOrDefault(device, 'type', `${prefix}.type`, 'Speaker', 'device type', 'string', {
                    Computer: 'Computer',
                    Smartphone: 'Smartphone',
                    Speaker: 'Speaker',
                }),
                this.createOrDefault(device, 'volume_percent', `${prefix}.volume`, '', 'volume in percent', 'number'),
                cache.setValue(`${prefix}.isAvailable`, true, {
                    _id: `${this.namespace}.${prefix}.isAvailable`,
                    type: 'state',
                    common: {
                        name: 'can used for playing',
                        type: 'boolean',
                        role: 'value',
                        read: true,
                        write: false,
                    },
                    native: {},
                }),
                useForPlayback,
            ]);
        };
        await Promise.all(data.devices.map(fn));
        return addedList;
    }

    async refreshPlaylistList(): Promise<void> {
        const a: { id: string; name: string; your: string }[] = [];
        const states = cache.getValues('playlists.*');
        const keys = Object.keys(states);
        const fn = (key: string): void => {
            if (!states[key] || !key.endsWith('.name')) {
                return;
            }
            const normKey = removeNameSpace(key);
            const id = normKey.substring(10, normKey.length - 5);
            const owner = cache.getValue(`playlists.${id}.owner`) as any;
            a.push({
                id: id,
                name: states[key].val as string,
                your: this.application.userId === owner ? owner.val : '',
            });
        };

        keys.forEach(fn);
        await Promise.resolve();
        const stateList: Record<string, string> = {};
        let listIds = '';
        let listString = '';
        let yourIds = '';
        let yourString = '';
        for (let i = 0, len = a.length; i < len; i++) {
            const normId = a[i].id;
            const normName = this.cleanState(a[i].name);
            if (listIds.length > 0) {
                listIds += ';';
                listString += ';';
            }
            stateList[normId] = normName;
            listIds += normId;
            listString += normName;
            if (a[i].your) {
                if (yourIds.length > 0) {
                    yourIds += ';';
                    yourString += ';';
                }
                yourIds += normId;
                yourString += normName;
            }
        }
        await Promise.all([
            this.setObjectStatesIfChanged('playlists.playlistList', stateList),
            cache.setValue('playlists.playlistListIds', listIds),
            cache.setValue('playlists.playlistListString', listString),
            cache.setValue('playlists.yourPlaylistListIds', yourIds),
            cache.setValue('playlists.yourPlaylistListString', yourString),
        ]);
        const id = cache.getValue('player.playlist.id')?.val;
        if (id) {
            const owner = cache.getValue('player.playlist.owner')?.val;
            if (owner) {
                await cache.setValue('playlists.playlistList', `${owner}-${id}`);
            }
        }
    }

    async refreshDeviceList(): Promise<void> {
        const a: { id: string; name: string; available: boolean }[] = [];
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn = (key: string): void => {
            if (!states[key] || !key.endsWith('.name')) {
                return;
            }
            const normKey = removeNameSpace(key);
            const id = normKey.substring(8, normKey.length - 5);
            const available = cache.getValue(`devices.${id}.isAvailable`);
            a.push({
                id,
                name: states[key].val as string,
                available: !!available?.val,
            });
        };

        let activeDevice = false;
        keys.forEach(fn);
        await Promise.resolve();
        const stateList: Record<string, string> = {};
        let listIds = '';
        let listString = '';
        let availableIds = '';
        let availableString = '';
        for (let i = 0, len = a.length; i < len; i++) {
            const normId = a[i].id;
            const normName = this.cleanState(a[i].name);
            if (listIds.length > 0) {
                listIds += ';';
                listString += ';';
            }
            stateList[normId] = normName;
            listIds += normId;
            listString += normName;
            if (a[i].available) {
                if (availableIds.length > 0) {
                    availableIds += ';';
                    availableString += ';';
                }
                availableIds += normId;
                availableString += normName;
            }
        }
        await Promise.all([
            this.setObjectStatesIfChanged('devices.deviceList', stateList),
            cache.setValue('devices.deviceListIds', listIds),
            cache.setValue('devices.deviceListString', listString),
            cache.setValue('devices.availableDeviceListIds', availableIds),
            cache.setValue('devices.availableDeviceListString', availableString),
        ]);
        const states1 = cache.getValues('devices.*');
        const keys1 = Object.keys(states1);
        const fn1 = (key: string): Promise<void> | undefined => {
            if (!key.endsWith('.isActive')) {
                return;
            }
            const val = states1[key]?.val;
            if (val) {
                key = removeNameSpace(key);
                const id = key.substring(8, key.length - 9);
                activeDevice = true;
                return cache.setValue('devices.deviceList', id);
            }
        };
        await Promise.all(keys1.map(fn1).filter((p): p is Promise<void> => p !== undefined));
        if (!activeDevice) {
            await Promise.all([
                cache.setValue('devices.deviceList', ''),
                cache.setValue('player.device.id', ''),
                cache.setValue('player.device.name', ''),
                cache.setValue('player.device.type', ''),
                cache.setValue('player.device.volume', 100),
                cache.setValue('player.device.isActive', false),
                cache.setValue('player.device.isAvailable', false),
                cache.setValue('player.device.isRestricted', false),
                cache.setValue('player.device', null, {
                    _id: `${this.namespace}.player.device`,
                    type: 'device',
                    common: {
                        name: 'Commands to control playback related to the current active device',
                        icon: this.getIconByType(''),
                    },
                    native: {},
                }),
            ]);
        }
        await this.listenOnHtmlDevices();
    }

    generateRandomString(length: number): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    async getToken(): Promise<void> {
        const tokenData = new URLSearchParams();
        tokenData.append('grant_type', 'authorization_code');
        tokenData.append('code', this.application.code);
        tokenData.append('redirect_uri', this.application.redirect_uri);

        const options = {
            url: 'https://accounts.spotify.com/api/token',
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${this.application.clientId}:${this.application.clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            data: tokenData.toString(),
        };

        this.log.debug(`Sending token request to Spotify with code: ${this.application.code.substring(0, 20)}...`);

        let tokenObj: any;

        try {
            const response = await this.request(options);
            const data = response.data;
            let parsedBody;
            try {
                parsedBody = typeof data === 'string' ? JSON.parse(data) : data;
            } catch (e) {
                parsedBody = {};
                this.log.info(`Error: ${e}`);
            }
            this.log.debug(`Spotify token response received`);
            tokenObj = await this.saveToken(parsedBody);
            await Promise.all([
                cache.setValue('authorization.authorizationUrl', ''),
                cache.setValue('authorization.authorizationReturnUri', ''),
                cache.setValue('authorization.authorized', true),
                cache.setValue('info.connection', true),
            ]);
            this.application.token = tokenObj.accessToken;
            this.application.refreshToken = tokenObj.refreshToken;
            this.scheduleTokenRefresh(this.getTokenExpiresAtMs(tokenObj), 'getToken');
            return await this.start();
        } catch (err) {
            this.log.error(`getToken error: ${err.message || err}`);
            if (err.response && err.response.data) {
                this.log.error(`Spotify API error: ${JSON.stringify(err.response.data)}`);
            }
        }
    }

    refreshToken(): Promise<any> {
        if (this.refreshTokenInFlight) {
            this.log.debug('Token refresh already running - reusing in-flight refresh request');
            return this.refreshTokenInFlight;
        }

        this.log.debug('token is requested again');
        const tokenData = new URLSearchParams();
        tokenData.append('grant_type', 'refresh_token');
        tokenData.append('refresh_token', this.application.refreshToken);

        const options = {
            url: 'https://accounts.spotify.com/api/token',
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${this.application.clientId}:${this.application.clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            data: tokenData.toString(),
        };

        if (this.application.refreshToken !== '') {
            this.refreshTokenInFlight = this.request(options)
                .then(async response => {
                    const statusCode =
                        typeof response.statusCode !== 'undefined' ? response.statusCode : response.status;
                    const body = typeof response.body !== 'undefined' ? response.body : response.data;
                    // this request gets the new token
                    if (statusCode === 200) {
                        this.log.debug('new token arrived');
                        let parsedJson: { access_token?: string; refresh_token?: string };
                        if (body && typeof body === 'object') {
                            parsedJson = body;
                        } else {
                            try {
                                parsedJson = body ? JSON.parse(body) : {};
                            } catch (e) {
                                this.log.error(`Error parsing token response: ${e}`);
                                parsedJson = {};
                            }
                        }
                        if (!parsedJson.hasOwnProperty.call(parsedJson, 'refresh_token')) {
                            parsedJson.refresh_token = this.application.refreshToken;
                        }
                        this.log.debug('Token refresh successful');

                        try {
                            const tokenObj = await this.saveToken(parsedJson);
                            this.application.token = tokenObj.accessToken;
                            this.application.refreshToken = tokenObj.refreshToken;
                            this.scheduleTokenRefresh(this.getTokenExpiresAtMs(tokenObj), 'refreshToken');
                            this.log.debug('Token saved and updated in application state');
                            return tokenObj;
                        } catch (err) {
                            this.log.error(`Error saving token: ${err}`);
                            throw err instanceof Error ? err : new Error(String(err));
                        }
                    }
                    this.log.error(`Token refresh failed with status code: ${statusCode}`);
                    throw new Error(String(statusCode));
                })
                .catch(error => {
                    this.log.error(`Token refresh request failed: ${error.message || error}`);
                    if (error?.response) {
                        const responseData = error.response.data;
                        this.log.error(
                            `Token refresh response: ${typeof responseData === 'string' ? responseData : JSON.stringify(responseData)}`,
                        );
                    }
                    throw error instanceof Error ? error : new Error(String(error));
                })
                .finally(() => {
                    this.refreshTokenInFlight = null;
                });

            return this.refreshTokenInFlight;
        }

        this.log.warn('Cannot refresh token: no refresh token available');
        return Promise.reject(new Error('no refresh token'));
    }

    async saveToken(data: { access_token?: string; refresh_token?: string }): Promise<TokenObject> {
        this.log.debug('saveToken');
        if ('undefined' !== typeof data.access_token && 'undefined' !== typeof data.refresh_token) {
            const expiresInSec = Number(this.loadOrDefault<number>(data, 'expires_in', 0)) || 3600;
            const expiresAtMs = Date.now() + expiresInSec * 1000;
            const token: TokenObject = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                clientId: this.application.clientId,
                clientSecret: this.application.clientSecret,
                expiresInSec,
                expiresAtMs,
            };
            await cache.setValue('authorization.token', JSON.stringify(token));
            return token;
        }
        this.log.error(JSON.stringify(data));
        return Promise.reject(new Error('no tokens found in server response'));
    }

    async increaseTime(durationMs: number, progressMs: number, startDate: number, count: number): Promise<void> {
        const now = Date.now();
        count--;
        progressMs += now - startDate;
        const tDurationMs = cache.getValue('player.durationMs')?.val;
        const percentage = Math.floor((progressMs / ((tDurationMs as number) || 1)) * 100);

        // Only update states if values have actually changed
        const updates = [];

        const currentProgress = cache.getValue('player.progress')?.val;
        const newProgress = this.convertToDigiClock(progressMs);
        if (currentProgress !== newProgress) {
            updates.push(cache.setValue('player.progress', newProgress));
        }

        const currentProgressMs = cache.getValue('player.progressMs')?.val;
        if (currentProgressMs !== progressMs) {
            updates.push(cache.setValue('player.progressMs', progressMs));
        }

        const currentPercentage = cache.getValue('player.progressPercentage')?.val;
        if (currentPercentage !== percentage) {
            updates.push(cache.setValue('player.progressPercentage', percentage));
        }

        // If no updates needed, just schedule next update if playing
        if (!updates.length) {
            await Promise.resolve();
            if (count > 0) {
                if (progressMs + 1000 > durationMs) {
                    setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
                } else {
                    const state = cache.getValue('player.isPlaying');
                    if (state?.val) {
                        this.scheduleStatusInternalTimer(durationMs, progressMs, now, count);
                    }
                }
            }
        }

        await Promise.all(updates);
        if (count > 0) {
            if (progressMs + 1000 > durationMs) {
                setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
            } else {
                const state = cache.getValue('player.isPlaying');
                if (state?.val) {
                    this.scheduleStatusInternalTimer(durationMs, progressMs, now, count);
                }
            }
        }
    }

    scheduleStatusInternalTimer(durationMs: number, progressMs: number, startDate: number, count: number): void {
        clearTimeout(this.application.statusInternalTimer);
        this.application.statusInternalTimer = setTimeout(
            () => !this.stopped && this.increaseTime(durationMs, progressMs, startDate, count),
            1000,
        );
    }

    scheduleStatusPolling(): void {
        clearTimeout(this.application.statusPollingHandle);
        if (this.application.statusPollingDelaySeconds > 0) {
            // Status polling has no offset (base timing)
            this.application.statusPollingHandle = setTimeout(
                () => !this.stopped && this.pollStatusApi(),
                this.application.statusPollingDelaySeconds * 1000,
            );
        }
    }

    async pollStatusApi(noReschedule?: boolean): Promise<void> {
        if (!noReschedule) {
            clearTimeout(this.application.statusInternalTimer);
        }
        this.log.debug('call status polling');
        try {
            const data = await this.sendRequest('/v1/me/player', 'GET', '');
            void this.createPlaybackInfo(data);
            if (!noReschedule) {
                this.scheduleStatusPolling();
            }
        } catch (err) {
            const errStr = err.toString();
            if (!errStr.includes('202')) {
                this.application.error202shown = false;
            }
            if (
                errStr.includes('429') ||
                errStr.includes('202') ||
                errStr.includes('401') ||
                errStr.includes('500') ||
                errStr.includes('502') ||
                errStr.includes('503') ||
                errStr.includes('504')
            ) {
                if (errStr.includes('202')) {
                    if (!this.application.error202shown) {
                        this.log.debug(
                            'unexpected api response http 202; continue polling; nothing is wrong with the adapter; you will see a 202 response the first time a user connects to the spotify connect api or when the device is temporarily unavailable',
                        );
                    }
                    this.application.error202shown = true;
                } else if (errStr.includes('429')) {
                    this.log.debug('We are currently being rate limited, waiting for next update ...');
                } else {
                    this.log.warn(`unexpected api response http ${err}; continue polling`);
                }
                // 202, 401 and 502 keep the polling running
                const dummyBody = {
                    is_playing: false,
                };
                // occurs when no player is open
                void this.createPlaybackInfo(dummyBody);
                if (!noReschedule) {
                    this.scheduleStatusPolling();
                }
            } else {
                // other errors stop the polling
                this.log.error(`spotify status polling stopped with error ${err}`);
            }
        }
    }

    scheduleDevicePollingWithOffset(): void {
        clearTimeout(this.application.devicePollingHandle);
        if (this.application.devicePollingDelaySeconds > 0) {
            // Device polling offset: 1/3 of status interval (stagger from status)
            const offsetMs = (this.application.statusPollingDelaySeconds * 1000) / 3;
            this.application.devicePollingHandle = setTimeout(
                () => !this.stopped && this.pollDeviceApi(),
                this.application.devicePollingDelaySeconds * 1000 + offsetMs,
            );
        }
    }

    scheduleDevicePolling(): void {
        clearTimeout(this.application.devicePollingHandle);
        if (this.application.devicePollingDelaySeconds > 0) {
            this.application.devicePollingHandle = setTimeout(
                () => !this.stopped && this.pollDeviceApi(),
                this.application.devicePollingDelaySeconds * 1000,
            );
        }
    }

    async pollDeviceApi(): Promise<void> {
        clearTimeout(this.application.deviceInternalTimer);
        this.log.debug('call device polling');
        try {
            const data = await this.sendRequest('/v1/me/player/devices', 'GET', '');
            await this.reloadDevices(data);
            this.scheduleDevicePollingWithOffset();
        } catch (err) {
            const errStr = err.toString();
            if (
                errStr.includes('401') ||
                errStr.includes('429') ||
                errStr.includes('500') ||
                errStr.includes('502') ||
                errStr.includes('503') ||
                errStr.includes('504')
            ) {
                // Keep polling running for temporary errors
                if (errStr.includes('401')) {
                    this.log.warn(
                        'Device polling: 401 Unauthorized - token refresh should be in progress, continuing polling',
                    );
                } else if (errStr.includes('429')) {
                    this.log.debug('Device polling: Rate limited (429), will retry');
                } else {
                    this.log.warn(`Device polling: Temporary error ${err}, continuing polling`);
                }
                this.scheduleDevicePolling();
            } else {
                this.log.error(`spotify device polling stopped with error ${err}`);
            }
        }
    }

    schedulePlaylistPolling(): void {
        clearTimeout(this.application.playlistPollingHandle);
        if (this.application.playlistPollingDelaySeconds > 0) {
            this.application.playlistPollingHandle = setTimeout(
                () => !this.stopped && this.pollPlaylistApi(),
                this.application.playlistPollingDelaySeconds * 1000,
            );
        }
    }

    pollPlaylistApi(): void {
        clearTimeout(this.application.playlistInternalTimer);
        void this.reloadUsersPlaylist();
        this.schedulePlaylistPolling();
    }

    async startPlaylist(playlist: string, owner: string, trackNo: number, keepTrack?: boolean): Promise<void> {
        if (isEmpty(owner)) {
            owner = this.application.userId;
        }
        if (isEmpty(trackNo)) {
            return Promise.reject(new Error('no track no'));
        }
        if (isEmpty(playlist)) {
            return Promise.reject(new Error('no playlist no'));
        }
        if (keepTrack !== true) {
            keepTrack = false;
        }
        let resetShuffle = false;
        if (this.application.keepShuffleState) {
            const state = cache.getValue('player.shuffle');
            if (state?.val) {
                resetShuffle = true;
                if (!keepTrack) {
                    const tracksTotal = cache.getValue(
                        `playlists.${this.shrinkStateName(`${owner}-${playlist}`)}.tracksTotal`,
                    );
                    if (tracksTotal?.val) {
                        trackNo = Math.floor(Math.random() * Math.floor(tracksTotal.val as number));
                    }
                }
            }
        }

        const send = {
            context_uri: `spotify:user:${owner}:playlist:${playlist}`,
            offset: {
                position: trackNo,
            },
        };
        try {
            await this.sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), true);
            setTimeout(() => !this.stopped && this.pollStatusApi(), 1000, true);
        } catch (err) {
            this.log.error(`could not start playlist ${playlist} of user ${owner}; error: ${err}`);
        }
        if (this.application.keepShuffleState && resetShuffle) {
            if (this.config.defaultShuffle === 'off') {
                return this.listenOnShuffleOff();
            }
            return this.listenOnShuffleOn();
        }
    }

    listenOnAuthorizationReturnUri(obj: any): Promise<void> {
        const state = cache.getValue('authorization.state');
        const returnUri: any = querystring.parse(
            obj.state.val.slice(obj.state.val.search(/\?/) + 1, obj.state.val.length),
        );
        if ('undefined' !== typeof returnUri.state) {
            returnUri.state = returnUri.state.replace(/#_=_$/g, '');
        }
        if (state && returnUri.state === state.val) {
            this.log.debug('getToken');
            this.application.code = returnUri.code;
            return this.getToken();
        }
        this.log.error('invalid session. you need to open the actual authorization.authorizationUrl');
        return cache.setValue(
            'Authorization.Authorization_Return_URI',
            'invalid session. You need to open the actual Authorization.Authorization_URL again',
        );
    }

    listenOnGetAuthorization(): Promise<void[]> {
        this.log.debug('requestAuthorization');
        const state = this.generateRandomString(20);
        const query = {
            client_id: this.application.clientId,
            response_type: 'code',
            redirect_uri: this.application.redirect_uri,
            state: state,
            scope: 'user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative',
        };

        const options = {
            url: `https://accounts.spotify.com/de/authorize/?${querystring.stringify(query)}`,
            method: 'GET',
            followAllRedirects: true,
        };

        return Promise.all([
            cache.setValue('authorization.state', state),
            cache.setValue('authorization.authorizationUrl', options.url),
            cache.setValue('authorization.authorized', false),
            cache.setValue('info.connection', false),
        ]);
    }

    listenOnAuthorized(obj: any): void {
        if (obj.state.val === true) {
            // Stagger initial poll schedules to prevent simultaneous requests from causing rate limiting
            // Status polling starts immediately
            this.scheduleStatusPolling();
            // Device polling starts after small offset (~1/3 of status interval)
            const deviceOffset = (this.application.statusPollingDelaySeconds * 1000) / 3;
            setTimeout(() => !this.stopped && this.scheduleDevicePolling(), deviceOffset);
            // Playlist polling starts after larger offset (~2/3 of status interval)
            const playlistOffset = (this.application.statusPollingDelaySeconds * 1000 * 2) / 3;
            setTimeout(() => !this.stopped && this.schedulePlaylistPolling(), playlistOffset);
        }
    }

    async listenOnUseForPlayback(obj: any): Promise<void> {
        const lastDeviceId = cache.getValue(`${obj.id.slice(0, obj.id.lastIndexOf('.'))}.id`);
        if (!lastDeviceId) {
            return;
        }
        this.deviceData.lastSelectDeviceId = lastDeviceId.val as string;
        const send = {
            device_ids: [this.deviceData.lastSelectDeviceId],
            play: true,
        };
        try {
            await this.sendRequest('/v1/me/player', 'PUT', JSON.stringify(send), true);
            setTimeout(() => !this.stopped && this.pollStatusApi(), 1000, true);
        } catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
    }

    listenOnTrackList(obj: any): void {
        if (obj.state.val >= 0) {
            void this.listenOnPlayThisList(obj, obj.state.val);
        }
    }

    listenOnPlayThisList(obj: { id: string }, pos?: number): Promise<void> | undefined {
        let keepTrack = true;
        if (typeof pos !== 'number') {
            keepTrack = false;
            pos = 0;
        }
        // Play a specific playlist immediately
        const idState = cache.getValue(`${obj.id.slice(0, obj.id.lastIndexOf('.'))}.id`);
        const ownerState = cache.getValue(`${obj.id.slice(0, obj.id.lastIndexOf('.'))}.owner`);
        if (!idState || !ownerState) {
            return;
        }
        const id = idState.val;
        const owner = ownerState.val;
        return this.startPlaylist(id as string, owner as string, pos, keepTrack);
    }

    listenOnDeviceList(obj: any): void {
        if (!isEmpty(obj.state.val)) {
            void this.listenOnUseForPlayback({ id: `devices.${obj.state.val}.useForPlayback` });
        }
    }

    listenOnPlaylistList(obj: any): void {
        if (!isEmpty(obj.state.val)) {
            void this.listenOnPlayThisList({ id: `playlists.${obj.state.val}.playThisList` });
        }
    }

    async listenOnPlayUri(obj: any): Promise<void> {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };

        const send = obj.state.val;
        if (!isEmpty(send.device_id)) {
            query.device_id = send.device_id;
            delete send.device_id;
        }

        clearTimeout(this.application.statusInternalTimer);
        try {
            await this.sendRequest(
                `/v1/me/player/play?${querystring.stringify(query)}`,
                'PUT',
                JSON.stringify(send),
                true,
            );
        } catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
    }

    listenOnPlay(): void {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        this.log.debug(this.getSelectedDevice(this.deviceData));
        clearTimeout(this.application.statusInternalTimer);
        void this.sendRequest(`/v1/me/player/play?${querystring.stringify(query)}`, 'PUT', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }

    listenOnPause(): void {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        clearTimeout(this.application.statusInternalTimer);
        void this.sendRequest(`/v1/me/player/pause?${querystring.stringify(query)}`, 'PUT', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }

    listenOnSkipPlus(): void {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        clearTimeout(this.application.statusInternalTimer);
        void this.sendRequest(`/v1/me/player/next?${querystring.stringify(query)}`, 'POST', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }

    listenOnSkipMinus(): void {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        clearTimeout(this.application.statusInternalTimer);
        void this.sendRequest(`/v1/me/player/previous?${querystring.stringify(query)}`, 'POST', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }

    listenOnRepeat(obj: any): void {
        if (['track', 'context', 'off'].indexOf(obj.state.val) >= 0) {
            clearTimeout(this.application.statusInternalTimer);
            void this.sendRequest(`/v1/me/player/repeat?state=${obj.state.val}`, 'PUT', '', true)
                .catch(err => this.log.error(`could not execute command: ${err}`))
                .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
        }
    }

    listenOnRepeatTrack(): void {
        this.listenOnRepeat({
            state: {
                val: 'track',
            },
        });
    }

    listenOnRepeatContext(): void {
        this.listenOnRepeat({
            state: {
                val: 'context',
            },
        });
    }

    listenOnRepeatOff(): void {
        this.listenOnRepeat({
            state: {
                val: 'off',
            },
        });
    }

    listenOnVolume(obj: any): void {
        const isPlay = cache.getValue('player.isPlaying');
        if (isPlay?.val) {
            if (this.application.statusInternalTimer) {
                clearTimeout(this.application.statusInternalTimer);
                this.application.statusInternalTimer = undefined;
            }
            void this.sendRequest(`/v1/me/player/volume?volume_percent=${obj.state.val}`, 'PUT', '', true)
                .catch(err => this.log.error(`could not execute command: ${err}`))
                .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
        }
    }

    listenOnProgressMs(obj: any): void {
        const progress = obj.state.val;
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }

        void this.sendRequest(`/v1/me/player/seek?position_ms=${progress}`, 'PUT', '', true)
            .then(() => {
                const durationState = cache.getValue('player.durationMs') as any;
                if (durationState) {
                    const duration = durationState.val;

                    if (duration > 0 && duration <= progress) {
                        const progressPercentage = Math.floor((progress / duration) * 100);
                        return Promise.all([
                            cache.setValue('player.progressMs', progress),
                            cache.setValue('player.progress', this.convertToDigiClock(progress)),
                            cache.setValue('player.progressPercentage', progressPercentage),
                        ]);
                    }
                }
            })
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }

    listenOnProgressPercentage(obj: any): void {
        const progressPercentage = obj.state.val;
        if (progressPercentage < 0 || progressPercentage > 100) {
            return;
        }
        clearTimeout(this.application.statusInternalTimer);
        const durationState = cache.getValue('player.durationMs');
        if (durationState) {
            const duration = durationState.val;
            if ((duration as number) > 0) {
                const progress = Math.floor((progressPercentage / 100) * (duration as number));
                void this.sendRequest(`/v1/me/player/seek?position_ms=${progress}`, 'PUT', '', true)
                    .then(() =>
                        Promise.all([
                            cache.setValue('player.progressMs', progress),
                            cache.setValue('player.progress', this.convertToDigiClock(progress)),
                            cache.setValue('player.progressPercentage', progressPercentage),
                        ]),
                    )
                    .catch(err => this.log.error(`could not execute command: ${err}`))
                    .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
            }
        }
    }

    async listenOnShuffle(obj: any): Promise<void> {
        clearTimeout(this.application.statusInternalTimer);
        try {
            await this.sendRequest(
                `/v1/me/player/shuffle?state=${obj.state.val === 'on' ? 'true' : 'false'}`,
                'PUT',
                '',
                true,
            );
        } catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
    }

    listenOnShuffleOff(): Promise<void> {
        return this.listenOnShuffle({
            state: {
                val: 'off',
                ack: false,
            },
        });
    }

    listenOnShuffleOn(): Promise<void> {
        return this.listenOnShuffle({
            state: {
                val: 'on',
                ack: false,
            },
        });
    }

    listenOnTrackId(obj: any): void {
        const send = {
            uris: [`spotify:track:${obj.state.val}`],
            offset: {
                position: 0,
            },
        };
        clearTimeout(this.application.statusInternalTimer);
        void this.sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }

    listenOnPlaylistId(obj: any): Promise<void> | undefined {
        const ownerState = cache.getValue('player.playlist.owner');
        if (!ownerState) {
            return;
        }
        return this.startPlaylist(obj.state.val, ownerState.val as string, 0);
    }

    listenOnPlaylistOwner(obj: any): Promise<void> | undefined {
        const PlayListIdState = cache.getValue('player.playlist.id');
        if (!PlayListIdState) {
            return;
        }
        return this.startPlaylist(PlayListIdState.val as string, obj.state.val, 0);
    }

    listenOnPlaylistTrackNo(obj: any): Promise<void> | undefined {
        const PlayListIdState = cache.getValue('player.playlist.id');
        const ownerState = cache.getValue('player.playlist.owner');
        if (!PlayListIdState || !ownerState) {
            return;
        }
        const owner = ownerState.val;
        const id = PlayListIdState.val;
        let o = obj.state.val;
        o = parseInt(o, 10) || 1;

        return this.startPlaylist(id as string, owner as string, o - 1, true);
    }

    listenOnGetPlaybackInfo(): Promise<void> {
        return this.pollStatusApi(true);
    }

    async listenOnGetDevices(): Promise<void> {
        try {
            const data = await this.sendRequest('/v1/me/player/devices', 'GET', '');
            await this.reloadDevices(data);
        } catch (error) {
            this.log.debug(error);
        }
    }

    clearCache(): void {
        this.artistImageUrlCache = {};
        this.playlistCache = {};
        this.application.cacheClearHandle = setTimeout(() => !this.stopped && this.clearCache(), 1000 * 60 * 60 * 24);
    }

    async listenOnHtmlPlaylists(): Promise<void> {
        const objCurrent = cache.getValue('playlists.playlistList');
        const current = (objCurrent?.val as string) || '';

        const objIds = cache.getValue('playlists.playlistListIds');
        if (!objIds?.val) {
            await cache.setValue('html.playlists', '');
            return;
        }
        const ids = (objIds.val as string).split(';');
        const objStrings = cache.getValue('playlists.playlistListString');
        if (!objStrings?.val) {
            await cache.setValue('html.playlists', '');
            return;
        }
        const strings = (objStrings.val as string).split(';');
        let html = '<table class="spotifyPlaylistsTable">';

        for (let i = 0; i < ids.length; i++) {
            let style = '';
            let cssClassRow = '';
            let cssClassTitle = '';
            let cssClassIcon = '';
            if (current === ids[i]) {
                style = ' style="color: #1db954; font-weight: bold"';
                cssClassRow = ' spotifyPlaylistsRowActive';
                cssClassTitle = ' spotifyPlaylistsColTitleActive';
                cssClassIcon = ' spotifyPlaylistsColIconActive';
            }
            html += `<tr class="spotifyPlaylistsRow${cssClassRow}" onclick="vis.setValue('${this.namespace}.playlists.playlistList', '${ids[i]}')">`;
            html += `<td${style} class="spotifyPlaylistsCol spotifyPlaylistsColTitle${cssClassTitle}">`;
            html += strings[i];
            html += '</td>';
            html += `<td class="spotifyPlaylistsCol spotifyPlaylistsColIcon${cssClassIcon}">`;
            if (current === ids[i]) {
                html +=
                    '<img style="width: 16px; height: 16px" class="spotifyPlaylistsColIconActive" src="widgets/spotify-premium/img/active_song_speaker_green.png" alt="cover" />';
            }
            html += '</td>';
            html += '</tr>';
        }

        html += '</table>';

        return cache.setValue('html.playlists', html);
    }

    listenOnHtmlTracklist(): void {
        void this.getStateAsync('player.trackId')
            .then(state => {
                let currentTrackID: string;
                if (!state?.val) {
                    currentTrackID = '';
                } else {
                    currentTrackID = state.val as string;
                }
                const obj = cache.getValue('player.playlist.trackListArray');
                if (!obj?.val) {
                    return cache.setValue('html.tracks', '');
                }
                let source: {
                    id: string;
                    title: string;
                    explicit: boolean;
                    artistName: string;
                    album: {
                        name: string;
                    };
                    duration: number;
                }[] = [];
                if (typeof obj.val === 'string') {
                    try {
                        source = JSON.parse(obj.val);
                    } catch (e) {
                        this.log.info(`Error: ${e}`);
                    }
                }

                let html = '<table class="spotifyTracksTable">';

                for (let i = 0; i < source.length; i++) {
                    if (!source[i]) {
                        continue;
                    }
                    let styleTitle = '';
                    let styleDuration = '';
                    let cssClassRow = '';
                    let cssClassColTitle = '';
                    let cssClassTitle = '';
                    let cssClassIcon = '';
                    let cssClassArtistAlbum = '';
                    let cssClassArtist = '';
                    let cssClassAlbum = '';
                    let cssClassExplicit = '';
                    let cssClassColDuration = '';
                    let cssClassSpace = '';
                    let cssClassLinebreak = '';
                    if (currentTrackID == source[i].id) {
                        styleTitle = ' style="color: #1db954; font-weight: bold"';
                        styleDuration = ' style="color: #1db954"';
                        cssClassRow = ' spotifyTracksRowActive';
                        cssClassColTitle = ' spotifyTracksColTitleActive';
                        cssClassTitle = ' spotifyTracksTitleActive';
                        cssClassIcon = ' spotifyTracksColIconActive';
                        cssClassArtistAlbum = ' spotifyTracksArtistAlbumActive';
                        cssClassArtist = ' spotifyTracksArtistActive';
                        cssClassAlbum = ' spotifyTracksAlbumActive';
                        cssClassExplicit = ' spotifyTracksExplicitActive';
                        cssClassColDuration = ' spotifyTracksColDurationActive';
                        cssClassSpace = ' spotifyTracksSpaceActive';
                        cssClassLinebreak = ' spotifyTracksLinebreakActive';
                    }

                    html += `<tr class="spotifyTracksRow${cssClassRow}" onclick="vis.setValue('${this.namespace}.player.playlist.trackList', ${i})">`;
                    html += `<td class="spotifyTracksColIcon${cssClassIcon}">`;
                    if (currentTrackID == source[i].id) {
                        html +=
                            '<img style="width: 16px; height: 16px" class="spotifyTracksIconActive" src="widgets/spotify-premium/img/active_song_speaker_green.png" />';
                    } else {
                        html +=
                            '<img style="width: 16px; height: 16px" class="spotifyTracksIconInactive" src="widgets/spotify-premium/img/inactive_song_note_white.png" />';
                    }
                    html += '</td>';
                    html += `<td${styleTitle} class="spotifyTracksColTitle${cssClassColTitle}">`;
                    html += `<span class="spotifyTracksTitle${cssClassTitle}">`;
                    html += source[i].title;
                    html += '</span>';
                    html += `<span class="spotifyTracksLinebreak${cssClassLinebreak}"><br /></span>`;
                    html += `<span class="spotifyTracksArtistAlbum${cssClassArtistAlbum}">`;
                    if (source[i].explicit) {
                        html += `<img style="width: auto; height: 16px" class="spotifyTracksExplicit${cssClassExplicit}" src="widgets/spotify-premium/img/explicit.png" />`;
                    }
                    html += `<span class="spotifyTracksArtist${cssClassArtist}">`;
                    html += source[i].artistName;
                    html += '</span>';
                    html += `<span class="spotifyTracksSpace${cssClassSpace}">&nbsp;&bull;&nbsp;</span>`;
                    html += `<span class="spotifyTracksAlbum${cssClassAlbum}">`;
                    html += source[i].album?.name || '--';
                    html += '</span></span></td>';
                    html += `<td${styleDuration} class="spotifyTracksColDuration${cssClassColDuration}">`;
                    html += source[i].duration;
                    html += '</td>';
                    html += '</tr>';
                }

                html += '</table>';

                return cache.setValue('html.tracks', html);
            })
            .catch(err => {
                this.log.error(err);
            });
    }

    async listenOnHtmlDevices(): Promise<void> {
        let obj = cache.getValue('devices.deviceList');
        let current;
        if (!obj?.val) {
            current = '';
        } else {
            current = obj.val;
        }
        obj = cache.getValue('devices.deviceListIds');
        if (!obj?.val) {
            await cache.setValue('html.devices', '');
            return;
        }
        const ids = (obj.val as string).split(';');
        obj = cache.getValue('devices.availableDeviceListString');
        if (!obj?.val) {
            await cache.setValue('html.devices', '');
            return;
        }
        const strings = (obj.val as string).split(';');
        let html = '<table class="spotifyDevicesTable">';

        for (let i = 0; i < ids.length; i++) {
            const typeState = cache.getValue(`devices.${ids[i]}.type`);
            if (!typeState) {
                continue;
            }
            const type = this.getIconByType(typeState.val as string);

            let style = '';
            let cssClassRow = '';
            let cssClassColName = '';
            let cssClassColIcon = '';
            if (current === ids[i]) {
                style = ' style="color: #1db954; font-weight: bold"';
                cssClassRow = ' spotifyDevicesRowActive';
                cssClassColName = ' spotifyDevicesColNameActive';
                cssClassColIcon = ' spotifyDevicesColIconActive';
            }
            html += `<tr class="spotifyDevicesRow${cssClassRow}" onclick="vis.setValue('${this.namespace}.devices.deviceList', '${ids[i]}')">`;
            html += `<td${style} class="spotifyDevicesColIcon${cssClassColIcon}">`;
            if (current === ids[i]) {
                html += `<img style="width: 16px; height: 16px" class="spotifyDevicesIconActive" src="widgets/spotify-premium/img/${type.replace('black', 'green').replace('icons/', '')}" />`;
            } else {
                html += `<img style="width: 16px; height: 16px" class="spotifyDevicesIcon" src="widgets/spotify-premium/img/${type.replace('icons/', '')}" />`;
            }
            html += '</td>';
            html += `<td${style} class="spotifyDevicesColName${cssClassColName}">`;
            html += strings[i];
            html += '</td>';
            html += '</tr>';
        }

        html += '</table>';

        void cache.setValue('html.devices', html);
    }
}

if (require.main !== module) {
    module.exports = (options?: Partial<AdapterOptions>): SpotifyPremiumAdapter => new SpotifyPremiumAdapter(options);
} else {
    new SpotifyPremiumAdapter();
}
