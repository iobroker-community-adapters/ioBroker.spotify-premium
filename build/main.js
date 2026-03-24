"use strict";
// import http from 'node:http';
// import url from 'node:url';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyPremiumAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const dns_lookup_cache_1 = require("dns-lookup-cache");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_querystring_1 = __importDefault(require("node:querystring"));
const adapter_core_1 = require("@iobroker/adapter-core");
const cache_1 = __importDefault(require("./lib/cache"));
const utils_1 = require("./lib/utils");
// Request queue to prevent rate limiting (429 errors)
class RequestQueue {
    queue = [];
    isProcessing = false;
    minDelayMs = 2500; // Minimum delay between requests in milliseconds (~0.4 req/sec = ~24 req/min, ultra-conservative for Spotify)
    add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }
    process() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }
        this.isProcessing = true;
        const item = this.queue.shift();
        const { fn, resolve, reject } = item;
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
function getErrorMessage(error) {
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
function isTransientNetworkError(error) {
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
    return (message.includes('EAI_AGAIN') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('ENOTFOUND') ||
        message.includes('EHOSTUNREACH') ||
        message.includes('ENETUNREACH') ||
        message.includes('SOCKET HANG UP') ||
        message.includes('TIMEOUT'));
}
class SpotifyPremiumAdapter extends adapter_core_1.Adapter {
    application = {
        userId: '',
        market: '',
        baseUrl: 'https://api.spotify.com',
        clientId: '',
        clientSecret: '',
        deleteDevices: false,
        deletePlaylists: false,
        keepShuffleState: true,
        redirect_uri: 'https://oauth2.iobroker.in/spotify',
        token: '',
        refreshToken: '',
        statusInternalTimer: undefined,
        statusPollingHandle: undefined,
        statusPollingDelaySeconds: 10,
        devicePollingHandle: undefined,
        devicePollingDelaySeconds: 300,
        playlistPollingHandle: undefined,
        playlistPollingDelaySeconds: 1800,
        error202shown: false,
        cacheClearHandle: undefined,
        lastTrackId: '',
        lastPlaylistId: '',
        tokenRefreshTimer: undefined,
    };
    artistImageUrlCache = {};
    playlistCache = {};
    inaccessiblePlaylists = new Set();
    deviceData = {
        lastActiveDeviceId: '',
        lastSelectDeviceId: '',
    };
    stopped = false;
    tooManyRequests = false;
    refreshTokenInFlight = null;
    requestQueue = new RequestQueue();
    cache = new cache_1.default(this);
    constructor(options = {}) {
        super({
            ...options,
            name: 'spotify-premium',
            stateChange: (id, state) => this.cache.setExternal(id, state),
            objectChange: (id, obj) => this.cache.setExternalObj(id, obj),
            ready: () => {
                // this.cache.on(
                //     'authorization.authorizationReturnUri',
                //     (obj: any) => this.listenOnAuthorizationReturnUri(obj),
                //     true,
                // );
                // this.cache.on('authorization.getAuthorization', () => this.listenOnGetAuthorization());
                this.cache.on('authorization.oauth2Tokens', (obj) => this.listenOnAuthorized(obj));
                this.cache.on(/\.useForPlayback$/, (obj) => this.listenOnUseForPlayback(obj));
                this.cache.on(/\.trackList$/, (obj) => this.listenOnTrackList(obj), true);
                this.cache.on(/\.playThisList$/, (obj) => this.listenOnPlayThisList(obj));
                this.cache.on('devices.deviceList', (obj) => this.listenOnDeviceList(obj), true);
                this.cache.on('playlists.playlistList', (obj) => this.listenOnPlaylistList(obj), true);
                this.cache.on('player.play', () => this.listenOnPlay());
                this.cache.on('player.playUri', (obj) => this.listenOnPlayUri(obj));
                this.cache.on('player.pause', () => this.listenOnPause());
                this.cache.on('player.skipPlus', () => this.listenOnSkipPlus());
                this.cache.on('player.skipMinus', () => this.listenOnSkipMinus());
                this.cache.on('player.repeat', (obj) => this.listenOnRepeat(obj), true);
                this.cache.on('player.repeatMode', (obj) => this.listenOnRepeatMode(obj), true);
                this.cache.on('player.repeatTrack', () => this.listenOnRepeatTrack());
                this.cache.on('player.repeatContext', () => this.listenOnRepeatContext());
                this.cache.on('player.repeatOff', () => this.listenOnRepeatOff());
                this.cache.on('player.volume', (obj) => this.listenOnVolume(obj), true);
                this.cache.on('player.progressMs', (obj) => this.listenOnProgressMs(obj), true);
                this.cache.on('player.progressPercentage', (obj) => this.listenOnProgressPercentage(obj), true);
                this.cache.on('player.shuffle', (obj) => this.listenOnShuffle(obj), this.config.defaultShuffle || 'on');
                this.cache.on('player.shuffleBool', (obj) => this.listenOnShuffleBool(obj), true);
                this.cache.on('player.shuffleOff', () => this.listenOnShuffleOff());
                this.cache.on('player.shuffleOn', () => this.listenOnShuffleOn());
                this.cache.on('player.trackId', (obj) => this.listenOnTrackId(obj), true);
                this.cache.on('player.playlist.id', (obj) => this.listenOnPlaylistId(obj), true);
                this.cache.on('player.playlist.owner', (obj) => this.listenOnPlaylistOwner(obj), true);
                this.cache.on('player.playlist.trackNo', (obj) => this.listenOnPlaylistTrackNo(obj), true);
                this.cache.on('getPlaylists', () => this.reloadUsersPlaylist());
                this.cache.on('getPlaybackInfo', () => this.listenOnGetPlaybackInfo());
                this.cache.on('getDevices', () => this.listenOnGetDevices());
                this.cache.on(['playlists.playlistList', 'playlists.playlistListIds', 'playlists.playlistListString'], () => this.listenOnHtmlPlaylists());
                this.cache.on(['player.playlist.trackList', 'player.playlist.trackListArray'], () => this.listenOnHtmlTracklist());
                this.cache.on(['devices.deviceList', 'devices.deviceListIds', 'devices.availableDeviceListString'], () => this.listenOnHtmlDevices());
                void this.cache.init().then(() => this.main());
            },
            unload: callback => {
                this.stopped = true;
                // Close the OAuth callback server
                // if (this.application.callbackServer) {
                //     this.application.callbackServer.close();
                //     this.log.debug('OAuth callback server closed');
                // }
                if (this.application.statusPollingHandle) {
                    clearTimeout(this.application.statusPollingHandle);
                    this.application.statusPollingHandle = undefined;
                }
                if (this.application.statusInternalTimer) {
                    clearTimeout(this.application.statusInternalTimer);
                    this.application.statusInternalTimer = undefined;
                }
                if (this.application.devicePollingHandle) {
                    clearTimeout(this.application.devicePollingHandle);
                    this.application.devicePollingHandle = undefined;
                }
                if (this.application.playlistPollingHandle) {
                    clearTimeout(this.application.playlistPollingHandle);
                    this.application.playlistPollingHandle = undefined;
                }
                if (this.application.cacheClearHandle) {
                    clearTimeout(this.application.cacheClearHandle);
                    this.application.cacheClearHandle = undefined;
                }
                if (this.application.tokenRefreshTimer) {
                    clearTimeout(this.application.tokenRefreshTimer);
                    this.application.tokenRefreshTimer = undefined;
                }
                void Promise.all([
                    this.cache.setValue('authorization.userId', ''),
                    this.cache.setValue('player.trackId', ''),
                    this.cache.setValue('player.playlist.id', ''),
                    this.cache.setValue('player.playlist.trackNo', 0),
                    this.cache.setValue('player.playlist.owner', ''),
                    this.cache.setValue('authorization.authorized', false),
                    this.cache.setValue('info.connection', false),
                    this.cache.setValue('player.reachable', false),
                ]).then(() => callback?.());
            },
        });
    }
    async request(options) {
        this.log.debug(`[HTTP Request] ${options.method} ${options.url}`);
        if (options.headers) {
            this.log.debug(`[HTTP Headers] ${JSON.stringify(options.headers)}`);
        }
        if (options.data) {
            this.log.debug(`[HTTP Data] ${typeof options.data === 'string' ? options.data : JSON.stringify(options.data)}`);
        }
        try {
            const response = await (0, axios_1.default)(options);
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
        }
        catch (error) {
            const logLevel = error.response?.status === 404 ? 'debug' : 'error';
            this.log[logLevel](`[HTTP Error] ${error.message} for ${options.method} ${options.url}`);
            if (error.response) {
                this.log[logLevel](`[HTTP Error Status] ${error.response.status}`);
                this.log[logLevel](`[HTTP Error Data] ${typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
    main() {
        this.application.clientId = this.config.client_id;
        this.application.clientSecret = this.config.client_secret;
        this.application.redirect_uri ||= 'https://oauth2.iobroker.in/spotify';
        this.application.deleteDevices = this.config.delete_devices;
        this.application.deletePlaylists = this.config.delete_playlists;
        this.application.statusPollingDelaySeconds = parseInt(this.config.status_interval, 10);
        this.application.keepShuffleState = this.config.keep_shuffle_state;
        let deviceInterval = parseInt(String(this.config.device_interval), 10) || 0;
        let playlistInterval = parseInt(String(this.config.playlist_interval), 10) || 0;
        if ((0, utils_1.isEmpty)(this.application.clientId)) {
            return this.log.error('Client_ID is not filled');
        }
        if ((0, utils_1.isEmpty)(this.application.clientSecret)) {
            return this.log.error('Client_Secret is not filled');
        }
        if ((0, utils_1.isEmpty)(this.application.deleteDevices)) {
            this.application.deleteDevices = false;
        }
        if ((0, utils_1.isEmpty)(this.application.deletePlaylists)) {
            this.application.deletePlaylists = false;
        }
        if ((0, utils_1.isEmpty)(this.application.keepShuffleState)) {
            this.application.keepShuffleState = false;
        }
        if ((0, utils_1.isEmpty)(this.application.statusPollingDelaySeconds)) {
            this.application.statusPollingDelaySeconds = 5;
        }
        else if (this.application.statusPollingDelaySeconds < 1 && this.application.statusPollingDelaySeconds != 0) {
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
        void this.syncInstanceObjectRoles().then(() => this.start());
    }
    /**
     * Ensures that the roles of existing states match the definitions in io-package.json.
     * This is needed after role changes so that existing installations get updated roles.
     */
    async syncInstanceObjectRoles() {
        let ioPack;
        try {
            ioPack = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, '..', 'io-package.json'), 'utf8'));
        }
        catch {
            this.log.warn('Could not read io-package.json for role sync');
            return;
        }
        const instanceObjects = ioPack.instanceObjects || [];
        for (const def of instanceObjects) {
            if (def.type !== 'state' || !def.common?.role) {
                continue;
            }
            const fullId = `${this.namespace}.${def._id}`;
            try {
                const obj = await this.getObjectAsync(fullId);
                if (obj?.common && obj.common.role !== def.common.role) {
                    this.log.debug(`updating role of ${def._id}: "${obj.common.role}" -> "${def.common.role}"`);
                    obj.common.role = def.common.role;
                    await this.setObjectAsync(fullId, obj);
                }
            }
            catch {
                // Object doesn't exist yet — will be created by the framework
            }
        }
    }
    async start() {
        this.clearCache();
        try {
            const tokenObj = this.readTokenStates();
            this.application.token = tokenObj.access_token;
            this.application.refreshToken = tokenObj.refresh_token;
            this.scheduleTokenRefresh(this.getTokenExpiresAtMs(tokenObj), 'startup');
            const data = await this.sendRequest('/v1/me', 'GET', '');
            await this.setUserInformation(data);
            await Promise.all([
                this.cache.setValue('authorization.authorized', true),
                this.cache.setValue('info.connection', true),
                this.cache.setValue('player.reachable', true),
            ]);
            try {
                await this.pollStatusApi();
            }
            catch {
                // ignore
            }
            try {
                await this.reloadUsersPlaylist();
            }
            catch {
                // ignore
            }
            try {
                return await this.listenOnGetDevices();
            }
            catch {
                // ignore
            }
        }
        catch (err) {
            this.log.warn(err);
            await Promise.all([
                this.cache.setValue('authorization.authorized', false),
                this.cache.setValue('info.connection', false),
                this.cache.setValue('player.reachable', false),
            ]);
        }
    }
    readTokenStates() {
        const state = this.cache.getValue('authorization.oauth2Tokens');
        if (state) {
            let tokenObj = {};
            if (typeof state.val === 'string') {
                try {
                    tokenObj = JSON.parse(state.val);
                }
                catch (e) {
                    // empty
                    this.log.info(`Error: ${e}`);
                }
            }
            const validAccessToken = tokenObj.access_token;
            const validRefreshToken = tokenObj.refresh_token;
            const validClientId = tokenObj.client_id && tokenObj.client_id === this.application.clientId;
            if (validAccessToken && validRefreshToken && validClientId) {
                this.log.debug('spotify token read');
                return tokenObj;
            }
            throw new Error('invalid or no spotify token');
        }
        throw new Error('invalid or no spotify token');
    }
    getTokenExpiresAtMs(tokenObj) {
        const expiresAtMs = tokenObj.access_token_expires_on || '';
        if (expiresAtMs) {
            return new Date(expiresAtMs).getTime();
        }
        const expiresInSec = tokenObj.expires_in || 3600;
        return Date.now() + expiresInSec * 1000;
    }
    scheduleTokenRefresh(expiresAtMs, source) {
        if (this.application.tokenRefreshTimer) {
            clearTimeout(this.application.tokenRefreshTimer);
            this.application.tokenRefreshTimer = undefined;
        }
        if (!expiresAtMs || !this.application.refreshToken) {
            return;
        }
        const now = Date.now();
        const refreshAtMs = Math.max(expiresAtMs - TOKEN_REFRESH_SKEW_MS, now + TOKEN_REFRESH_MIN_DELAY_MS);
        const delayMs = Math.max(refreshAtMs - now, TOKEN_REFRESH_MIN_DELAY_MS);
        this.log.debug(`Scheduling token refresh in ${Math.round(delayMs / 1000)}s (${source})`);
        this.application.tokenRefreshTimer = setTimeout(() => {
            this.application.tokenRefreshTimer = undefined;
            if (this.stopped) {
                return;
            }
            this.log.debug('Starting proactive token refresh...');
            this.refreshToken()
                .then(() => this.log.info('Proactive token refresh successful'))
                .catch(err => {
                this.log.error(`Proactive token refresh failed: ${err}`);
                if (isTransientNetworkError(err)) {
                    this.log.warn(`Proactive token refresh failed due temporary network issue; retrying in ${Math.round(TOKEN_REFRESH_RETRY_DELAY_MS / 1000)}s`);
                    if (this.application.tokenRefreshTimer) {
                        clearTimeout(this.application.tokenRefreshTimer);
                    }
                    this.application.tokenRefreshTimer = setTimeout(() => {
                        this.application.tokenRefreshTimer = undefined;
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
    sendRequest(endpoint, method, sendBody, delayAccepted, tokenRefreshAttempted) {
        // Queue all requests to prevent Spotify rate limiting (429 errors)
        return this.requestQueue.add(() => this.sendRequestDirect(endpoint, method, sendBody, delayAccepted, tokenRefreshAttempted));
    }
    async sendRequestDirect(endpoint, method, sendBody, delayAccepted, tokenRefreshAttempted) {
        const options = {
            url: this.application.baseUrl + endpoint,
            method,
            lookup: dns_lookup_cache_1.lookup, // DNS caching
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
            throw new Error('429');
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
            }
            else {
                try {
                    parsedBody = body ? JSON.parse(body) : { error: { message: 'no active device' } };
                }
                catch (e) {
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
                    }
                    else {
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
                                this.cache.setValue('authorization.authorized', false),
                                this.cache.setValue('info.connection', false),
                                this.cache.setValue('player.reachable', false),
                            ]);
                            this.log.debug('Starting token refresh...');
                            await this.refreshToken();
                            this.log.info('Token refresh successful - reconnecting');
                            await Promise.all([
                                this.cache.setValue('authorization.authorized', true),
                                this.cache.setValue('info.connection', true),
                                this.cache.setValue('player.reachable', true),
                            ]);
                            const data = await this.sendRequest(endpoint, method, sendBody, delayAccepted, true);
                            this.log.info(`Request retry after token refresh successful for ${endpoint}`);
                            return data;
                        }
                        catch (err) {
                            if (err.toString().includes('202')) {
                                this.log.debug(`${err} request accepted but no data, try again`);
                            }
                            else {
                                this.log.error(`Token refresh or retry failed for ${endpoint}: ${err}`);
                            }
                            throw err;
                        }
                    }
                    else if (statusCode === 403 &&
                        parsedBody.error &&
                        parsedBody.error.message === 'The access token expired') {
                        // 403 - try refresh only if it looks like token expiration
                        this.log.debug('access token expired (403)!');
                        try {
                            await Promise.all([
                                this.cache.setValue('authorization.authorized', false),
                                this.cache.setValue('info.connection', false),
                                this.cache.setValue('player.reachable', false),
                            ]);
                            await this.refreshToken();
                            await Promise.all([
                                this.cache.setValue('authorization.authorized', true),
                                this.cache.setValue('info.connection', true),
                                this.cache.setValue('player.reachable', true),
                            ]);
                            const result = await this.sendRequest(endpoint, method, sendBody, delayAccepted, true);
                            this.log.debug('data with new token');
                            return result;
                        }
                        catch (err) {
                            if (err.toString().includes('202')) {
                                this.log.debug(`${err} request accepted but no data, try again`);
                            }
                            else {
                                this.log.error(`error on request data again. ${err}`);
                            }
                            throw err;
                        }
                    }
                    else {
                        if (statusCode === 401 && tokenRefreshAttempted) {
                            this.log.error(`Authentication failed (401) on endpoint: ${endpoint} - Token refresh did not resolve the issue`);
                        }
                        else if (statusCode === 403) {
                            this.log.warn('Seems that the token is expired or permissions are insufficient!');
                            this.log.warn(`status code: ${statusCode}`);
                            this.log.warn(`endpoint: ${endpoint}`);
                            this.log.warn(`error message: ${parsedBody.error?.message || 'unknown'}`);
                            this.log.debug(`body: ${body}`);
                        }
                        await Promise.all([
                            this.cache.setValue('authorization.authorized', false),
                            this.cache.setValue('info.connection', false),
                            this.cache.setValue('player.reachable', false),
                        ]);
                        this.log.error(`${statusCode} response: ${parsedBody.error?.message || 'unknown error'}`);
                        throw new Error(statusCode.toString());
                    }
                    break;
                case 429: {
                    // Too Many Requests
                    let wait = 1;
                    if (headers?.['retry-after'] && Number(headers['retry-after']) > 0) {
                        wait = Number(headers['retry-after']);
                        this.tooManyRequests = true;
                        this.log.warn(`too many requests, wait ${wait}s`);
                    }
                    try {
                        await new Promise(resolve => setTimeout(() => resolve(), wait * 1000));
                        if (this.stopped) {
                            return null;
                        }
                        this.tooManyRequests = false;
                        return await this.sendRequest(endpoint, method, sendBody, delayAccepted);
                    }
                    catch (error) {
                        this.log.debug(error);
                    }
                    break;
                }
                default: {
                    this.log.warn('http request error not handled, please debug');
                    this.log.debug(`status code: ${statusCode}`);
                    this.log.warn(callStack || '');
                    this.log.warn(new Error().stack || '');
                    const safeBody = typeof body !== 'undefined' && body !== null
                        ? body
                        : response?.data
                            ? JSON.stringify(response.data)
                            : 'unknown error';
                    this.log.debug(`body: ${safeBody}`);
                    ret = Promise.reject(new Error(statusCode.toString()));
                    try {
                        await this.setStateAsync('authorization.error', safeBody, true);
                    }
                    catch (err) {
                        this.log.warn(`Could not set authorization.error state: ${err?.message || err}`);
                    }
                }
            }
            return ret;
        }
        catch (axiosError) {
            // Handle AxiosError - when axios throws an error with no response or error response
            if (!axiosError.response) {
                // Network error, DNS error, timeout, etc. - not Spotify's fault
                this.log.error(`network request error on ${endpoint}: ${axiosError.message}`);
                if (isTransientNetworkError(axiosError)) {
                    throw new Error('503');
                }
                throw axiosError;
            }
            // AxiosError with response status - process like normal error
            const errorStatusCode = axiosError.response.status;
            const body = axiosError.response.data;
            this.log.debug(`spotify api error response: ${errorStatusCode} on ${endpoint}`);
            // Handle 401 specifically - try token refresh
            if (errorStatusCode === 401 && !tokenRefreshAttempted) {
                this.log.warn(`Received 401 Unauthorized on ${endpoint} (via error) - attempting automatic token refresh`);
                try {
                    await Promise.all([
                        this.cache.setValue('authorization.authorized', false),
                        this.cache.setValue('info.connection', false),
                        this.cache.setValue('player.reachable', false),
                    ]);
                    this.log.debug('Starting token refresh (from error handler)...');
                    await this.refreshToken();
                    this.log.info('Token refresh successful - reconnecting');
                    await Promise.all([
                        this.cache.setValue('authorization.authorized', true),
                        this.cache.setValue('info.connection', true),
                        this.cache.setValue('player.reachable', true),
                    ]);
                    const result = await this.sendRequest(endpoint, method, sendBody, delayAccepted, true);
                    this.log.info(`Request retry after token refresh successful for ${endpoint}`);
                    return result;
                }
                catch (err) {
                    this.log.error(`Token refresh or retry failed for ${endpoint}: ${err}`);
                    throw err;
                }
            }
            if (errorStatusCode === 403 && endpoint.includes('/playlists/') && endpoint.includes('/tracks')) {
                this.log.debug(`playlist tracks access denied (403) on ${endpoint}; skipping`);
                throw new Error(errorStatusCode.toString());
            }
            if (errorStatusCode === 404 && endpoint.includes('/playlists/')) {
                // Personalized editorial playlists (e.g. 37i9dQZF1DW...) are not accessible via the Playlist API
                this.log.debug(`playlist not accessible via API (404) on ${endpoint}; this is normal for Spotify editorial playlists`);
                throw new Error(errorStatusCode.toString());
            }
            // For other error codes - just reject
            this.log.error(`request failed with status ${errorStatusCode} on ${endpoint}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
            throw new Error(errorStatusCode.toString());
        }
    }
    loadOrDefault(obj, name, defaultVal) {
        let t;
        try {
            const f = new Function('obj', 'name', `return obj.${name}`);
            t = f(obj, name);
        }
        catch (e) {
            if (!obj) {
                this.log.error(`loadOrDefault error: ${e}`);
            }
        }
        if (t === undefined) {
            t = defaultVal;
        }
        return t;
    }
    createOrDefault(obj, name, stateId, defaultVal, description, type, states) {
        const t = this.loadOrDefault(obj, name, defaultVal);
        const object = {
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
        return this.cache.setValue(stateId, t, object);
    }
    setOrDefault(obj, name, state, defaultVal) {
        const t = this.loadOrDefault(obj, name, defaultVal);
        return this.cache.setValue(state, t);
    }
    shrinkStateName(v) {
        let n = v.replace(/[\s."`'*,\\?<>[\];:]+/g, '');
        if ((0, utils_1.isEmpty)(n)) {
            n = 'onlySpecialCharacters';
        }
        return n;
    }
    getArtistArrayOrDefault(data, name) {
        const ret = [];
        for (let i = 0; i < 100; i++) {
            const artistName = this.loadOrDefault(data, `${name}[${i}].name`, '');
            const artistId = this.loadOrDefault(data, `${name}[${i}].id`, '');
            if (!(0, utils_1.isEmpty)(artistName) && !(0, utils_1.isEmpty)(artistId)) {
                ret.push({ id: artistId, name: artistName });
            }
            else {
                break;
            }
        }
        return ret;
    }
    getArtistNamesOrDefault(data, name) {
        let ret = '';
        for (let i = 0; i < 100; i++) {
            const artist = this.loadOrDefault(data, `${name}[${i}].name`, '');
            if (!(0, utils_1.isEmpty)(artist)) {
                if (i > 0) {
                    ret += ', ';
                }
                ret += artist;
            }
            else {
                break;
            }
        }
        return ret;
    }
    setObjectStatesIfChanged(id, states) {
        let obj = this.cache.getObj(id);
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
        return this.cache.setValue(id, null, {
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
    copyState(src, dst) {
        // return this.cache.setValue(dst, this.cache.getValue(src).val);
        const tmp_src = this.cache.getValue(src);
        if (tmp_src) {
            return this.cache.setValue(dst, tmp_src.val);
        }
        this.log.debug('bei copyState: fehlerhafte Playlists-Daten src');
        return Promise.resolve();
    }
    copyObjectStates(src, dst) {
        // return setObjectStatesIfChanged(dst, this.cache.getObj(src).common.states);
        const tmpSrc = this.cache.getObj(src);
        if (tmpSrc?.common) {
            return this.setObjectStatesIfChanged(dst, tmpSrc.common.states);
        }
        this.log.debug('bei copyObjectStates: fehlerhafte Playlists-Daten src');
        return Promise.resolve();
    }
    async createPlaybackInfo(data) {
        data ||= {};
        const deviceId = data.device?.id || '';
        const isDeviceActive = data.device?.is_active || false;
        const isDeviceRestricted = data.device?.is_restricted || false;
        const deviceName = data.device?.name || '';
        const deviceType = data.device?.type || '';
        const deviceVolume = data.device?.volume_percent || 100;
        const isPlaying = data.is_playing || false;
        const duration = data.item?.duration_ms || 0;
        let type = data.context?.type || '';
        if (!type) {
            type = data.item?.type || '';
        }
        const progress = parseInt(data.progress_ms, 10) || 0;
        let progressPercentage = 0;
        if (duration > 0) {
            progressPercentage = Math.floor((progress / duration) * 100);
        }
        let contextDescription = '';
        let contextImage = '';
        const album = data.item?.album?.name || '';
        const albumUrl = data.item?.album?.images?.[0]?.url || '';
        const artist = this.getArtistNamesOrDefault(data, 'item.artists');
        if (type === 'album') {
            contextDescription = `Album: ${album}`;
            contextImage = albumUrl;
        }
        else if (type === 'artist') {
            contextDescription = `Artist: ${artist}`;
        }
        else if (type === 'track') {
            contextDescription = 'Track';
            // tracks has no images
            contextImage = albumUrl;
        }
        const shuffle = data.shuffle_state || false;
        await Promise.all([
            this.cache.setValue('player.device.id', deviceId),
            this.cache.setValue('player.device.isActive', isDeviceActive),
            this.cache.setValue('player.device.isRestricted', isDeviceRestricted),
            this.cache.setValue('player.device.name', deviceName),
            this.cache.setValue('player.device.type', deviceType),
            this.cache.setValue('player.device.volume', { val: deviceVolume, ack: true }),
            this.cache.setValue('player.device.isAvailable', !(0, utils_1.isEmpty)(deviceName)),
            this.cache.setValue('player.device', null, {
                _id: `${this.namespace}.player.device`,
                type: 'device',
                common: {
                    name: (0, utils_1.isEmpty)(deviceName)
                        ? 'Commands to control playback related to the current active device'
                        : deviceName,
                    icon: this.getIconByType(deviceType),
                },
                native: {},
            }),
            this.cache.setValue('player.isPlaying', isPlaying),
            this.setOrDefault(data, 'item.id', 'player.trackId', ''),
            this.cache.setValue('player.artistName', artist),
            this.cache.setValue('player.album', album),
            this.cache.setValue('player.albumImageUrl', albumUrl),
            this.setOrDefault(data, 'item.name', 'player.trackName', ''),
            this.cache.setValue('player.durationMs', duration),
            this.cache.setValue('player.durationSec', Math.round(duration / 1000)),
            this.cache.setValue('player.duration', this.convertToDigiClock(duration)),
            this.cache.setValue('player.type', type),
            this.cache.setValue('player.progressMs', progress),
            this.cache.setValue('player.progressPercentage', progressPercentage),
            this.cache.setValue('player.progress', this.convertToDigiClock(progress)),
            this.cache.setValue('player.shuffle', shuffle ? 'on' : 'off'),
            this.cache.setValue('player.shuffleBool', shuffle),
            this.setOrDefault(data, 'repeat_state', 'player.repeat', 'off'),
            this.cache.setValue('player.repeatMode', data.repeat_state === 'context' ? 1 : data.repeat_state === 'track' ? 2 : 0),
            this.setOrDefault(data, 'device.volume_percent', 'player.device.volume', 100),
        ]);
        if (deviceName) {
            this.deviceData.lastActiveDeviceId = deviceId;
            const states = this.cache.getValues('devices.*');
            const keys = Object.keys(states);
            const fn1 = async (key) => {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                key = (0, utils_1.removeNameSpace)(key);
                let name;
                if (deviceId != null) {
                    name = this.shrinkStateName(deviceId);
                }
                else {
                    name = this.shrinkStateName(deviceName);
                }
                if (key !== `devices.${name}.isActive`) {
                    await this.cache.setValue(key, false);
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
        else {
            const states = this.cache.getValues('devices.*');
            const keys = Object.keys(states);
            const fn2 = async (key) => {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                key = (0, utils_1.removeNameSpace)(key);
                await this.cache.setValue(key, false);
            };
            await Promise.all(keys.map(fn2).filter((p) => p !== undefined));
        }
        if (progress && isPlaying && this.application.statusPollingDelaySeconds > 0) {
            this.scheduleStatusInternalTimer(duration, progress, Date.now(), this.application.statusPollingDelaySeconds - 1);
        }
        const currentTrackId = data.item?.id || '';
        if (currentTrackId === this.application.lastTrackId && currentTrackId) {
            // Same track, skip artist loading
        }
        else {
            this.application.lastTrackId = currentTrackId;
            const artists = [];
            for (let i = 0; i < 100; i++) {
                const id = data.item?.artists?.[i]?.id || '';
                if (!id) {
                    break;
                }
                artists.push(id);
            }
            const urls = [];
            const fn = async (artist) => {
                if (artist in this.artistImageUrlCache) {
                    urls.push(this.artistImageUrlCache[artist]);
                    return;
                }
                try {
                    const parseJson = await this.sendRequest(`/v1/artists/${artist}`, 'GET', '');
                    const artistUrl = parseJson.images?.[0]?.url || '';
                    if (!(0, utils_1.isEmpty)(artistUrl)) {
                        this.artistImageUrlCache[artist] = artistUrl;
                        urls.push(artistUrl);
                    }
                }
                catch (error) {
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
            await this.cache.setValue('player.artistImageUrl', set);
        }
        const uri = data.context?.uri || '';
        this.log.debug(`context uri: "${uri}", type: "${type}"`);
        if (type === 'playlist' && uri) {
            const indexOfPlaylistId = uri.indexOf('playlist:') + 9;
            const playlistId = uri.slice(indexOfPlaylistId);
            const userMatch = uri.match(/user:([^:]+)/);
            const userId = userMatch ? userMatch[1] : '';
            this.log.debug(`parsed playlistId: "${playlistId}", userId: "${userId}"`);
            const query = {
                fields: 'name,id,owner(id),tracks(total),images',
            };
            if (this.application.market) {
                query.market = this.application.market;
            }
            await this.cache.setValue('player.playlist.id', playlistId);
            const refreshPlaylist = async (parseJson) => {
                const playlistName = parseJson?.name || '';
                contextDescription = `Playlist: ${playlistName}`;
                const songId = data.item?.id || '';
                const playlistImage = parseJson?.images?.[0]?.url || '';
                contextImage = playlistImage;
                const ownerId = parseJson?.owner?.id || '';
                const trackCount = parseJson?.tracks?.total || 0;
                const prefix = this.shrinkStateName(`${ownerId}-${playlistId}`);
                const cacheEntry = {
                    id: playlistId,
                    name: playlistName,
                    images: [{ url: playlistImage }],
                    owner: { id: ownerId },
                    tracks: { total: trackCount },
                };
                this.playlistCache[`${ownerId}-${playlistId}`] = cacheEntry;
                this.playlistCache[playlistId] = cacheEntry;
                const trackList = this.cache.getValue(`playlists.${prefix}.trackList`);
                await Promise.all([
                    this.cache.setValue('player.playlist.owner', ownerId),
                    this.cache.setValue('player.playlist.tracksTotal', trackCount),
                    this.cache.setValue('player.playlist.imageUrl', playlistImage),
                    this.cache.setValue('player.playlist.name', playlistName),
                    this.cache.setValue('player.playlist', null, {
                        _id: `${this.namespace}.player.playlist`,
                        type: 'channel',
                        common: {
                            name: (0, utils_1.isEmpty)(playlistName)
                                ? 'Commands to control playback related to the playlist'
                                : playlistName,
                        },
                        native: {},
                    }),
                ]);
                if (this.cache.getValue(`playlists.${prefix}.trackListIds`) === null) {
                    await this.createPlaylists({
                        items: [parseJson],
                    });
                }
                await this.refreshPlaylistList();
                const promises = [
                    this.copyState(`playlists.${prefix}.trackListNumber`, 'player.playlist.trackListNumber'),
                    this.copyState(`playlists.${prefix}.trackListString`, 'player.playlist.trackListString'),
                    this.copyState(`playlists.${prefix}.trackListStates`, 'player.playlist.trackListStates'),
                    this.copyObjectStates(`playlists.${prefix}.trackList`, 'player.playlist.trackList'),
                    this.copyState(`playlists.${prefix}.trackListIdMap`, 'player.playlist.trackListIdMap'),
                    this.copyState(`playlists.${prefix}.trackListIds`, 'player.playlist.trackListIds'),
                    this.copyState(`playlists.${prefix}.trackListArray`, 'player.playlist.trackListArray'),
                ];
                if (trackList) {
                    promises.push(this.cache.setValue('player.playlist.trackNo', parseInt(trackList.val, 10) + 1));
                }
                await Promise.all(promises);
                const state = this.cache.getValue(`playlists.${prefix}.trackListIds`);
                const ids = state?.val || '';
                if ((0, utils_1.isEmpty)(ids)) {
                    throw new Error('no ids in trackListIds');
                }
                const stateName = ids.split(';');
                const stateArr = {};
                for (let i = 0; i < stateName.length; i++) {
                    const ele = stateName[i].split(':');
                    if (ele.length >= 2) {
                        stateArr[ele[1]] = ele[0];
                    }
                }
                if (songId in stateArr && stateArr[songId] !== '') {
                    const no = stateArr[songId];
                    await Promise.all([
                        this.cache.setValue(`playlists.${prefix}.trackList`, no),
                        this.cache.setValue('player.playlist.trackList', no),
                        this.cache.setValue('player.playlist.trackNo', parseInt(no, 10) + 1),
                    ]);
                    return;
                }
            };
            // Look up playlist in cache by userId-playlistId or just playlistId
            const cachedPlaylist = this.playlistCache[`${userId}-${playlistId}`] || this.playlistCache[playlistId];
            // Only load playlist details if playlist ID has changed
            if (playlistId === this.application.lastPlaylistId && playlistId && cachedPlaylist) {
                // Same playlist, just refresh track position
                try {
                    await refreshPlaylist(cachedPlaylist);
                }
                catch (e) {
                    this.log.warn(`Cannot refresh playlist: ${e}`);
                }
            }
            else {
                // Playlist changed, update lastPlaylistId and load details
                this.application.lastPlaylistId = playlistId;
                if (cachedPlaylist) {
                    try {
                        await refreshPlaylist(cachedPlaylist);
                    }
                    catch (e) {
                        this.log.warn(`Cannot refresh playlist: ${e}`);
                    }
                }
                else if (this.inaccessiblePlaylists.has(playlistId)) {
                    this.log.debug(`playlist ${playlistId} is known to be inaccessible, skipping API call`);
                }
                else {
                    try {
                        const parseJson = await this.sendRequest(`/v1/playlists/${playlistId}?${node_querystring_1.default.stringify(query)}`, 'GET', '');
                        await refreshPlaylist(parseJson);
                    }
                    catch (error) {
                        if (error.message === '404') {
                            this.inaccessiblePlaylists.add(playlistId);
                            this.log.info(`playlist ${playlistId} is not accessible via Spotify API (editorial playlist); will not retry`);
                        }
                        else {
                            this.log.debug(error);
                        }
                    }
                }
            }
        }
        else {
            this.log.debug(`context type: "${type}"`);
            await Promise.all([
                this.cache.setValue('player.playlist.id', ''),
                this.cache.setValue('player.playlist.name', ''),
                this.cache.setValue('player.playlist.owner', ''),
                this.cache.setValue('player.playlist.tracksTotal', 0),
                this.cache.setValue('player.playlist.imageUrl', ''),
                this.cache.setValue('player.playlist.trackList', ''),
                this.cache.setValue('player.playlist.trackListNumber', ''),
                this.cache.setValue('player.playlist.trackListString', ''),
                this.cache.setValue('player.playlist.trackListStates', ''),
                this.cache.setValue('player.playlist.trackListIdMap', ''),
                this.cache.setValue('player.playlist.trackListIds', ''),
                this.cache.setValue('player.playlist.trackListArray', ''),
                this.cache.setValue('player.playlist.trackNo', 0),
                this.cache.setValue('playlists.playlistList', ''),
                this.cache.setValue('player.playlist', null, {
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
        }
        await Promise.all([
            this.cache.setValue('player.contextImageUrl', contextImage),
            this.cache.setValue('player.contextDescription', contextDescription),
        ]);
    }
    convertToDigiClock(ms) {
        // milliseconds to digital time, e.g. 3:59=238759
        ms ||= 0;
        const min = Math.floor(ms / 60_000);
        const sec = Math.floor(((ms % 3_600_000) % 60_000) / 1000);
        return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
    }
    async setUserInformation(data) {
        this.application.userId = data.id;
        this.application.market = data.country || '';
        await this.cache.setValue('authorization.userId', data.id);
    }
    async reloadUsersPlaylist() {
        const addedList = await this.getUsersPlaylist(0);
        if (this.application.deletePlaylists) {
            await this.deleteUsersPlaylist(addedList);
        }
        await this.refreshPlaylistList();
    }
    deleteUsersPlaylist(addedList) {
        const states = this.cache.getValues('playlists.*');
        const keys = Object.keys(states);
        const fn = (key) => {
            key = (0, utils_1.removeNameSpace)(key);
            let found = false;
            if (addedList) {
                for (let i = 0; i < addedList.length; i++) {
                    if (key.startsWith(addedList[i])) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found &&
                key !== 'playlists.playlistList' &&
                key !== 'playlists.playlistListIds' &&
                key !== 'playlists.playlistListString' &&
                key !== 'playlists.yourPlaylistListIds' &&
                key !== 'playlists.yourPlaylistListString') {
                return this.cache.delObject(key).then(() => {
                    if (key.endsWith('.id')) {
                        return this.cache.delObject(key.substring(0, key.length - 3));
                    }
                });
            }
        };
        return Promise.all(keys.map(fn).filter((p) => p !== undefined));
    }
    async createPlaylists(parseJson, autoContinue, addedList) {
        if ((0, utils_1.isEmpty)(parseJson) || (0, utils_1.isEmpty)(parseJson.items)) {
            this.log.debug('no playlist content');
            throw new Error('no playlist content');
        }
        const fn = async (item) => {
            const playlistName = item.name || '';
            if ((0, utils_1.isEmpty)(playlistName)) {
                this.log.warn('empty playlist name');
                throw new Error('empty playlist name');
            }
            const playlistId = item.id || '';
            const ownerId = item.owner?.id || '';
            const trackCount = item.tracks?.total || 0;
            const imageUrl = item.images?.[0]?.url || '';
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
                this.cache.setValue(prefix, null, {
                    _id: `${this.namespace}.${prefix}`,
                    type: 'channel',
                    common: { name: playlistName },
                    native: {},
                }),
                this.cache.setValue(`${prefix}.playThisList`, false, {
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
            const currentPlaylistId = this.cache.getValue('player.playlist.id')?.val;
            const currentPlaylistOwnerId = this.cache.getValue('player.playlist.owner')?.val;
            const songId = this.cache.getValue('player.trackId')?.val;
            if (`${ownerId}-${playlistId}` === `${currentPlaylistOwnerId}-${currentPlaylistId}`) {
                const stateName = playlistObject.trackIds.split(';');
                const stateArr = {};
                for (let i = 0; i < stateName.length; i++) {
                    const ele = stateName[i].split(':');
                    if (ele.length >= 2) {
                        stateArr[ele[1]] = ele[0];
                    }
                }
                if (songId in stateArr && stateArr[songId] !== '') {
                    trackListValue = stateArr[songId];
                }
            }
            const stateObj = {};
            const states = this.loadOrDefault(playlistObject, 'stateString', '').split(';');
            states.forEach((state) => {
                const el = state.split(':');
                if (el.length === 2) {
                    stateObj[el[0]] = el[1];
                }
            });
            await Promise.all([
                this.cache.setValue(`${prefix}.trackList`, trackListValue, {
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
                this.createOrDefault(playlistObject, 'listNumber', `${prefix}.trackListNumber`, '', 'contains list of tracks as string, patter: 0;1;2;...', 'string'),
                this.createOrDefault(playlistObject, 'listString', `${prefix}.trackListString`, '', 'contains list of tracks as string, patter: title - artist;title - artist;title - artist;...', 'string'),
                this.createOrDefault(playlistObject, 'stateString', `${prefix}.trackListStates`, '', 'contains list of tracks as string with position, pattern: 0:title - artist;1:title - artist;2:title - artist;...', 'string'),
                this.createOrDefault(playlistObject, 'trackIdMap', `${prefix}.trackListIdMap`, '', 'contains list of track ids as string with position, pattern: 0:id;1:id;2:id;...', 'string'),
                this.createOrDefault(playlistObject, 'trackIds', `${prefix}.trackListIds`, '', 'contains list of track ids as string, pattern: id;id;id;...', 'string'),
                this.createOrDefault(playlistObject, 'songs', `${prefix}.trackListArray`, '', 'contains list of tracks as array object, pattern:\n[{id: "id",\ntitle: "title",\nartistName: "artistName1, artistName2",\nartistArray: [{id: "artistId", name: "artistName"}, {id: "artistId", name: "artistName"}, ...],\nalbum: {id: "albumId", name: "albumName"},\ndurationMs: 253844,\nduration: 4:13,\naddedAt: 15395478261235,\naddedBy: "userId",\ndiscNumber: 1,\nepisode: false,\nexplicit: false,\npopularity: 56\n}, ...]', 'object'),
            ]);
        };
        for (let i = 0; i < parseJson.items.length; i++) {
            await new Promise(resolve => setTimeout(() => !this.stopped && resolve(), 1000));
            try {
                await fn(parseJson.items[i]);
            }
            catch (e) {
                this.log.warn(e);
            }
        }
        if (autoContinue && parseJson.items.length && parseJson.next !== null) {
            return this.getUsersPlaylist(parseJson.offset + parseJson.limit, addedList);
        }
        return addedList;
    }
    async getUsersPlaylist(offset, addedList) {
        addedList ||= [];
        const query = {
            limit: 30,
            offset,
        };
        // Nutze /v1/me/playlists für alle Playlists, auf die der Nutzer Zugriff hat
        try {
            const parsedJson = await this.sendRequest(`/v1/me/playlists?${node_querystring_1.default.stringify(query)}`, 'GET', '');
            return await this.createPlaylists(parsedJson, true, addedList);
        }
        catch (err) {
            // Improved error handling with different status codes
            const errStr = err.toString();
            if (errStr.includes('403')) {
                this.log.error(`Playlist API returned 403 (Forbidden) at offset ${offset} - Token may be expired or insufficient permissions`);
            }
            else if (errStr.includes('401')) {
                this.log.warn(`Playlist API returned 401 (Unauthorized) at offset ${offset} - Token refresh should be in progress`);
            }
            else if (errStr.includes('429')) {
                this.log.debug(`Playlist API returned 429 (Too Many Requests) at offset ${offset} - Rate limited, will retry later`);
            }
            else {
                this.log.error(`Playlist error: ${err} at offset ${offset}`);
            }
            return { items: [], next: null };
        }
    }
    getSelectedDevice(deviceData) {
        if (deviceData.lastSelectDeviceId === '') {
            return deviceData.lastActiveDeviceId;
        }
        return deviceData.lastSelectDeviceId;
    }
    cleanState(str) {
        str = str.replace(/:/g, ' ');
        str = str.replace(/;/g, ' ');
        let old;
        do {
            old = str;
            str = str.replace('  ', ' ');
        } while (old !== str);
        return str.trim();
    }
    async getPlaylistTracks(owner, id) {
        const playlistObject = {
            stateString: '',
            listString: '',
            listNumber: '',
            trackIdMap: '',
            trackIds: '',
            songs: [],
        };
        let offset = 0;
        while (true) {
            const query = {
                limit: 50,
                offset: offset,
            };
            try {
                // Wait 1s between Playlist updates to avoid getting rate limited
                await new Promise(resolve => setTimeout(resolve, 1000));
                const data = await this.sendRequest(`/v1/playlists/${id}/tracks?${node_querystring_1.default.stringify(query)}`, 'GET', '');
                let i = offset;
                const no = i.toString();
                data.items.forEach((item) => {
                    const trackId = item.track?.id || '';
                    if ((0, utils_1.isEmpty)(trackId)) {
                        return this.log.debug(`There was a playlist track ignored because of missing id; playlist: ${id}; track no: ${no}`);
                    }
                    const artist = this.getArtistNamesOrDefault(item, 'track.artists');
                    const artistArray = this.getArtistArrayOrDefault(item, 'track.artists');
                    const trackName = item.track?.name || '';
                    const trackDuration = item.track?.duration_ms || 0;
                    const addedAt = item.addedAt || '';
                    const addedBy = item.addedBy || '';
                    const trackAlbumId = item.track?.album.id || '';
                    const trackAlbumName = item.track?.album.name || '';
                    const trackDiscNumber = item.track?.disc_number || 1;
                    const trackEpisode = item.track?.episode || false;
                    const trackExplicit = item.track?.explicit || false;
                    const trackPopularity = item.track?.popularity || 0;
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
                        duration: this.convertToDigiClock(trackDuration),
                        addedAt,
                        addedBy,
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
                }
                else {
                    break;
                }
                //.catch(err => this.log.warn('error on load tracks: ' + err));
            }
            catch (err) {
                if (err.toString().includes('403')) {
                    this.log.debug(`playlist tracks access denied (403) owner: ${owner} id: ${id}`);
                }
                else {
                    this.log.warn(`error on load tracks(getPlaylistTracks): ${err} owner: ${owner} id: ${id}`);
                }
                break;
            }
        }
        return playlistObject;
    }
    async reloadDevices(data) {
        const addedList = await this.createDevices(data);
        if (this.application.deleteDevices) {
            await this.deleteDevices(addedList);
        }
        else {
            await this.disableDevices(addedList);
        }
        await this.refreshDeviceList();
    }
    disableDevices(addedList) {
        const states = this.cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn = (key) => {
            key = (0, utils_1.removeNameSpace)(key);
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
                return this.cache.setValue(key, false);
            }
        };
        return Promise.all(keys.map(fn).filter((p) => p !== undefined));
    }
    deleteDevices(addedList) {
        const states = this.cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn = (key) => {
            key = (0, utils_1.removeNameSpace)(key);
            let found = false;
            if (addedList) {
                for (let i = 0; i < addedList.length; i++) {
                    if (key.startsWith(addedList[i])) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found &&
                key !== 'devices.deviceList' &&
                key !== 'devices.deviceListIds' &&
                key !== 'devices.deviceListString' &&
                key !== 'devices.availableDeviceListIds' &&
                key !== 'devices.availableDeviceListString') {
                return this.cache.delObject(key).then(() => {
                    if (key.endsWith('.id')) {
                        return this.cache.delObject(key.substring(0, key.length - 3));
                    }
                });
            }
        };
        return Promise.all(keys.map(fn).filter((p) => p !== undefined));
    }
    getIconByType(type) {
        if (type === 'Computer') {
            return 'icons/computer_black.png';
        }
        else if (type === 'Smartphone') {
            return 'icons/smartphone_black.png';
        }
        // Speaker
        return 'icons/speaker_black.png';
    }
    async createDevices(data) {
        if (!data?.devices) {
            data = { devices: [] };
        }
        const addedList = [];
        const fn = async (device) => {
            const deviceId = this.loadOrDefault(device, 'id', '');
            const deviceName = this.loadOrDefault(device, 'name', '');
            if ((0, utils_1.isEmpty)(deviceName)) {
                this.log.warn('empty device name');
                throw new Error('empty device name');
            }
            let name;
            if (deviceId != null) {
                name = this.shrinkStateName(deviceId);
            }
            else {
                name = this.shrinkStateName(deviceName);
            }
            const prefix = `devices.${name}`;
            addedList.push(prefix);
            const isRestricted = this.loadOrDefault(device, 'is_restricted', false);
            let useForPlayback;
            if (!isRestricted) {
                useForPlayback = this.cache.setValue(`${prefix}.useForPlayback`, false, {
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
            }
            else {
                useForPlayback = this.cache.delObject(`${prefix}.useForPlayback`);
            }
            await Promise.all([
                this.cache.setValue(prefix, null, {
                    _id: `${this.namespace}.${prefix}`,
                    type: 'device',
                    common: {
                        name: deviceName,
                        icon: this.getIconByType(this.loadOrDefault(device, 'type', 'Computer')),
                    },
                    native: {},
                }),
                this.createOrDefault(device, 'id', `${prefix}.id`, '', 'device id', 'string'),
                this.createOrDefault(device, 'is_active', `${prefix}.isActive`, false, 'current active device', 'boolean'),
                this.createOrDefault(device, 'is_restricted', `${prefix}.isRestricted`, false, 'it is not possible to control restricted devices with the adapter', 'boolean'),
                this.createOrDefault(device, 'name', `${prefix}.name`, '', 'device name', 'string'),
                this.createOrDefault(device, 'type', `${prefix}.type`, 'Speaker', 'device type', 'string', {
                    Computer: 'Computer',
                    Smartphone: 'Smartphone',
                    Speaker: 'Speaker',
                }),
                this.createOrDefault(device, 'volume_percent', `${prefix}.volume`, '', 'volume in percent', 'number'),
                this.cache.setValue(`${prefix}.isAvailable`, true, {
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
    async refreshPlaylistList() {
        const a = [];
        const states = this.cache.getValues('playlists.*');
        const keys = Object.keys(states);
        const fn = (key) => {
            if (!states[key] || !key.endsWith('.name')) {
                return;
            }
            const normKey = (0, utils_1.removeNameSpace)(key);
            const id = normKey.substring(10, normKey.length - 5);
            const owner = this.cache.getValue(`playlists.${id}.owner`);
            a.push({
                id: id,
                name: states[key].val,
                your: this.application.userId === owner ? owner.val : '',
            });
        };
        keys.forEach(fn);
        await Promise.resolve();
        const stateList = {};
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
            this.cache.setValue('playlists.playlistListIds', listIds),
            this.cache.setValue('playlists.playlistListString', listString),
            this.cache.setValue('playlists.yourPlaylistListIds', yourIds),
            this.cache.setValue('playlists.yourPlaylistListString', yourString),
        ]);
        const id = this.cache.getValue('player.playlist.id')?.val;
        if (id) {
            const owner = this.cache.getValue('player.playlist.owner')?.val;
            if (owner) {
                await this.cache.setValue('playlists.playlistList', `${owner}-${id}`);
            }
        }
    }
    async refreshDeviceList() {
        const a = [];
        const states = this.cache.getValues('devices.*');
        const keys = Object.keys(states);
        const fn = (key) => {
            if (!states[key] || !key.endsWith('.name')) {
                return;
            }
            const normKey = (0, utils_1.removeNameSpace)(key);
            const id = normKey.substring(8, normKey.length - 5);
            const available = this.cache.getValue(`devices.${id}.isAvailable`);
            a.push({
                id,
                name: states[key].val,
                available: !!available?.val,
            });
        };
        let activeDevice = false;
        keys.forEach(fn);
        await Promise.resolve();
        const stateList = {};
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
            this.cache.setValue('devices.deviceListIds', listIds),
            this.cache.setValue('devices.deviceListString', listString),
            this.cache.setValue('devices.availableDeviceListIds', availableIds),
            this.cache.setValue('devices.availableDeviceListString', availableString),
        ]);
        const states1 = this.cache.getValues('devices.*');
        const keys1 = Object.keys(states1);
        const fn1 = (key) => {
            if (!key.endsWith('.isActive')) {
                return;
            }
            const val = states1[key]?.val;
            if (val) {
                key = (0, utils_1.removeNameSpace)(key);
                const id = key.substring(8, key.length - 9);
                activeDevice = true;
                return this.cache.setValue('devices.deviceList', id);
            }
        };
        await Promise.all(keys1.map(fn1).filter((p) => p !== undefined));
        if (!activeDevice) {
            await Promise.all([
                this.cache.setValue('devices.deviceList', ''),
                this.cache.setValue('player.device.id', ''),
                this.cache.setValue('player.device.name', ''),
                this.cache.setValue('player.device.type', ''),
                this.cache.setValue('player.device.volume', 100),
                this.cache.setValue('player.device.isActive', false),
                this.cache.setValue('player.device.isAvailable', false),
                this.cache.setValue('player.device.isRestricted', false),
                this.cache.setValue('player.device', null, {
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
    refreshToken() {
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
                .then(async (response) => {
                const statusCode = typeof response.statusCode !== 'undefined' ? response.statusCode : response.status;
                const body = typeof response.body !== 'undefined' ? response.body : response.data;
                // this request gets the new token
                if (statusCode === 200) {
                    this.log.debug('new token arrived');
                    let parsedJson;
                    if (body && typeof body === 'object') {
                        parsedJson = body;
                    }
                    else {
                        try {
                            parsedJson = body ? JSON.parse(body) : {};
                        }
                        catch (e) {
                            this.log.error(`Error parsing token response: ${e}`);
                            parsedJson = {};
                        }
                    }
                    parsedJson.refresh_token ||= this.application.refreshToken;
                    this.log.debug('Token refresh successful');
                    try {
                        const tokenObj = await this.saveToken(parsedJson);
                        this.application.token = tokenObj.access_token;
                        this.application.refreshToken = tokenObj.refresh_token;
                        this.scheduleTokenRefresh(this.getTokenExpiresAtMs(tokenObj), 'refreshToken');
                        this.log.debug('Token saved and updated in application state');
                        return tokenObj;
                    }
                    catch (err) {
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
                    this.log.error(`Token refresh response: ${typeof responseData === 'string' ? responseData : JSON.stringify(responseData)}`);
                }
                throw error instanceof Error ? error : new Error(String(error));
            })
                .finally(() => {
                this.refreshTokenInFlight = null;
            });
            return this.refreshTokenInFlight;
        }
        this.log.warn('Cannot refresh token: no refresh token available');
        throw new Error('no refresh token');
    }
    async saveToken(data) {
        this.log.debug('saveToken');
        if (data.access_token && data.refresh_token) {
            await this.cache.setValue('authorization.oauth2Tokens', JSON.stringify(data));
            return data;
        }
        this.log.error(JSON.stringify(data));
        throw new Error('no tokens found in server response');
    }
    async increaseTime(durationMs, progressMs, startDate, count) {
        const now = Date.now();
        count--;
        progressMs += now - startDate;
        const tDurationMs = this.cache.getValue('player.durationMs')?.val;
        const percentage = Math.floor((progressMs / (tDurationMs || 1)) * 100);
        // Only update states if values have actually changed
        const updates = [];
        const currentProgress = this.cache.getValue('player.progress')?.val;
        const newProgress = this.convertToDigiClock(progressMs);
        if (currentProgress !== newProgress) {
            updates.push(this.cache.setValue('player.progress', newProgress));
        }
        const currentProgressMs = this.cache.getValue('player.progressMs')?.val;
        if (currentProgressMs !== progressMs) {
            updates.push(this.cache.setValue('player.progressMs', progressMs));
        }
        const currentPercentage = this.cache.getValue('player.progressPercentage')?.val;
        if (currentPercentage !== percentage) {
            updates.push(this.cache.setValue('player.progressPercentage', percentage));
        }
        // If no updates needed, just schedule next update if playing
        if (!updates.length) {
            if (count > 0) {
                if (progressMs + 1000 > durationMs) {
                    setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
                }
                else {
                    const state = this.cache.getValue('player.isPlaying');
                    if (state?.val) {
                        this.scheduleStatusInternalTimer(durationMs, progressMs, now, count);
                    }
                }
            }
            return;
        }
        await Promise.all(updates);
        if (count > 0) {
            if (progressMs + 1000 > durationMs) {
                setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
            }
            else {
                const state = this.cache.getValue('player.isPlaying');
                if (state?.val) {
                    this.scheduleStatusInternalTimer(durationMs, progressMs, now, count);
                }
            }
        }
    }
    scheduleStatusInternalTimer(durationMs, progressMs, startDate, count) {
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
        }
        this.application.statusInternalTimer = setTimeout(() => {
            this.application.statusInternalTimer = undefined;
            if (!this.stopped) {
                this.increaseTime(durationMs, progressMs, startDate, count).catch(err => this.log.error(JSON.stringify(err)));
            }
        }, 1000);
    }
    scheduleStatusPolling() {
        if (this.application.statusPollingHandle) {
            clearTimeout(this.application.statusPollingHandle);
            this.application.statusPollingHandle = undefined;
        }
        if (this.application.statusPollingDelaySeconds > 0) {
            // Status polling has no offset (base timing)
            this.application.statusPollingHandle = setTimeout(() => {
                this.application.statusPollingHandle = undefined;
                if (!this.stopped) {
                    void this.pollStatusApi().catch(e => this.log.error(e));
                }
            }, this.application.statusPollingDelaySeconds * 1000);
        }
    }
    async pollStatusApi(noReschedule) {
        if (!noReschedule) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        this.log.debug('call status polling');
        try {
            const data = await this.sendRequest('/v1/me/player', 'GET', '');
            void this.createPlaybackInfo(data);
            if (!noReschedule) {
                this.scheduleStatusPolling();
            }
        }
        catch (err) {
            const errStr = err.toString();
            if (!errStr.includes('202')) {
                this.application.error202shown = false;
            }
            if (errStr.includes('429') ||
                errStr.includes('202') ||
                errStr.includes('401') ||
                errStr.includes('500') ||
                errStr.includes('502') ||
                errStr.includes('503') ||
                errStr.includes('504')) {
                if (errStr.includes('202')) {
                    if (!this.application.error202shown) {
                        this.log.debug('unexpected api response http 202; continue polling; nothing is wrong with the adapter; you will see a 202 response the first time a user connects to the spotify connect api or when the device is temporarily unavailable');
                    }
                    this.application.error202shown = true;
                }
                else if (errStr.includes('429')) {
                    this.log.debug('We are currently being rate limited, waiting for next update ...');
                }
                else {
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
            }
            else {
                // other errors stop the polling
                this.log.error(`spotify status polling stopped with error ${err}`);
            }
        }
    }
    scheduleDevicePollingWithOffset() {
        if (this.application.devicePollingHandle) {
            clearTimeout(this.application.devicePollingHandle);
            this.application.devicePollingHandle = undefined;
        }
        if (this.application.devicePollingDelaySeconds > 0) {
            // Device polling offset: 1/3 of status interval (stagger from status)
            const offsetMs = (this.application.statusPollingDelaySeconds * 1000) / 3;
            this.application.devicePollingHandle = setTimeout(() => {
                this.application.devicePollingHandle = undefined;
                if (!this.stopped) {
                    this.pollDeviceApi().catch(e => this.log.error(e));
                }
            }, this.application.devicePollingDelaySeconds * 1000 + offsetMs);
        }
    }
    scheduleDevicePolling() {
        if (this.application.devicePollingHandle) {
            clearTimeout(this.application.devicePollingHandle);
            this.application.devicePollingHandle = undefined;
        }
        if (this.application.devicePollingDelaySeconds > 0) {
            this.application.devicePollingHandle = setTimeout(() => {
                this.application.devicePollingHandle = undefined;
                if (!this.stopped) {
                    this.pollDeviceApi().catch(e => this.log.error(e));
                }
            }, this.application.devicePollingDelaySeconds * 1000);
        }
    }
    async pollDeviceApi() {
        this.log.debug('call device polling');
        try {
            const data = await this.sendRequest('/v1/me/player/devices', 'GET', '');
            await this.reloadDevices(data);
            this.scheduleDevicePollingWithOffset();
        }
        catch (err) {
            const errStr = err.toString();
            if (errStr.includes('401') ||
                errStr.includes('429') ||
                errStr.includes('500') ||
                errStr.includes('502') ||
                errStr.includes('503') ||
                errStr.includes('504')) {
                // Keep polling running for temporary errors
                if (errStr.includes('401')) {
                    this.log.warn('Device polling: 401 Unauthorized - token refresh should be in progress, continuing polling');
                }
                else if (errStr.includes('429')) {
                    this.log.debug('Device polling: Rate limited (429), will retry');
                }
                else {
                    this.log.warn(`Device polling: Temporary error ${err}, continuing polling`);
                }
                this.scheduleDevicePolling();
            }
            else {
                this.log.error(`spotify device polling stopped with error ${err}`);
            }
        }
    }
    schedulePlaylistPolling() {
        if (this.application.playlistPollingHandle) {
            clearTimeout(this.application.playlistPollingHandle);
            this.application.playlistPollingHandle = undefined;
        }
        if (this.application.playlistPollingDelaySeconds > 0) {
            this.application.playlistPollingHandle = setTimeout(() => {
                this.application.playlistPollingHandle = undefined;
                if (!this.stopped) {
                    this.pollPlaylistApi();
                }
            }, this.application.playlistPollingDelaySeconds * 1000);
        }
    }
    pollPlaylistApi() {
        void this.reloadUsersPlaylist();
        this.schedulePlaylistPolling();
    }
    async startPlaylist(playlist, owner, trackNo, keepTrack) {
        if ((0, utils_1.isEmpty)(owner)) {
            owner = this.application.userId;
        }
        if ((0, utils_1.isEmpty)(trackNo)) {
            throw new Error('no track no');
        }
        if ((0, utils_1.isEmpty)(playlist)) {
            throw new Error('no playlist no');
        }
        if (keepTrack !== true) {
            keepTrack = false;
        }
        let resetShuffle = false;
        if (this.application.keepShuffleState) {
            const state = this.cache.getValue('player.shuffle');
            if (state?.val) {
                resetShuffle = true;
                if (!keepTrack) {
                    const tracksTotal = this.cache.getValue(`playlists.${this.shrinkStateName(`${owner}-${playlist}`)}.tracksTotal`);
                    if (tracksTotal?.val) {
                        trackNo = Math.floor(Math.random() * Math.floor(tracksTotal.val));
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
            setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
        }
        catch (err) {
            this.log.error(`could not start playlist ${playlist} of user ${owner}; error: ${err}`);
        }
        if (this.application.keepShuffleState && resetShuffle) {
            if (this.config.defaultShuffle === 'off') {
                return this.listenOnShuffleOff();
            }
            return this.listenOnShuffleOn();
        }
    }
    async listenOnAuthorized(obj) {
        if (obj.state.val) {
            const wasConnected = this.cache.getValue('info.connection');
            let expiresAtMs = 0;
            try {
                const tokenObj = JSON.parse(obj.state.val);
                this.application.token = tokenObj.access_token;
                this.application.refreshToken = tokenObj.refresh_token;
                expiresAtMs = this.getTokenExpiresAtMs(tokenObj);
            }
            catch (err) {
                this.log.error(err);
            }
            if (!wasConnected?.val) {
                await this.start();
            }
            else {
                this.scheduleTokenRefresh(expiresAtMs, 'refreshToken');
                // Stagger initial poll schedules to prevent simultaneous requests from causing rate limiting
                // Status polling starts immediately
                this.scheduleStatusPolling();
                // Device polling starts after small offset (~1/3 of status interval)
                const deviceOffset = (this.application.statusPollingDelaySeconds * 1000) / 3;
                if (this.application.devicePollingHandle) {
                    clearTimeout(this.application.devicePollingHandle);
                    this.application.devicePollingHandle = undefined;
                }
                this.application.devicePollingHandle = setTimeout(() => {
                    this.application.devicePollingHandle = undefined;
                    if (!this.stopped) {
                        this.scheduleDevicePolling();
                    }
                }, deviceOffset);
                // Playlist polling starts after larger offset (~2/3 of status interval)
                const playlistOffset = (this.application.statusPollingDelaySeconds * 1000 * 2) / 3;
                if (this.application.playlistPollingHandle) {
                    clearTimeout(this.application.playlistPollingHandle);
                    this.application.playlistPollingHandle = undefined;
                }
                this.application.playlistPollingHandle = setTimeout(() => {
                    this.application.playlistPollingHandle = undefined;
                    if (!this.stopped) {
                        this.schedulePlaylistPolling();
                    }
                }, playlistOffset);
            }
        }
    }
    async listenOnUseForPlayback(obj) {
        const lastDeviceId = this.cache.getValue(`${obj.id.slice(0, obj.id.lastIndexOf('.'))}.id`);
        if (!lastDeviceId) {
            return;
        }
        this.deviceData.lastSelectDeviceId = lastDeviceId.val;
        const send = {
            device_ids: [this.deviceData.lastSelectDeviceId],
            play: true,
        };
        try {
            await this.sendRequest('/v1/me/player', 'PUT', JSON.stringify(send), true);
            setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
    }
    listenOnTrackList(obj) {
        if (obj.state.val >= 0) {
            void this.listenOnPlayThisList(obj, obj.state.val);
        }
    }
    listenOnPlayThisList(obj, pos) {
        let keepTrack = true;
        if (typeof pos !== 'number') {
            keepTrack = false;
            pos = 0;
        }
        // Play a specific playlist immediately
        const idState = this.cache.getValue(`${obj.id.slice(0, obj.id.lastIndexOf('.'))}.id`);
        const ownerState = this.cache.getValue(`${obj.id.slice(0, obj.id.lastIndexOf('.'))}.owner`);
        if (!idState || !ownerState) {
            return;
        }
        const id = idState.val;
        const owner = ownerState.val;
        return this.startPlaylist(id, owner, pos, keepTrack);
    }
    listenOnDeviceList(obj) {
        if (!(0, utils_1.isEmpty)(obj.state.val)) {
            void this.listenOnUseForPlayback({ id: `devices.${obj.state.val}.useForPlayback` });
        }
    }
    listenOnPlaylistList(obj) {
        if (!(0, utils_1.isEmpty)(obj.state.val)) {
            void this.listenOnPlayThisList({ id: `playlists.${obj.state.val}.playThisList` });
        }
    }
    async listenOnPlayUri(obj) {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        const send = obj.state.val;
        if (!(0, utils_1.isEmpty)(send.device_id)) {
            query.device_id = send.device_id;
            delete send.device_id;
        }
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        try {
            await this.sendRequest(`/v1/me/player/play?${node_querystring_1.default.stringify(query)}`, 'PUT', JSON.stringify(send), true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
    }
    listenOnPlay() {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        this.log.debug(this.getSelectedDevice(this.deviceData));
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        void this.sendRequest(`/v1/me/player/play?${node_querystring_1.default.stringify(query)}`, 'PUT', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }
    listenOnPause() {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        void this.sendRequest(`/v1/me/player/pause?${node_querystring_1.default.stringify(query)}`, 'PUT', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }
    listenOnSkipPlus() {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        void this.sendRequest(`/v1/me/player/next?${node_querystring_1.default.stringify(query)}`, 'POST', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }
    listenOnSkipMinus() {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        void this.sendRequest(`/v1/me/player/previous?${node_querystring_1.default.stringify(query)}`, 'POST', '', true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }
    listenOnRepeat(obj) {
        if (['track', 'context', 'off'].indexOf(obj.state.val) >= 0) {
            if (this.application.statusInternalTimer) {
                clearTimeout(this.application.statusInternalTimer);
                this.application.statusInternalTimer = undefined;
            }
            void this.sendRequest(`/v1/me/player/repeat?state=${obj.state.val}`, 'PUT', '', true)
                .catch(err => this.log.error(`could not execute command: ${err}`))
                .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
        }
    }
    listenOnRepeatTrack() {
        this.listenOnRepeat({
            state: {
                val: 'track',
            },
        });
    }
    listenOnRepeatContext() {
        this.listenOnRepeat({
            state: {
                val: 'context',
            },
        });
    }
    listenOnRepeatOff() {
        this.listenOnRepeat({
            state: {
                val: 'off',
            },
        });
    }
    listenOnRepeatMode(obj) {
        const map = { 0: 'off', 1: 'context', 2: 'track' };
        const val = map[obj.state.val];
        if (val) {
            this.listenOnRepeat({ state: { val } });
        }
    }
    listenOnVolume(obj) {
        const isPlay = this.cache.getValue('player.isPlaying');
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
    listenOnProgressMs(obj) {
        const progress = obj.state.val;
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        void this.sendRequest(`/v1/me/player/seek?position_ms=${progress}`, 'PUT', '', true)
            .then(() => {
            const durationState = this.cache.getValue('player.durationMs');
            if (durationState) {
                const duration = durationState.val;
                if (duration > 0 && duration <= progress) {
                    const progressPercentage = Math.floor((progress / duration) * 100);
                    return Promise.all([
                        this.cache.setValue('player.progressMs', progress),
                        this.cache.setValue('player.progress', this.convertToDigiClock(progress)),
                        this.cache.setValue('player.progressPercentage', progressPercentage),
                    ]);
                }
            }
        })
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }
    listenOnProgressPercentage(obj) {
        const progressPercentage = obj.state.val;
        if (progressPercentage < 0 || progressPercentage > 100) {
            return;
        }
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        const durationState = this.cache.getValue('player.durationMs');
        if (durationState) {
            const duration = durationState.val;
            if (duration > 0) {
                const progress = Math.floor((progressPercentage / 100) * duration);
                void this.sendRequest(`/v1/me/player/seek?position_ms=${progress}`, 'PUT', '', true)
                    .then(() => Promise.all([
                    this.cache.setValue('player.progressMs', progress),
                    this.cache.setValue('player.progress', this.convertToDigiClock(progress)),
                    this.cache.setValue('player.progressPercentage', progressPercentage),
                ]))
                    .catch(err => this.log.error(`could not execute command: ${err}`))
                    .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
            }
        }
    }
    async listenOnShuffle(obj) {
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        try {
            await this.sendRequest(`/v1/me/player/shuffle?state=${obj.state.val === 'on' ? 'true' : 'false'}`, 'PUT', '', true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => !this.stopped && this.pollStatusApi(), 1000);
    }
    listenOnShuffleOff() {
        return this.listenOnShuffle({
            state: {
                val: 'off',
                ack: false,
            },
        });
    }
    listenOnShuffleOn() {
        return this.listenOnShuffle({
            state: {
                val: 'on',
                ack: false,
            },
        });
    }
    listenOnShuffleBool(obj) {
        return this.listenOnShuffle({
            state: {
                val: obj.state.val ? 'on' : 'off',
                ack: false,
            },
        });
    }
    listenOnTrackId(obj) {
        const send = {
            uris: [`spotify:track:${obj.state.val}`],
            offset: {
                position: 0,
            },
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = undefined;
        }
        void this.sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), true)
            .catch(err => this.log.error(`could not execute command: ${err}`))
            .then(() => setTimeout(() => !this.stopped && this.pollStatusApi(), 1000));
    }
    listenOnPlaylistId(obj) {
        const ownerState = this.cache.getValue('player.playlist.owner');
        if (!ownerState) {
            return;
        }
        return this.startPlaylist(obj.state.val, ownerState.val, 0);
    }
    listenOnPlaylistOwner(obj) {
        const PlayListIdState = this.cache.getValue('player.playlist.id');
        if (!PlayListIdState) {
            return;
        }
        return this.startPlaylist(PlayListIdState.val, obj.state.val, 0);
    }
    listenOnPlaylistTrackNo(obj) {
        const PlayListIdState = this.cache.getValue('player.playlist.id');
        const ownerState = this.cache.getValue('player.playlist.owner');
        if (!PlayListIdState || !ownerState) {
            return;
        }
        const owner = ownerState.val;
        const id = PlayListIdState.val;
        let o = obj.state.val;
        o = parseInt(o, 10) || 1;
        return this.startPlaylist(id, owner, o - 1, true);
    }
    listenOnGetPlaybackInfo() {
        return this.pollStatusApi(true);
    }
    async listenOnGetDevices() {
        try {
            const data = await this.sendRequest('/v1/me/player/devices', 'GET', '');
            await this.reloadDevices(data);
        }
        catch (error) {
            this.log.debug(error);
        }
    }
    clearCache() {
        this.artistImageUrlCache = {};
        this.playlistCache = {};
        if (this.application.cacheClearHandle) {
            clearTimeout(this.application.cacheClearHandle);
            this.application.cacheClearHandle = undefined;
        }
        this.application.cacheClearHandle = setTimeout(() => {
            this.application.cacheClearHandle = undefined;
            if (!this.stopped) {
                this.clearCache();
            }
        }, 1000 * 60 * 60 * 24);
    }
    async listenOnHtmlPlaylists() {
        const objCurrent = this.cache.getValue('playlists.playlistList');
        const current = objCurrent?.val || '';
        const objIds = this.cache.getValue('playlists.playlistListIds');
        if (!objIds?.val) {
            await this.cache.setValue('html.playlists', '');
            return;
        }
        const ids = objIds.val.split(';');
        const objStrings = this.cache.getValue('playlists.playlistListString');
        if (!objStrings?.val) {
            await this.cache.setValue('html.playlists', '');
            return;
        }
        const strings = objStrings.val.split(';');
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
            html += strings[i] || '';
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
        return this.cache.setValue('html.playlists', html);
    }
    listenOnHtmlTracklist() {
        void this.getStateAsync('player.trackId')
            .then(state => {
            let currentTrackID;
            if (!state?.val) {
                currentTrackID = '';
            }
            else {
                currentTrackID = state.val;
            }
            const obj = this.cache.getValue('player.playlist.trackListArray');
            if (!obj?.val) {
                return this.cache.setValue('html.tracks', '');
            }
            let source = [];
            if (typeof obj.val === 'string') {
                try {
                    source = JSON.parse(obj.val);
                }
                catch (e) {
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
                }
                else {
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
            return this.cache.setValue('html.tracks', html);
        })
            .catch(err => {
            this.log.error(err);
        });
    }
    async listenOnHtmlDevices() {
        let obj = this.cache.getValue('devices.deviceList');
        let current;
        if (!obj?.val) {
            current = '';
        }
        else {
            current = obj.val;
        }
        obj = this.cache.getValue('devices.deviceListIds');
        if (!obj?.val) {
            await this.cache.setValue('html.devices', '');
            return;
        }
        const ids = obj.val.split(';');
        obj = this.cache.getValue('devices.availableDeviceListString');
        if (!obj?.val) {
            await this.cache.setValue('html.devices', '');
            return;
        }
        const strings = obj.val.split(';');
        let html = '<table class="spotifyDevicesTable">';
        for (let i = 0; i < ids.length; i++) {
            const typeState = this.cache.getValue(`devices.${ids[i]}.type`);
            if (!typeState) {
                continue;
            }
            const type = this.getIconByType(typeState.val);
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
            }
            else {
                html += `<img style="width: 16px; height: 16px" class="spotifyDevicesIcon" src="widgets/spotify-premium/img/${type.replace('icons/', '')}" />`;
            }
            html += '</td>';
            html += `<td${style} class="spotifyDevicesColName${cssClassColName}">`;
            html += strings[i] || '';
            html += '</td>';
            html += '</tr>';
        }
        html += '</table>';
        void this.cache.setValue('html.devices', html);
    }
}
exports.SpotifyPremiumAdapter = SpotifyPremiumAdapter;
if (require.main !== module) {
    module.exports = (options) => new SpotifyPremiumAdapter(options);
}
else {
    new SpotifyPremiumAdapter();
}
//# sourceMappingURL=main.js.map