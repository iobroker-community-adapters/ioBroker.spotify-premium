"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyPremiumAdapter = void 0;
const adapter_core_1 = require("@iobroker/adapter-core");
const cache = __importStar(require("./lib/cache"));
const utils_1 = require("./lib/utils");
const node_querystring_1 = require("node:querystring");
// @ts-expect-error no types
const dns_lookup_cache_1 = require("dns-lookup-cache");
const axios_1 = __importDefault(require("axios"));
const TokenRefresher_1 = require("./lib/TokenRefresher");
class SpotifyPremiumAdapter extends adapter_core_1.Adapter {
    artistImageUrlCache = {};
    playlistCache = {};
    tokenWorker;
    application = {
        userId: '',
        baseUrl: 'https://api.spotify.com',
        deleteDevices: false,
        deletePlaylists: false,
        keepShuffleState: true,
        redirect_uri: 'http://127.0.0.1/callback',
        statusInternalTimer: null,
        statusPollingHandle: null,
        statusPollingDelaySeconds: 5,
        devicePollingHandle: null,
        devicePollingDelaySeconds: 300,
        playlistPollingHandle: null,
        playlistPollingDelaySeconds: 900,
        error202shown: false,
        cacheClearHandle: null,
    };
    deviceData = {
        lastActiveDeviceId: '',
        lastSelectDeviceId: '',
    };
    stopped = false;
    tooManyRequests = false;
    constructor(options) {
        super({
            ...options,
            name: 'spotify-premium',
            stateChange: (id, state) => {
                if (id === `${this.namespace}.oauth2Tokens`) {
                    this.tokenWorker?.onStateChange(id, state);
                }
                else {
                    cache.setExternal(id, state);
                }
            },
            objectChange: (id, obj) => cache.setExternalObj(id, obj),
            ready: () => {
                this.tokenWorker = new TokenRefresher_1.TokenRefresher(this, 'spotify');
                cache.on(/\.useForPlayback$/, this.listenOnUseForPlayback);
                cache.on(/\.trackList$/, this.listenOnTrackList, true);
                cache.on(/\.playThisList$/, this.listenOnPlayThisList);
                cache.on('devices.deviceList', this.listenOnDeviceList, true);
                cache.on('playlists.playlistList', this.listenOnPlaylistList, true);
                cache.on('player.play', this.listenOnPlay);
                cache.on('player.playUri', this.listenOnPlayUri);
                cache.on('player.pause', this.listenOnPause);
                cache.on('player.skipPlus', this.listenOnSkipPlus);
                cache.on('player.skipMinus', this.listenOnSkipMinus);
                cache.on('player.repeat', this.listenOnRepeat, true);
                cache.on('player.repeatTrack', this.listenOnRepeatTrack);
                cache.on('player.repeatContext', this.listenOnRepeatContext);
                cache.on('player.repeatOff', this.listenOnRepeatOff);
                cache.on('player.volume', this.listenOnVolume, true);
                cache.on('player.progressMs', this.listenOnProgressMs, true);
                cache.on('player.progressPercentage', this.listenOnProgressPercentage, true);
                cache.on('player.shuffle', this.listenOnShuffle, (this.config.defaultShuffle || 'on') === 'on');
                cache.on('player.shuffleOff', this.listenOnShuffleOff);
                cache.on('player.shuffleOn', this.listenOnShuffleOn);
                cache.on('player.trackId', this.listenOnTrackId, true);
                cache.on('player.playlist.id', this.listenOnPlaylistId, true);
                cache.on('player.playlist.owner', this.listenOnPlaylistOwner, true);
                cache.on('player.playlist.trackNo', this.listenOnPlaylistTrackNo, true);
                cache.on('getPlaylists', this.reloadUsersPlaylist);
                cache.on('getPlaybackInfo', this.listenOnGetPlaybackInfo);
                cache.on('getDevices', this.listenOnGetDevices);
                cache.on(['playlists.playlistList', 'playlists.playlistListIds', 'playlists.playlistListString'], this.listenOnHtmlPlaylists);
                cache.on(['player.playlist.trackList', 'player.playlist.trackListArray'], this.listenOnHtmlTracklist);
                cache.on(['devices.deviceList', 'devices.deviceListIds', 'devices.availableDeviceListString'], this.listenOnHtmlDevices);
                void cache.init().then(() => this.main());
            },
            unload: callback => {
                this.stopped = true;
                this.tokenWorker?.destroy();
                if (this.application.statusPollingHandle) {
                    clearTimeout(this.application.statusPollingHandle);
                    this.application.statusPollingHandle = null;
                }
                if (this.application.statusInternalTimer) {
                    clearTimeout(this.application.statusInternalTimer);
                    this.application.statusInternalTimer = null;
                }
                if (this.application.devicePollingHandle) {
                    clearTimeout(this.application.devicePollingHandle);
                    this.application.devicePollingHandle = null;
                }
                if (this.application.playlistPollingHandle) {
                    clearTimeout(this.application.playlistPollingHandle);
                    this.application.playlistPollingHandle = null;
                }
                if (this.application.cacheClearHandle) {
                    clearTimeout(this.application.cacheClearHandle);
                    this.application.cacheClearHandle = null;
                }
                void Promise.all([
                    cache.setValue('player.trackId', ''),
                    cache.setValue('player.playlist.id', ''),
                    cache.setValue('player.playlist.trackNo', 0),
                    cache.setValue('player.playlist.owner', ''),
                    cache.setValue('info.connection', false),
                ]).then(() => {
                    callback();
                });
            },
        });
        cache.setAdapter(this);
    }
    main() {
        this.application.deleteDevices = this.config.delete_devices;
        this.application.deletePlaylists = this.config.delete_playlists;
        this.application.statusPollingDelaySeconds = this.config.status_interval;
        this.application.keepShuffleState = this.config.keep_shuffle_state;
        let deviceInterval = this.config.device_interval;
        let playlistInterval = this.config.playlist_interval;
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
        if ((0, utils_1.isEmpty)(deviceInterval)) {
            deviceInterval = 0;
        }
        if ((0, utils_1.isEmpty)(playlistInterval)) {
            playlistInterval = 0;
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
        void this.start();
    }
    async start() {
        this.clearCache();
        try {
            const data = await this.sendRequest('/v1/me', 'GET', '');
            if (data) {
                this.setUserInformation(data);
            }
            else {
                this.log.warn('Cannot get user info');
                return;
            }
        }
        catch (error) {
            this.log.warn(`Cannot get user info: ${error}`);
            await cache.setValue('info.connection', false);
            return;
        }
        await cache.setValue('info.connection', true);
        this.listenOnGetPlaybackInfo();
        await this.reloadUsersPlaylist().catch(() => { });
        this.listenOnGetDevices();
    }
    async sendRequest(endPoint, method, sendBody, delayAccepted) {
        const token = await this.tokenWorker?.getAccessToken();
        if (!token) {
            throw new Error('Unable to get access token');
        }
        const options = {
            url: this.application.baseUrl + endPoint,
            method,
            lookup: dns_lookup_cache_1.lookup, // DNS caching
            headers: {
                Authorization: `Bearer ${token}`,
            },
            form: sendBody,
        };
        this.log.debug(`spotify api call... ${endPoint}; ${options.form}`);
        if (this.tooManyRequests) {
            // We are currently blocked because of too many requests. Do not send out a new request.
            this.log.debug(`TooManyRequests: ${this.tooManyRequests} endpoint: ${endPoint}`);
            throw new Error('429');
        }
        const response = await (0, axios_1.default)(options);
        switch (response.status) {
            case 200:
                // OK
                return response.data;
            case 202:
                // Accepted, processing has not been completed.
                this.log.debug(`http response: ${JSON.stringify(response)}`);
                if (delayAccepted) {
                    return null;
                }
                throw new Error(response.status.toString());
            case 204:
                // OK, No Content
                return null;
            case 400: // Bad Request, message body will contain more information
            case 500: // Server Error
            case 503: // Service Unavailable
            case 404: // Not Found
            case 502:
                // Bad Gateway
                throw new Error(response.status.toString());
            case 403:
            case 401:
                // Unauthorized
                if (response.data?.error.message === 'The access token expired') {
                    this.log.debug('access token expired!');
                    await cache.setValue('info.connection', false);
                    throw new Error('Access token expired!');
                }
                else {
                    if (response.status === 403) {
                        this.log.warn('Seems that the token is expired!');
                        this.log.warn(`status code: ${response.status}`);
                        this.log.warn(`body: ${JSON.stringify(response.data)}`);
                    }
                    // if other error with code 401
                    await cache.setValue('info.connection', false);
                    this.log.error(response.data?.error.message || JSON.stringify(response.data));
                    throw new Error(response.status.toString());
                }
            case 429: {
                // Too Many Requests
                let wait = 1;
                if (response.headers?.['retry-after'] > 0) {
                    wait = response.headers['retry-after'];
                    this.tooManyRequests = true;
                    this.log.warn(`too many requests, wait ${wait}s`);
                }
                if (!this.stopped) {
                    await new Promise(resolve => setTimeout(() => resolve(), wait * 1000));
                    this.tooManyRequests = false;
                    return await this.sendRequest(endPoint, method, sendBody, delayAccepted);
                }
                break;
            }
            default:
                this.log.warn('http request error not handled, please debug');
                this.log.debug(`status code: ${response.status}`);
                this.log.debug(`body: ${JSON.stringify(response.data)}`);
                throw new Error(response.status.toString());
        }
        return null;
    }
    static loadOrDefault(obj, name, defaultVal) {
        let t;
        try {
            const f = new Function('obj', 'name', `return obj.${name}`);
            t = f(obj, name);
        }
        catch (e) {
            if (!obj) {
                console.error(e);
            }
        }
        if (t === undefined) {
            t = defaultVal;
        }
        return t;
    }
    createOrDefault(obj, name, state, defaultVal, description, type, states) {
        const t = SpotifyPremiumAdapter.loadOrDefault(obj, name, defaultVal);
        const object = {
            _id: `${this.namespace}.${state}`,
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
        if (!(0, utils_1.isEmpty)(states)) {
            object.common.states = states;
        }
        return cache.setValue(state, t, object);
    }
    static setOrDefault(obj, name, state, defaultVal) {
        const t = SpotifyPremiumAdapter.loadOrDefault(obj, name, defaultVal);
        return cache.setValue(state, t);
    }
    static shrinkStateName(v) {
        let n = v.replace(/[\s."`'*,\\?<>[\];:]+/g, '');
        if ((0, utils_1.isEmpty)(n)) {
            n = 'onlySpecialCharacters';
        }
        return n;
    }
    static getArtistNamesOrDefault(data, isTrack) {
        if (!data) {
            return '';
        }
        const ret = [];
        const artists = isTrack ? data.track.artists : data.item.artists;
        for (let i = 0; i < artists.length; i++) {
            const artist = artists[i].name || '';
            if (artist) {
                ret.push(artist);
            }
            else {
                break;
            }
        }
        return ret.join(', ');
    }
    static setObjectStatesIfChanged(id, states) {
        const obj = cache.getObj(id) || {
            _id: id,
            common: {
                name: '',
                type: 'string',
                role: 'value',
                states,
                read: true,
                write: true,
            },
            type: 'state',
            native: {},
        };
        return cache.setValue(id, null, {
            _id: id,
            type: 'state',
            common: {
                name: obj.common.name,
                type: obj.common.type,
                role: obj.common.role || 'state',
                states,
                read: obj.common.read,
                write: obj.common.write,
            },
            native: {},
        });
    }
    async copyState(src, dst) {
        const tmpSrc = cache.getValue(src);
        if (tmpSrc) {
            await cache.setValue(dst, tmpSrc.val);
        }
        this.log.debug('bei copyState: fehlerhafte Playlists-Daten src');
    }
    async copyObjectStates(src, dst) {
        const tmpSrc = cache.getObj(src);
        if (tmpSrc?.common) {
            await SpotifyPremiumAdapter.setObjectStatesIfChanged(dst, tmpSrc.common.states);
        }
        this.log.debug('bei copyObjectStates: fehlerhafte Playlists-Daten src');
    }
    async createPlaybackInfo(data) {
        if ((0, utils_1.isEmpty)(data)) {
            data = {};
        }
        const deviceId = data?.device?.id || '';
        const isDeviceActive = data?.device?.is_active || false;
        const isDeviceRestricted = data?.device?.is_restricted || false;
        const deviceName = data?.device?.name || '';
        const deviceType = data?.device?.type || '';
        const deviceVolume = data?.device?.volume_percent || 100;
        const isPlaying = data?.is_playing || false;
        const duration = data?.item?.duration_ms || 0;
        let type = data?.context?.type || '';
        if (!type) {
            type = data?.item?.type || '';
        }
        const progress = data?.progress_ms || 0;
        let progressPercentage = 0;
        if (duration > 0) {
            progressPercentage = Math.floor((progress / duration) * 100);
        }
        let contextDescription = '';
        let contextImage = '';
        const album = data?.item?.album.name || '';
        const albumUrl = data?.item?.album?.images?.[0]?.url || '';
        const artist = SpotifyPremiumAdapter.getArtistNamesOrDefault(data);
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
        const shuffle = data?.shuffle_state || false;
        await cache.setValue('player.device.id', deviceId);
        await cache.setValue('player.device.isActive', isDeviceActive);
        await cache.setValue('player.device.isRestricted', isDeviceRestricted);
        await cache.setValue('player.device.name', deviceName);
        await cache.setValue('player.device.type', deviceType);
        await cache.setValue('player.device.volume', { val: deviceVolume, ack: true });
        await cache.setValue('player.device.isAvailable', !(0, utils_1.isEmpty)(deviceName));
        await cache.setValue('player.device', null, {
            type: 'device',
            _id: `${this.namespace}.player.device`,
            common: {
                name: (0, utils_1.isEmpty)(deviceName)
                    ? 'Commands to control playback related to the current active device'
                    : deviceName,
                icon: SpotifyPremiumAdapter.getIconByType(deviceType),
            },
            native: {},
        });
        await cache.setValue('player.isPlaying', isPlaying);
        await SpotifyPremiumAdapter.setOrDefault(data, 'item.id', 'player.trackId', '');
        await cache.setValue('player.artistName', artist);
        await cache.setValue('player.album', album);
        await cache.setValue('player.albumImageUrl', albumUrl);
        await SpotifyPremiumAdapter.setOrDefault(data, 'item.name', 'player.trackName', '');
        await cache.setValue('player.durationMs', duration);
        await cache.setValue('player.duration', SpotifyPremiumAdapter.convertToDigiClock(duration));
        await cache.setValue('player.type', type);
        await cache.setValue('player.progressMs', progress);
        await cache.setValue('player.progressPercentage', progressPercentage);
        await cache.setValue('player.progress', SpotifyPremiumAdapter.convertToDigiClock(progress));
        await cache.setValue('player.shuffle', shuffle ? 'on' : 'off');
        await SpotifyPremiumAdapter.setOrDefault(data, 'repeat_state', 'player.repeat', 'off');
        await SpotifyPremiumAdapter.setOrDefault(data, 'device.volume_percent', 'player.device.volume', 100);
        if (deviceName) {
            this.deviceData.lastActiveDeviceId = deviceId;
            const states = cache.getValues('devices.*');
            const keys = Object.keys(states);
            for (let i = 0; i < keys.length; i++) {
                let key = keys[i];
                if (!key.endsWith('.isActive')) {
                    continue;
                }
                key = (0, utils_1.removeNameSpace)(key);
                let name = '';
                if (deviceId != null) {
                    name = SpotifyPremiumAdapter.shrinkStateName(deviceId);
                }
                else {
                    name = SpotifyPremiumAdapter.shrinkStateName(deviceName);
                }
                if (key !== `devices.${name}.isActive`) {
                    await cache.setValue(key, false);
                }
            }
            await this.createDevices({
                devices: [
                    {
                        id: deviceId,
                        is_active: isDeviceActive,
                        is_restricted: isDeviceRestricted,
                        name: deviceName,
                        type: deviceType,
                        volume_percent: deviceVolume,
                        is_private_session: false,
                        supports_volume: false,
                    },
                ],
            });
            await this.refreshDeviceList();
        }
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            if (!keys[i].endsWith('.isActive')) {
                continue;
            }
            const key = (0, utils_1.removeNameSpace)(keys[i]);
            await cache.setValue(key, false);
        }
        if (progress && isPlaying && this.application.statusPollingDelaySeconds > 0) {
            this.scheduleStatusInternalTimer(duration, progress, Date.now(), this.application.statusPollingDelaySeconds - 1);
        }
        const artists = [];
        for (let i = 0; i < (data?.item?.artists?.length || 0); i++) {
            const id = data?.item.artists[i].id || '';
            if (!id) {
                break;
            }
            else {
                artists.push(id);
            }
        }
        const urls = [];
        for (let a = 0; a < artists.length; a++) {
            if (Object.prototype.hasOwnProperty.call(this.artistImageUrlCache, artist)) {
                urls.push(this.artistImageUrlCache[artist]);
            }
            else {
                try {
                    const parseJson = await this.sendRequest(`/v1/artists/${artist}`, 'GET', '');
                    if (parseJson) {
                        const url = parseJson.images?.[0]?.url || '';
                        if (!(0, utils_1.isEmpty)(url)) {
                            this.artistImageUrlCache[artist] = url;
                            urls.push(url);
                        }
                        else {
                            urls.push('');
                        }
                    }
                    else {
                        urls.push('');
                    }
                }
                catch (e) {
                    urls.push('');
                    this.log.warn(`Cannot read artist URL: ${e}`);
                }
            }
        }
        let set = '';
        if (urls.length !== 0) {
            set = urls[0];
        }
        if (type === 'artist') {
            contextImage = set;
        }
        await cache.setValue('player.artistImageUrl', set);
        const uri = data?.context.uri;
        if (type === 'playlist' && uri) {
            // analyse 'spotify:playlist:5YdzWDdasdayVslAuNAey5'
            let playlistId = '';
            let userId = null;
            if (uri.startsWith('spotify:user:')) {
                // Format: spotify:user:USER:playlist:PLAYLIST
                const match = uri.match(/^spotify:user:([^:]+):playlist:([^:]+)$/);
                if (match) {
                    userId = match[1];
                    playlistId = match[2];
                }
                else {
                    playlistId = '';
                }
            }
            else if (uri.startsWith('spotify:playlist:')) {
                // Format: spotify:playlist:PLAYLIST
                playlistId = uri.split(':')[2];
                userId = null;
            }
            const query = {
                fields: 'name,id,owner.id,tracks.total,images',
            };
            await cache.setValue('player.playlist.id', playlistId);
            let rawData = null;
            if (playlistId) {
                if (!this.playlistCache[`${userId}-${playlistId}`]) {
                    if (userId) {
                        rawData = await this.sendRequest(`/v1/users/${userId}/playlists/${playlistId}?${(0, node_querystring_1.stringify)(query)}`, 'GET', '').catch(error => {
                            this.log.debug(error);
                            return null;
                        });
                    }
                    else {
                        rawData = await this.sendRequest(`/v1/playlists/${playlistId}?${(0, node_querystring_1.stringify)(query)}`, 'GET', '').catch(error => {
                            this.log.debug(error);
                            return null;
                        });
                    }
                }
                else {
                    rawData = this.playlistCache[`${userId}-${playlistId}`].rawData;
                }
            }
            if (rawData) {
                const playlistName = SpotifyPremiumAdapter.loadOrDefault(rawData, 'name', '');
                contextDescription = `Playlist: ${playlistName}`;
                const songId = data?.item.id || '';
                const playlistImage = SpotifyPremiumAdapter.loadOrDefault(rawData, 'images[0].url', '');
                contextImage = playlistImage;
                const ownerId = SpotifyPremiumAdapter.loadOrDefault(rawData, 'owner.id', '');
                const trackCount = rawData?.tracks?.total || 0;
                const prefix = SpotifyPremiumAdapter.shrinkStateName(`${ownerId}-${playlistId}`);
                this.playlistCache[`${ownerId}-${playlistId}`] = {
                    id: playlistId,
                    name: playlistName,
                    images: [{ url: playlistImage }],
                    owner: { id: ownerId },
                    tracks: { total: trackCount },
                    rawData,
                };
                const trackList = cache.getValue(`playlists.${prefix}.trackList`);
                await cache.setValue('player.playlist.owner', ownerId);
                await cache.setValue('player.playlist.tracksTotal', trackCount);
                await cache.setValue('player.playlist.imageUrl', playlistImage);
                await cache.setValue('player.playlist.name', playlistName);
                await cache.setValue('player.playlist', null, {
                    type: 'channel',
                    _id: `${this.namespace}.player.playlist`,
                    common: {
                        name: (0, utils_1.isEmpty)(playlistName)
                            ? 'Commands to control playback related to the playlist'
                            : playlistName,
                    },
                    native: {},
                });
                if (cache.getValue(`playlists.${prefix}.trackListIds`) === null) {
                    await this.createPlaylists({ items: [rawData] });
                }
                else {
                    await this.refreshPlaylistList();
                }
                await this.copyState(`playlists.${prefix}.trackListNumber`, 'player.playlist.trackListNumber'),
                    await this.copyState(`playlists.${prefix}.trackListString`, 'player.playlist.trackListString'),
                    await this.copyState(`playlists.${prefix}.trackListStates`, 'player.playlist.trackListStates'),
                    await this.copyObjectStates(`playlists.${prefix}.trackList`, 'player.playlist.trackList'),
                    await this.copyState(`playlists.${prefix}.trackListIdMap`, 'player.playlist.trackListIdMap'),
                    await this.copyState(`playlists.${prefix}.trackListIds`, 'player.playlist.trackListIds'),
                    await this.copyState(`playlists.${prefix}.trackListArray`, 'player.playlist.trackListArray');
                if (trackList) {
                    await cache.setValue('player.playlist.trackNo', parseInt(trackList.val, 10) + 1);
                }
                const state = cache.getValue(`playlists.${prefix}.trackListIds`);
                if (state) {
                    const ids = state?.val || '';
                    if (!(0, utils_1.isEmpty)(ids)) {
                        const stateName = ids.split(';');
                        const stateArr = [];
                        for (let i = 0; i < stateName.length; i++) {
                            const ele = stateName[i].split(':');
                            stateArr[parseInt(ele[1], 10)] = ele[0];
                        }
                        const nSongId = parseInt(songId, 10);
                        if (stateArr[nSongId] !== '' && stateArr[nSongId] !== null) {
                            const no = stateArr[nSongId];
                            await cache.setValue(`playlists.${prefix}.trackList`, no);
                            await cache.setValue('player.playlist.trackList', no);
                            await cache.setValue('player.playlist.trackNo', parseInt(no, 10) + 1);
                        }
                    }
                    else {
                        this.log.warn('No track IDS');
                    }
                }
            }
        }
        this.log.debug(`context type: "${type}"`);
        await cache.setValue('player.playlist.id', '');
        await cache.setValue('player.playlist.name', '');
        await cache.setValue('player.playlist.owner', '');
        await cache.setValue('player.playlist.tracksTotal', 0);
        await cache.setValue('player.playlist.imageUrl', '');
        await cache.setValue('player.playlist.trackList', '');
        await cache.setValue('player.playlist.trackListNumber', '');
        await cache.setValue('player.playlist.trackListString', '');
        await cache.setValue('player.playlist.trackListStates', '');
        await cache.setValue('player.playlist.trackListIdMap', '');
        await cache.setValue('player.playlist.trackListIds', '');
        await cache.setValue('player.playlist.trackListArray', '');
        await cache.setValue('player.playlist.trackNo', 0);
        await cache.setValue('playlists.playlistList', '');
        await cache.setValue('player.playlist', null, {
            type: 'channel',
            _id: `${this.namespace}.player.playlist`,
            common: {
                name: 'Commands to control playback related to the playlist',
            },
            native: {},
        });
        this.listenOnHtmlPlaylists();
        this.listenOnHtmlTracklist();
        await cache.setValue('player.contextImageUrl', contextImage);
        await cache.setValue('player.contextDescription', contextDescription);
    }
    static convertToDigiClock(ms) {
        // milliseconds to digital time, e.g. 3:59=238759
        if (!ms) {
            ms = 0;
        }
        if (typeof ms === 'string') {
            ms = parseInt(ms, 10);
        }
        const min = Math.floor(ms / 60000)
            .toString()
            .padStart(2, '0');
        const sec = Math.floor(((ms % 360000) % 60000) / 1000)
            .toString()
            .padStart(2, '0');
        return `${min}:${sec}`;
    }
    setUserInformation(data) {
        this.application.userId = data.id;
    }
    reloadUsersPlaylist = async () => {
        const addedList = await this.getUsersPlaylist(0);
        if (this.application.deletePlaylists) {
            return this.deleteUsersPlaylist(addedList);
        }
        await this.refreshPlaylistList();
    };
    async deleteUsersPlaylist(addedList) {
        const states = cache.getValues('playlists.*');
        const keys = Object.keys(states);
        for (const id of keys) {
            const key = (0, utils_1.removeNameSpace)(id);
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
                await cache.delObject(key);
                if (key.endsWith('.id')) {
                    await cache.delObject(key.substring(0, key.length - 3));
                }
            }
        }
    }
    async createPlaylists(parseJson, autoContinue, addedList) {
        addedList ||= [];
        if (!parseJson?.items) {
            this.log.debug('no playlist content');
            throw new Error('no playlist content');
        }
        for (let i = 0; i < parseJson.items.length; i++) {
            const item = parseJson.items[i];
            const playlistName = item.name || '';
            if ((0, utils_1.isEmpty)(playlistName)) {
                this.log.warn('empty playlist name');
                continue;
            }
            const playlistId = item.id || '';
            const ownerId = item.owner.id || '';
            const trackCount = item?.tracks.total || 0;
            const imageUrl = item?.images[0].url || '';
            this.playlistCache[`${ownerId}-${playlistId}`] = {
                id: playlistId,
                name: playlistName,
                images: [{ url: imageUrl }],
                owner: { id: ownerId },
                tracks: { total: trackCount },
                rawData: item,
            };
            const prefix = `playlists.${SpotifyPremiumAdapter.shrinkStateName(`${ownerId}-${playlistId}`)}`;
            addedList ||= [];
            addedList.push(prefix);
            await cache.setValue(prefix, null, {
                _id: `${this.namespace}.${prefix}`,
                type: 'channel',
                common: { name: playlistName },
                native: {},
            });
            await cache.setValue(`${prefix}.playThisList`, false, {
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
            });
            await this.createOrDefault(item, 'id', `${prefix}.id`, '', 'playlist id', 'string');
            await this.createOrDefault(item, 'owner.id', `${prefix}.owner`, '', 'playlist owner', 'string');
            await this.createOrDefault(item, 'name', `${prefix}.name`, '', 'playlist name', 'string');
            await this.createOrDefault(item, 'tracks.total', `${prefix}.tracksTotal`, '', 'number of songs', 'number');
            await this.createOrDefault(item, 'images[0].url', `${prefix}.imageUrl`, '', 'image url', 'string');
            const playlistObject = await this.getPlaylistTracks(ownerId, playlistId);
            let trackListValue = '';
            const currentPlaylistId = cache.getValue('player.playlist.id')?.val;
            const currentPlaylistOwnerId = cache.getValue('player.playlist.owner')?.val;
            const songId = parseInt(cache.getValue('player.trackId')?.val || '0', 10);
            if (`${ownerId}-${playlistId}` === `${currentPlaylistOwnerId}-${currentPlaylistId}`) {
                const stateName = playlistObject.trackIds.split(';');
                const stateArr = [];
                for (let i = 0; i < stateName.length; i++) {
                    const ele = stateName[i].split(':');
                    stateArr[parseInt(ele[1], 10)] = ele[0];
                }
                if (stateArr[songId] !== '' && stateArr[songId] !== null) {
                    trackListValue = stateArr[songId];
                }
            }
            const stateObj = {};
            const states = (playlistObject.stateString || '').split(';');
            states.forEach(state => {
                const el = state.split(':');
                if (el.length === 2) {
                    stateObj[el[0]] = el[1];
                }
            });
            await cache.setValue(`${prefix}.trackList`, trackListValue, {
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
            });
            await this.createOrDefault(playlistObject, 'listNumber', `${prefix}.trackListNumber`, '', 'contains list of tracks as string, patter: 0;1;2;...', 'string');
            await this.createOrDefault(playlistObject, 'listString', `${prefix}.trackListString`, '', 'contains list of tracks as string, patter: title - artist;title - artist;title - artist;...', 'string');
            await this.createOrDefault(playlistObject, 'stateString', `${prefix}.trackListStates`, '', 'contains list of tracks as string with position, pattern: 0:title - artist;1:title - artist;2:title - artist;...', 'string');
            await this.createOrDefault(playlistObject, 'trackIdMap', `${prefix}.trackListIdMap`, '', 'contains list of track ids as string with position, pattern: 0:id;1:id;2:id;...', 'string');
            await this.createOrDefault(playlistObject, 'trackIds', `${prefix}.trackListIds`, '', 'contains list of track ids as string, pattern: id;id;id;...', 'string');
            await this.createOrDefault(playlistObject, 'songs', `${prefix}.trackListArray`, '', 'contains list of tracks as array object, pattern:\n[{id: "id",\ntitle: "title",\nartistName: "artistName1, artistName2",\nartistArray: [{id: "artistId", name: "artistName"}, {id: "artistId", name: "artistName"}, ...],\nalbum: {id: "albumId", name: "albumName"},\ndurationMs: 253844,\nduration: 4:13,\naddedAt: 15395478261235,\naddedBy: "userId",\ndiscNumber: 1,\nepisode: false,\nexplicit: false,\npopularity: 56\n}, ...]', 'object');
        }
        if (autoContinue && parseJson.items.length !== 0 && parseJson.next !== null) {
            await this.getUsersPlaylist(parseJson.offset + parseJson.limit, addedList);
        }
        return addedList;
    }
    async getUsersPlaylist(offset, addedList) {
        addedList ||= [];
        if (this.application.userId) {
            const query = {
                limit: 30,
                offset,
            };
            try {
                const parsedJson = await this.sendRequest(`/v1/users/${this.application.userId}/playlists?${(0, node_querystring_1.stringify)(query)}`, 'GET', '');
                return await this.createPlaylists(parsedJson, true, addedList);
            }
            catch (err) {
                this.log.error(`playlist error ${err}`);
            }
            return [];
        }
        this.log.warn('no userId');
        throw new Error('no userId');
    }
    getSelectedDevice(deviceData) {
        if (deviceData.lastSelectDeviceId === '') {
            return deviceData.lastActiveDeviceId;
        }
        return deviceData.lastSelectDeviceId;
    }
    static cleanState(str) {
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
        const regParam = `${owner}/playlists/${id}/tracks`;
        while (true) {
            const query = {
                limit: 50,
                offset: offset,
            };
            try {
                // Wait 1s between Playlist updates to avoid getting rate limited
                await new Promise(resolve => setTimeout(resolve, 1000));
                const data = await this.sendRequest(`/v1/users/${regParam}?${(0, node_querystring_1.stringify)(query)}`, 'GET', '');
                let i = offset;
                const no = i.toString();
                data?.items?.forEach(item => {
                    const trackId = item.track.id || '';
                    if ((0, utils_1.isEmpty)(trackId)) {
                        return this.log.debug(`There was a playlist track ignored because of missing id; playlist: ${id}; track no: ${no}`);
                    }
                    const artist = SpotifyPremiumAdapter.getArtistNamesOrDefault(item, true);
                    const artistArray = item?.track.artists;
                    const trackName = item?.track.name || '';
                    const trackDuration = item?.track.duration_ms || 0;
                    const addedAt = item?.added_at || '';
                    const addedBy = item?.added_by?.id || '';
                    const trackAlbumId = item?.track.album.id || '';
                    const trackAlbumName = item?.track.album.name || '';
                    const trackDiscNumber = item?.track.disc_number || 1;
                    const trackEpisode = item?.track.episode || false;
                    const trackExplicit = item?.track.explicit || false;
                    const trackPopularity = item?.track.popularity || 0;
                    if (playlistObject.songs.length > 0) {
                        playlistObject.stateString += ';';
                        playlistObject.listString += ';';
                        playlistObject.trackIdMap += ';';
                        playlistObject.trackIds += ';';
                        playlistObject.listNumber += ';';
                    }
                    playlistObject.stateString += `${no}:${SpotifyPremiumAdapter.cleanState(trackName)} - ${SpotifyPremiumAdapter.cleanState(artist)}`;
                    playlistObject.listString += `${SpotifyPremiumAdapter.cleanState(trackName)} - ${SpotifyPremiumAdapter.cleanState(artist)}`;
                    playlistObject.trackIdMap += SpotifyPremiumAdapter.cleanState(trackId);
                    playlistObject.trackIds += `${no}:${SpotifyPremiumAdapter.cleanState(trackId)}`;
                    playlistObject.listNumber += no;
                    const a = {
                        id: trackId,
                        title: trackName,
                        artistName: artist,
                        artistArray: artistArray,
                        album: { id: trackAlbumId, name: trackAlbumName },
                        durationMs: trackDuration,
                        duration: SpotifyPremiumAdapter.convertToDigiClock(trackDuration),
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
                if (offset + 50 < (data?.total || 0)) {
                    offset += 50;
                }
                else {
                    break;
                }
                //.catch(err => this.log.warn('error on load tracks: ' + err));
            }
            catch (err) {
                this.log.warn(`error on load tracks(getPlaylistTracks): ${err} owner: ${owner} id: ${id}`);
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
    async disableDevices(addedList) {
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            const key = (0, utils_1.removeNameSpace)(keys[i]);
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
                await cache.setValue(key, false);
            }
        }
    }
    async deleteDevices(addedList) {
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            const key = (0, utils_1.removeNameSpace)(keys[i]);
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
                await cache.delObject(key);
                if (key.endsWith('.id')) {
                    await cache.delObject(key.substring(0, key.length - 3));
                }
            }
        }
    }
    static getIconByType(type) {
        if (type === 'Computer') {
            return 'icons/computer_black.png';
        }
        if (type === 'Smartphone') {
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
        if (data?.devices) {
            for (let d = 0; d < data.devices.length; d++) {
                const device = data.devices[d];
                const deviceId = device.id || '';
                const deviceName = device.name || '';
                if ((0, utils_1.isEmpty)(deviceName)) {
                    this.log.warn('empty device name');
                    continue;
                }
                let name = '';
                if (deviceId != null) {
                    name = SpotifyPremiumAdapter.shrinkStateName(deviceId);
                }
                else {
                    name = SpotifyPremiumAdapter.shrinkStateName(deviceName);
                }
                const prefix = `devices.${name}`;
                addedList.push(prefix);
                const isRestricted = device.is_restricted || false;
                if (!isRestricted) {
                    await cache.setValue(`${prefix}.useForPlayback`, false, {
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
                    await cache.delObject(`${prefix}.useForPlayback`);
                }
                await cache.setValue(prefix, null, {
                    _id: `${this.namespace}.${prefix}`,
                    type: 'device',
                    common: {
                        name: deviceName,
                        icon: SpotifyPremiumAdapter.getIconByType(device.type || 'Computer'),
                    },
                    native: {},
                });
                await this.createOrDefault(device, 'id', `${prefix}.id`, '', 'device id', 'string'),
                    await this.createOrDefault(device, 'is_active', `${prefix}.isActive`, false, 'current active device', 'boolean');
                await this.createOrDefault(device, 'is_restricted', `${prefix}.isRestricted`, false, 'it is not possible to control restricted devices with the adapter', 'boolean');
                await this.createOrDefault(device, 'name', `${prefix}.name`, '', 'device name', 'string'),
                    await this.createOrDefault(device, 'type', `${prefix}.type`, 'Speaker', 'device type', 'string', {
                        Computer: 'Computer',
                        Smartphone: 'Smartphone',
                        Speaker: 'Speaker',
                    });
                await this.createOrDefault(device, 'volume_percent', `${prefix}.volume`, '', 'volume in percent', 'number');
                await cache.setValue(`${prefix}.isAvailable`, true, {
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
                });
            }
        }
        return addedList;
    }
    async refreshPlaylistList() {
        const a = [];
        const states = cache.getValues('playlists.*');
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const normKey = (0, utils_1.removeNameSpace)(key);
            if (!states[key] || !key.endsWith('.name')) {
                continue;
            }
            const id = normKey.substring(10, normKey.length - 5);
            const owner = cache.getValue(`playlists.${id}.owner`);
            a.push({
                id: id,
                name: states[key].val,
                your: this.application.userId === owner?.val,
            });
        }
        const stateList = {};
        let listIds = '';
        let listString = '';
        let yourIds = '';
        let yourString = '';
        for (let i = 0, len = a.length; i < len; i++) {
            const normId = a[i].id;
            const normName = SpotifyPremiumAdapter.cleanState(a[i].name);
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
        await SpotifyPremiumAdapter.setObjectStatesIfChanged('playlists.playlistList', stateList);
        await cache.setValue('playlists.playlistListIds', listIds);
        await cache.setValue('playlists.playlistListString', listString);
        await cache.setValue('playlists.yourPlaylistListIds', yourIds);
        await cache.setValue('playlists.yourPlaylistListString', yourString);
        const id = cache.getValue('player.playlist.id')?.val;
        if (id) {
            const owner = cache.getValue('player.playlist.owner')?.val;
            if (owner) {
                await cache.setValue('playlists.playlistList', `${owner}-${id}`);
            }
        }
    }
    async refreshDeviceList() {
        const a = [];
        const states = cache.getValues('devices.*');
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const normKey = (0, utils_1.removeNameSpace)(key);
            if (!states[key] || !key.endsWith('.name')) {
                continue;
            }
            const id = normKey.substring(8, normKey.length - 5);
            const available = cache.getValue(`devices.${id}.isAvailable`);
            a.push({
                id,
                name: states[key].val,
                available: !!available?.val,
            });
        }
        let activeDevice = false;
        const stateList = {};
        let listIds = '';
        let listString = '';
        let availableIds = '';
        let availableString = '';
        for (let i = 0, len = a.length; i < len; i++) {
            const normId = a[i].id;
            const normName = SpotifyPremiumAdapter.cleanState(a[i].name);
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
        await SpotifyPremiumAdapter.setObjectStatesIfChanged('devices.deviceList', stateList);
        await cache.setValue('devices.deviceListIds', listIds);
        await cache.setValue('devices.deviceListString', listString);
        await cache.setValue('devices.availableDeviceListIds', availableIds);
        await cache.setValue('devices.availableDeviceListString', availableString);
        const dStates = cache.getValues('devices.*');
        const dKeys = Object.keys(dStates);
        for (let i = 0; i < dKeys.length; i++) {
            const dKey = dKeys[i];
            if (!dKey.endsWith('.isActive')) {
                return;
            }
            const val = dStates[dKey]?.val;
            if (val) {
                const dNormKey = (0, utils_1.removeNameSpace)(dKey);
                const id = dNormKey.substring(8, dNormKey.length - 9);
                activeDevice = true;
                await cache.setValue('devices.deviceList', id);
            }
        }
        if (!activeDevice) {
            await cache.setValue('devices.deviceList', '');
            await cache.setValue('player.device.id', '');
            await cache.setValue('player.device.name', '');
            await cache.setValue('player.device.type', '');
            await cache.setValue('player.device.volume', 100);
            await cache.setValue('player.device.isActive', false);
            await cache.setValue('player.device.isAvailable', false);
            await cache.setValue('player.device.isRestricted', false);
            await cache.setValue('player.device', null, {
                _id: `${this.namespace}.player.device`,
                type: 'device',
                common: {
                    name: 'Commands to control playback related to the current active device',
                    icon: SpotifyPremiumAdapter.getIconByType(''),
                },
                native: {},
            });
        }
        await this.listenOnHtmlDevices();
    }
    async increaseTime(durationMs, progressMs, startDate, count) {
        const now = Date.now();
        count--;
        progressMs += now - startDate;
        const tDurationMs = cache.getValue('player.durationMs')?.val || 0;
        const percentage = Math.floor((progressMs / tDurationMs) * 100);
        await cache.setValue('player.progress', SpotifyPremiumAdapter.convertToDigiClock(progressMs));
        await cache.setValue('player.progressMs', progressMs);
        await cache.setValue('player.progressPercentage', percentage);
        if (count > 0) {
            if (progressMs + 1000 > durationMs) {
                setTimeout(() => this.pollStatusApi(), 1000);
            }
            else {
                const state = cache.getValue('player.isPlaying');
                if (state?.val) {
                    this.scheduleStatusInternalTimer(durationMs, progressMs, now, count);
                }
            }
        }
    }
    scheduleStatusInternalTimer(durationMs, progressMs, startDate, count) {
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        this.application.statusInternalTimer = setTimeout(() => {
            this.application.statusInternalTimer = null;
            if (!this.stopped) {
                void this.increaseTime(durationMs, progressMs, startDate, count);
            }
        }, 1000);
    }
    scheduleStatusPolling() {
        if (this.application.statusPollingHandle) {
            clearTimeout(this.application.statusPollingHandle);
            this.application.statusPollingHandle = null;
        }
        if (this.application.statusPollingDelaySeconds > 0) {
            this.application.statusPollingHandle = setTimeout(() => {
                this.application.statusPollingHandle = null;
                this.pollStatusApi();
            }, this.application.statusPollingDelaySeconds * 1000);
        }
    }
    pollStatusApi(noReschedule) {
        if (!noReschedule && this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        if (this.stopped) {
            return;
        }
        this.log.debug('call status polling');
        void this.sendRequest('/v1/me/player', 'GET', '')
            .then(data => {
            void this.createPlaybackInfo(data);
            if (!noReschedule) {
                this.scheduleStatusPolling();
            }
        })
            .catch(err => {
            if (err !== 202) {
                this.application.error202shown = false;
            }
            //if (err === 202 || err === 401 || err === 502) {
            if (err === 429 ||
                err === 202 ||
                err === 401 ||
                err === 500 ||
                err === 502 ||
                err === 503 ||
                err === 504) {
                if (err === 202) {
                    if (!this.application.error202shown) {
                        this.log.debug('unexpected api response http 202; continue polling; nothing is wrong with the adapter; you will see a 202 response the first time a user connects to the spotify connect api or when the device is temporarily unavailable');
                    }
                    this.application.error202shown = true;
                }
                else if (err === 429) {
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
        });
    }
    scheduleDevicePolling() {
        if (this.application.devicePollingHandle) {
            clearTimeout(this.application.devicePollingHandle);
            this.application.devicePollingHandle = null;
        }
        if (this.application.devicePollingDelaySeconds > 0) {
            this.application.devicePollingHandle = setTimeout(() => {
                this.application.devicePollingHandle = null;
                this.pollDeviceApi();
            }, this.application.devicePollingDelaySeconds * 1000);
        }
    }
    pollDeviceApi() {
        if (this.application.devicePollingHandle) {
            clearTimeout(this.application.devicePollingHandle);
            this.application.devicePollingHandle = null;
        }
        if (this.stopped) {
            return;
        }
        this.log.debug('call device polling');
        this.sendRequest('/v1/me/player/devices', 'GET', '')
            .then(data => {
            void this.reloadDevices(data);
            this.scheduleDevicePolling();
        })
            .catch(err => this.log.error(`spotify device polling stopped with error ${err}`));
    }
    schedulePlaylistPolling() {
        if (this.application.playlistPollingHandle) {
            clearTimeout(this.application.playlistPollingHandle);
            this.application.playlistPollingHandle = null;
        }
        if (this.application.playlistPollingDelaySeconds > 0) {
            this.application.playlistPollingHandle = setTimeout(() => {
                this.application.playlistPollingHandle = null;
                if (!this.stopped) {
                    this.pollPlaylistApi();
                }
            }, this.application.playlistPollingDelaySeconds * 1000);
        }
    }
    pollPlaylistApi() {
        if (this.application.playlistPollingHandle) {
            clearTimeout(this.application.playlistPollingHandle);
            this.application.playlistPollingHandle = null;
        }
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
        keepTrack ||= false;
        let resetShuffle = false;
        if (this.application.keepShuffleState) {
            const state = cache.getValue('player.shuffle');
            if (state?.val) {
                resetShuffle = true;
                if (!keepTrack) {
                    const tracksTotal = cache.getValue(`playlists.${SpotifyPremiumAdapter.shrinkStateName(`${owner}-${playlist}`)}.tracksTotal`);
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
            setTimeout(() => this.pollStatusApi(true), 1000);
        }
        catch (err) {
            this.log.error(`could not start playlist ${playlist} of user ${owner}; error: ${err}`);
        }
        if (this.application.keepShuffleState && resetShuffle) {
            if (this.config.defaultShuffle === 'off') {
                await this.listenOnShuffleOff();
            }
            else {
                await this.listenOnShuffleOn();
            }
        }
    }
    listenOnUseForPlayback = async (options) => {
        const lastDeviceId = cache.getValue(`${options.id.slice(0, options.id.lastIndexOf('.'))}.id`);
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
            setTimeout(() => this.pollStatusApi(), 1000, true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
    };
    listenOnTrackList = (options) => {
        if (options.state?.val >= 0) {
            this.listenOnPlayThisList(options, options.state.val);
        }
    };
    listenOnPlayThisList = async (options, pos) => {
        let keepTrack = true;
        if ((0, utils_1.isEmpty)(pos)) {
            keepTrack = false;
            pos = 0;
        }
        // Play a specific playlist immediately
        const idState = cache.getValue(`${options.id.slice(0, options.id.lastIndexOf('.'))}.id`);
        const ownerState = cache.getValue(`${options.id.slice(0, options.id.lastIndexOf('.'))}.owner`);
        if (!idState || !ownerState) {
            return;
        }
        const id = idState.val;
        const owner = ownerState.val;
        try {
            await this.startPlaylist(id, owner, pos, keepTrack);
        }
        catch (err) {
            this.log.error(`could not start playlist: ${err}`);
        }
    };
    listenOnDeviceList = async (options) => {
        if (!(0, utils_1.isEmpty)(options.state?.val)) {
            await this.listenOnUseForPlayback({ id: `devices.${options.state.val}.useForPlayback` });
        }
    };
    listenOnPlaylistList = async (options) => {
        if (!(0, utils_1.isEmpty)(options.state?.val)) {
            await this.listenOnPlayThisList({ id: `playlists.${options.state.val}.playThisList` });
        }
    };
    listenOnPlayUri = async (options) => {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        const send = options.state?.val;
        if (!(0, utils_1.isEmpty)(send.device_id)) {
            query.device_id = send.device_id;
            delete send.device_id;
        }
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/play?${(0, node_querystring_1.stringify)(query)}`, 'PUT', JSON.stringify(send), true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnPlay = async () => {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        this.log.debug(query.device_id);
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/play?${(0, node_querystring_1.stringify)(query)}`, 'PUT', '', true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnPause = async () => {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/pause?${(0, node_querystring_1.stringify)(query)}`, 'PUT', '', true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnSkipPlus = async () => {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/next?${(0, node_querystring_1.stringify)(query)}`, 'POST', '', true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnSkipMinus = async () => {
        const query = {
            device_id: this.getSelectedDevice(this.deviceData),
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/previous?${(0, node_querystring_1.stringify)(query)}`, 'POST', '', true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnRepeat = async (options) => {
        if (['track', 'context', 'off'].indexOf(options.state?.val) >= 0) {
            if (this.application.statusInternalTimer) {
                clearTimeout(this.application.statusInternalTimer);
                this.application.statusInternalTimer = null;
            }
            try {
                await this.sendRequest(`/v1/me/player/repeat?state=${options.state.val}`, 'PUT', '', true);
            }
            catch (err) {
                this.log.error(`could not execute command: ${err}`);
            }
            setTimeout(() => this.pollStatusApi(), 1000);
        }
    };
    listenOnRepeatTrack = () => {
        return this.listenOnRepeat({
            id: '',
            state: {
                val: 'track',
                ack: true,
            },
        });
    };
    listenOnRepeatContext = () => {
        return this.listenOnRepeat({
            id: '',
            state: {
                val: 'context',
                ack: true,
            },
        });
    };
    listenOnRepeatOff = () => {
        return this.listenOnRepeat({
            id: '',
            state: {
                val: 'off',
                ack: true,
            },
        });
    };
    listenOnVolume = async (options) => {
        const isPlay = cache.getValue('player.isPlaying');
        if (isPlay?.val) {
            if (this.application.statusInternalTimer) {
                clearTimeout(this.application.statusInternalTimer);
                this.application.statusInternalTimer = null;
            }
            try {
                await this.sendRequest(`/v1/me/player/volume?volume_percent=${options.state?.val || 50}`, 'PUT', '', true);
            }
            catch (err) {
                this.log.error(`could not execute command: ${err}`);
            }
            setTimeout(() => this.pollStatusApi(), 1000);
        }
    };
    listenOnProgressMs = async (options) => {
        const progress = options.state?.val;
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/seek?position_ms=${progress}`, 'PUT', '', true);
            const durationState = cache.getValue('player.durationMs');
            if (durationState) {
                const duration = durationState.val;
                if (duration > 0 && duration <= progress) {
                    const progressPercentage = Math.floor((progress / duration) * 100);
                    await cache.setValue('player.progressMs', progress);
                    await cache.setValue('player.progress', SpotifyPremiumAdapter.convertToDigiClock(progress));
                    await cache.setValue('player.progressPercentage', progressPercentage);
                }
            }
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnProgressPercentage = async (options) => {
        const progressPercentage = options.state?.val;
        if (progressPercentage < 0 || progressPercentage > 100) {
            return;
        }
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        const durationState = cache.getValue('player.durationMs');
        if (durationState) {
            const duration = durationState.val;
            if (duration > 0) {
                const progress = Math.floor((progressPercentage / 100) * duration);
                try {
                    await this.sendRequest(`/v1/me/player/seek?position_ms=${progress}`, 'PUT', '', true);
                    await cache.setValue('player.progressMs', progress);
                    await cache.setValue('player.progress', SpotifyPremiumAdapter.convertToDigiClock(progress));
                    await cache.setValue('player.progressPercentage', progressPercentage);
                }
                catch (err) {
                    this.log.error(`could not execute command: ${err}`);
                }
                setTimeout(() => this.pollStatusApi(), 1000);
            }
        }
    };
    listenOnShuffle = async (options) => {
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest(`/v1/me/player/shuffle?state=${options.state?.val === 'on' ? 'true' : 'false'}`, 'PUT', '', true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnShuffleOff = () => {
        return this.listenOnShuffle({
            id: '',
            state: {
                val: 'off',
                ack: false,
            },
        });
    };
    listenOnShuffleOn = () => {
        return this.listenOnShuffle({
            id: '',
            state: {
                val: 'on',
                ack: false,
            },
        });
    };
    listenOnTrackId = async (options) => {
        const send = {
            uris: [`spotify:track:${options.state?.val}`],
            offset: {
                position: 0,
            },
        };
        if (this.application.statusInternalTimer) {
            clearTimeout(this.application.statusInternalTimer);
            this.application.statusInternalTimer = null;
        }
        try {
            await this.sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), true);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
        setTimeout(() => this.pollStatusApi(), 1000);
    };
    listenOnPlaylistId = async (options) => {
        const ownerState = cache.getValue('player.playlist.owner');
        if (!ownerState) {
            return;
        }
        return await this.startPlaylist(options.state?.val, ownerState.val, 0);
    };
    listenOnPlaylistOwner = async (options) => {
        const playListIdState = cache.getValue('player.playlist.id');
        if (!playListIdState) {
            return;
        }
        return await this.startPlaylist(playListIdState?.val, options.state?.val, 0);
    };
    listenOnPlaylistTrackNo = async (options) => {
        const playListIdState = cache.getValue('player.playlist.id');
        const ownerState = cache.getValue('player.playlist.owner');
        if (!playListIdState || !ownerState) {
            return;
        }
        const owner = ownerState.val;
        const id = playListIdState.val;
        const o = parseInt(options.state?.val, 10) || 1;
        return await this.startPlaylist(id, owner, o - 1, true);
    };
    listenOnGetPlaybackInfo = () => {
        this.pollStatusApi(true);
    };
    listenOnGetDevices = async () => {
        try {
            const data = await this.sendRequest('/v1/me/player/devices', 'GET', '');
            await this.reloadDevices(data);
        }
        catch (err) {
            this.log.error(`could not execute command: ${err}`);
        }
    };
    clearCache() {
        if (this.application.cacheClearHandle) {
            clearTimeout(this.application.cacheClearHandle);
            this.application.cacheClearHandle = null;
        }
        this.artistImageUrlCache = {};
        this.playlistCache = {};
        this.application.cacheClearHandle = setTimeout(() => {
            this.application.cacheClearHandle = null;
            if (!this.stopped) {
                this.clearCache();
            }
        }, 1000 * 60 * 60 * 24);
    }
    listenOnHtmlPlaylists = async () => {
        let obj = cache.getValue('playlists.playlistList');
        let current;
        if (obj === null || !obj.val) {
            current = '';
        }
        else {
            current = obj.val;
        }
        obj = cache.getValue('playlists.playlistListIds');
        if (!obj?.val) {
            await cache.setValue('html.playlists', '');
            return;
        }
        const ids = obj.val.toString().split(';');
        obj = cache.getValue('playlists.playlistListString');
        if (!obj?.val) {
            await cache.setValue('html.playlists', '');
            return;
        }
        const strings = obj.val.toString().split(';');
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
        await cache.setValue('html.playlists', html);
    };
    listenOnHtmlTracklist = () => {
        this.getStateAsync('player.trackId')
            .then((state) => {
            let current_trackID;
            if (!state?.val) {
                current_trackID = '';
            }
            else {
                current_trackID = state.val;
            }
            const obj = cache.getValue('player.playlist.trackListArray');
            if (!obj?.val) {
                return cache.setValue('html.tracks', '');
            }
            let source;
            if (typeof obj.val === 'string') {
                try {
                    source = JSON.parse(obj.val);
                }
                catch (e) {
                    source = [];
                    this.log.warn(`Error: ${e}`);
                }
            }
            else {
                source = obj.val;
            }
            let html = '<table class="spotifyTracksTable">';
            for (let i = 0; i < source.length; i++) {
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
                if (current_trackID === source[i].id) {
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
                if (current_trackID === source[i].id) {
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
            return cache.setValue('html.tracks', html);
        })
            .catch(err => this.log.error(err));
    };
    listenOnHtmlDevices = async () => {
        let obj = cache.getValue('devices.deviceList');
        const current = obj?.val || '';
        obj = cache.getValue('devices.deviceListIds');
        if (!obj?.val) {
            await cache.setValue('html.devices', '');
            return;
        }
        const ids = obj.val.toString().split(';');
        obj = cache.getValue('devices.availableDeviceListString');
        if (!obj?.val) {
            await cache.setValue('html.devices', '');
            return;
        }
        const strings = obj.val.toString().split(';');
        let html = '<table class="spotifyDevicesTable">';
        for (let i = 0; i < ids.length; i++) {
            const typeState = cache.getValue(`devices.${ids[i]}.type`);
            if (!typeState) {
                continue;
            }
            const type = SpotifyPremiumAdapter.getIconByType(typeState.val);
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
            html += strings[i];
            html += '</td>';
            html += '</tr>';
        }
        html += '</table>';
        await cache.setValue('html.devices', html);
    };
}
exports.SpotifyPremiumAdapter = SpotifyPremiumAdapter;
// If started as allInOne mode => return function to create instance
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new SpotifyPremiumAdapter(options);
}
else {
    // otherwise start the instance directly
    (() => new SpotifyPremiumAdapter())();
}
//# sourceMappingURL=main.js.map