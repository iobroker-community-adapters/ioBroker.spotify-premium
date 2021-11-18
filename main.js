/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';
const utils = require('@iobroker/adapter-core');
const cache = require('./lib/cache');
const ownUtils = require('./lib/utils');

const querystring = require('querystring');
const _request = require('request');

function request(options) {
    return new Promise((resolve, reject) =>
        _request(options, (error, status) => error ? reject(error) : resolve(status)));
}

let adapter;
let isEmpty = ownUtils.isEmpty;
let removeNameSpace = ownUtils.removeNameSpace;

let artistImageUrlCache = {};
let playlistCache = {};

let application = {
    userId: '',
    baseUrl: 'https://api.spotify.com',
    clientId: '',
    clientSecret: '',
    deleteDevices: false,
    deletePlaylists: false,
    keepShuffleState: true,
    redirect_uri: 'http://localhost',
    token: '',
    refreshToken: '',
    code: '',
    statusInternalTimer: null,
    statusPollingHandle: null,
    statusPollingDelaySeconds: 5,
    devicePollingHandle: null,
    devicePollingDelaySeconds: 300,
    playlistPollingHandle: null,
    playlistPollingDelaySeconds: 900,
    error202shown: false,
    cacheClearHandle: null
};

let deviceData = {
    lastActiveDeviceId: '',
    lastSelectDeviceId: ''
};

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'spotify-premium',
        stateChange: (id, state) => cache.setExternal(id, state),
        objectChange: (id, obj) => cache.setExternalObj(id, obj),
        ready: () => {
            cache.on('authorization.authorizationReturnUri', listenOnAuthorizationReturnUri, true);
            cache.on('authorization.getAuthorization', listenOnGetAuthorization);
            cache.on('authorization.authorized', listenOnAuthorized);
            cache.on(/\.useForPlayback$/, listenOnUseForPlayback);
            cache.on(/\.trackList$/, listenOnTrackList, true);
            cache.on(/\.playThisList$/, listenOnPlayThisList);
            cache.on('devices.deviceList', listenOnDeviceList, true);
            cache.on('playlists.playlistList', listenOnPlaylistList, true);
            cache.on('player.play', listenOnPlay);
            cache.on('player.playUri', listenOnPlayUri);
            cache.on('player.pause', listenOnPause);
            cache.on('player.skipPlus', listenOnSkipPlus);
            cache.on('player.skipMinus', listenOnSkipMinus);
            cache.on('player.repeat', listenOnRepeat, true);
            cache.on('player.repeatTrack', listenOnRepeatTrack);
            cache.on('player.repeatContext', listenOnRepeatContext);
            cache.on('player.repeatOff', listenOnRepeatOff);
            cache.on('player.volume', listenOnVolume, true);
            cache.on('player.progressMs', listenOnProgressMs, true);
            cache.on('player.progressPercentage', listenOnProgressPercentage, true);
            cache.on('player.shuffle', listenOnShuffle, adapter.config.defaultShuffle || 'on');
            cache.on('player.shuffleOff', listenOnShuffleOff);
            cache.on('player.shuffleOn', listenOnShuffleOn);
            cache.on('player.trackId', listenOnTrackId, true);
            cache.on('player.playlist.id', listenOnPlaylistId, true);
            cache.on('player.playlist.owner', listenOnPlaylistOwner, true);
            cache.on('player.playlist.trackNo', listenOnPlaylistTrackNo, true);
            cache.on('getPlaylists', reloadUsersPlaylist);
            cache.on('getPlaybackInfo', listenOnGetPlaybackInfo);
            cache.on('getDevices', listenOnGetDevices);
            cache.on(['playlists.playlistList', 'playlists.playlistListIds', 'playlists.playlistListString'], listenOnHtmlPlaylists);
            cache.on(['player.playlist.trackList', 'player.playlist.trackListArray'], listenOnHtmlTracklist);
            cache.on(['devices.deviceList', 'devices.deviceListIds', 'devices.availableDeviceListString'], listenOnHtmlDevices);

            cache.init()
                .then(() => main());
        },
        unload: callback => {
            Promise.all([
                cache.setValue('authorization.authorizationUrl', ''),
                cache.setValue('authorization.authorizationReturnUri', ''),
                cache.setValue('authorization.userId', ''),
                cache.setValue('player.trackId', ''),
                cache.setValue('player.playlist.id', ''),
                cache.setValue('player.playlist.trackNo', 0),
                cache.setValue('player.playlist.owner', ''),
                cache.setValue('authorization.authorized', false),
                cache.setValue('info.connection', false)
            ])
                .then(() => {
                    if ('undefined' !== typeof application.statusPollingHandle) {
                        clearTimeout(application.statusPollingHandle);
                        clearTimeout(application.statusInternalTimer);
                    }
                    if ('undefined' !== typeof application.devicePollingHandle) {
                        clearTimeout(application.devicePollingHandle);
                    }
                    if ('undefined' !== typeof application.playlistPollingHandle) {
                        clearTimeout(application.playlistPollingHandle);
                    }
                    if ('undefined' !== typeof application.cacheClearHandle) {
                        clearTimeout(application.cacheClearHandle);
                    }
                    callback();
                });
        }
    });

    adapter = new utils.Adapter(options);
    cache.setAdapter(adapter);
    ownUtils.setAdapter(adapter);

    return adapter;
}

function main() {
    application.clientId = adapter.config.client_id;
    application.clientSecret = adapter.config.client_secret;
    application.deleteDevices = adapter.config.delete_devices;
    application.deletePlaylists = adapter.config.delete_playlists;
    application.statusPollingDelaySeconds = adapter.config.status_interval;
    application.keepShuffleState = adapter.config.keep_shuffle_state;
    let deviceInterval = adapter.config.device_interval;
    let playlistInterval = adapter.config.playlist_interval;
    if (isEmpty(application.clientId)) {
        return adapter.log.error('Client_ID is not filled');
    }
    if (isEmpty(application.clientSecret)) {
        return adapter.log.error('Client_Secret is not filled');
    }
    if (isEmpty(application.deleteDevices)) {
        application.deleteDevices = false;
    }
    if (isEmpty(application.deletePlaylists)) {
        application.deletePlaylists = false;
    }
    if (isEmpty(application.keepShuffleState)) {
        application.keepShuffleState = false;
    }
    if (isEmpty(application.statusPollingDelaySeconds)) {
        application.statusPollingDelaySeconds = 5;
    } else if (application.statusPollingDelaySeconds < 1 && application.statusPollingDelaySeconds) {
        application.statusPollingDelaySeconds = 1;
    }
    if (isEmpty(deviceInterval)) {
        deviceInterval = 0;
    }
    if (isEmpty(playlistInterval)) {
        playlistInterval = 0;
    }
    if (deviceInterval < 1 && deviceInterval) {
        deviceInterval = 1;
    }
    if (playlistInterval < 1 && playlistInterval) {
        playlistInterval = 1;
    }
    application.devicePollingDelaySeconds = deviceInterval * 60;
    application.playlistPollingDelaySeconds = playlistInterval * 60;
    adapter.subscribeStates('*');
    start();
}

function start() {
    clearCache();

    return readTokenStates()
        .then(tokenObj => {
            application.token = tokenObj.accessToken;
            application.refreshToken = tokenObj.refreshToken;
        })
        .then(() => sendRequest('/v1/me', 'GET', ''))
        .then(data => setUserInformation(data))
        .then(() => Promise.all([
            cache.setValue('authorization.authorized', true),
            cache.setValue('info.connection', true)
        ]))
        .then(() => listenOnGetPlaybackInfo().catch(() => {}))
        .then(() => reloadUsersPlaylist().catch(() => {}))
        .then(() => listenOnGetDevices().catch(() => {}))
        .catch(err => {
            adapter.log.warn(err);

            return Promise.all([
                cache.setValue('authorization.authorized', false),
                cache.setValue('info.connection', false)
            ]);
        });
}

function readTokenStates() {
    let state = cache.getValue('authorization.token');

    if (state) {
        let tokenObj = state.val;
        if (typeof tokenObj === 'string') {
            try {
                tokenObj = JSON.parse(tokenObj);
            } catch (e) {

            }
        }
        let validAccessToken  = !isEmpty(loadOrDefault(tokenObj, 'accessToken', ''));
        let validRefreshToken = !isEmpty(loadOrDefault(tokenObj, 'refreshToken', ''));
        let validClientId     = !isEmpty(loadOrDefault(tokenObj, 'clientId', '')) && tokenObj.clientId === application.clientId;
        let validClientSecret = !isEmpty(loadOrDefault(tokenObj, 'clientSecret', '')) && tokenObj.clientSecret === application.clientSecret;

        if (validAccessToken && validRefreshToken && validClientId && validClientSecret) {
            adapter.log.debug('spotify token read');
            return Promise.resolve(tokenObj);
        } else {
            return Promise.reject('invalid or no spotify token');
            // return getToken();
        }
    } else {
        return Promise.reject('invalid or no spotify token');
        // return getToken();
    }
}

function sendRequest(endpoint, method, sendBody, delayAccepted) {
    let options = {
        url: application.baseUrl + endpoint,
        method,
        headers: {
            Authorization: 'Bearer ' + application.token
        },
        form: sendBody
    };
    adapter.log.debug(`spotify api call... ${endpoint}; ${options.form}`);
    let callStack = new Error().stack;
    adapter.setState('authorization.error', '', true);

    return request(options)
        .then(response => {
            let body = response.body;
            let ret;
            let parsedBody;
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                parsedBody = {
                    error: {
                        message: 'no active device'
                    }
                };
            }
            switch (response.statusCode) {
                case 200:
                    // OK
                    ret = parsedBody;
                    break;
                case 202:
                    // Accepted, processing has not been completed.
                    adapter.log.debug('http response: ' + JSON.stringify(response));
                    if (delayAccepted) {
                        ret = null;
                    } else {
                        ret = Promise.reject(response.statusCode);
                    }
                    break;
                case 204:
                    // OK, No Content
                    ret = null;
                    break;
                case 400:
                // Bad Request, message body will contain more
                // information
                case 500:
                // Server Error
                case 503:
                // Service Unavailable
                case 404:
                // Not Found
                case 502:
                    // Bad Gateway
                    ret = Promise.reject(response.statusCode);
                    break;
                case 401:
                    // Unauthorized
                    if (parsedBody.error.message === 'The access token expired') {
                        adapter.log.debug('access token expired!');
                        ret = Promise.all([
                            cache.setValue('authorization.authorized', false),
                            cache.setValue('info.connection', false)
                        ])
                            .then(() => refreshToken())
                            .then(() => Promise.all([
                                cache.setValue('authorization.authorized', true),
                                cache.setValue('info.connection', true)
                            ]))
                            .then(() => sendRequest(endpoint, method, sendBody))
                            .then((data) => {
                                // this Request get the data which requested with the old token
                                adapter.log.debug('data with new token');
                                return data;
                            })
                            .catch(err => {
                                if (err === 202) {
                                    adapter.log.debug(err + ' request accepted but no data, try again');
                                } else {
                                    adapter.log.error('error on request data again. ' + err);
                                }
                                return Promise.reject(err);
                            });
                    } else {
                        // if other error with code 401
                        ret = Promise.all([
                            cache.setValue('authorization.authorized', false),
                            cache.setValue('info.connection', false)
                        ])
                            .then(() => {
                                adapter.log.error(parsedBody.error.message);
                                return Promise.reject(response.statusCode);
                            });
                    }
                    break;

                case 429:
                    // Too Many Requests
                    let wait = 1;
                    if (response.headers.hasOwnProperty('retry-after') && response.headers['retry-after'] >
                        0) {
                        wait = response.headers['retry-after'];
                        adapter.log.warn('too many requests, wait ' + wait + 's');
                    }
                    ret = new Promise(resolve => setTimeout(resolve, wait * 1000))
                        .then(() => sendRequest(endpoint, method, sendBody, delayAccepted));
                    break;

                default:
                    adapter.log.warn('http request error not handled, please debug');
                    adapter.log.warn(callStack);
                    adapter.log.warn(new Error().stack);
                    adapter.log.debug('status code: ' + response.statusCode);
                    adapter.log.debug('body: ' + body);
                    ret = Promise.reject(response.statusCode);
                    adapter.setState('authorization.error', body, true);
            }
            return ret;
        });
}

function loadOrDefault(obj, name, defaultVal) {
    let t;
    try {
        const f = new Function('obj', 'name', 'return obj.' + name);
        t = f(obj, name);
    } catch (e) {
        if (!obj) {
            console.error(e);
        }

    }
    if (t === undefined) {
        t = defaultVal;
    }
    return t;
}

function createOrDefault(obj, name, state, defaultVal, description, type, states) {
    let t = loadOrDefault(obj, name, defaultVal);
    let object = {
        type: 'state',
        common: {
            name: description,
            type,
            role: 'value',
            write: false,
            read: true
        },
        native: {}
    };
    if (!isEmpty(states)) {
        object.states = states;
    }
    return cache.setValue(state, t, object);
}

function setOrDefault(obj, name, state, defaultVal) {
    let t = loadOrDefault(obj, name, defaultVal);
    return cache.setValue(state, t);
}

function shrinkStateName(v) {
    let n = v.replace(/[\s."`'*,\\?<>[\];:]+/g, '');
    if (isEmpty(n)) {
        n = 'onlySpecialCharacters';
    }
    return n;
}

function getArtistArrayOrDefault(data, name) {
    let ret = [];
    for (let i = 0; i < 100; i++) {
        let artistName = loadOrDefault(data, `${name}[${i}].name`, '');
        let artistId = loadOrDefault(data, `${name}[${i}].id`, '');
        if (!isEmpty(artistName) && !isEmpty(artistId)) {
            ret.push({id: artistId, name: artistName});
        } else {
            break;
        }
    }
    return ret;
}

function getArtistNamesOrDefault(data, name) {
    let ret = '';
    for (let i = 0; i < 100; i++) {
        let artist = loadOrDefault(data, `${name}[${i}].name`, '');
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

function setObjectStatesIfChanged(id, states) {
    let obj = cache.getObj(id);
    if (obj == null) {
        obj = {
            common: {
                name: '',
                type: 'string',
                role: 'value',
                states: null,
                read: true,
                write: true
            },
            type: 'state'
        };
    }

    return cache.setValue(id, null, {
        type: obj.type,
        common: {
            name: obj.common.name,
            type: obj.common.type,
            role: obj.common.role,
            states,
            read: obj.common.read,
            write: obj.common.write
        },
        native: {}
    });
}

function copyState(src, dst) {
    return cache.setValue(dst, cache.getValue(src).val);
}

function copyObjectStates(src, dst) {
    return setObjectStatesIfChanged(dst, cache.getObj(src).common.states);
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        data = {};
    }
    let deviceId = loadOrDefault(data, 'device.id', '');
    let isDeviceActive = loadOrDefault(data, 'device.is_active', false);
    let isDeviceRestricted = loadOrDefault(data, 'device.is_restricted', false);
    let deviceName = loadOrDefault(data, 'device.name', '');
    let deviceType = loadOrDefault(data, 'device.type', '');
    let deviceVolume = loadOrDefault(data, 'device.volume_percent', 100);
    let isPlaying = loadOrDefault(data, 'is_playing', false);
    let duration = loadOrDefault(data, 'item.duration_ms', 0);
    let type = loadOrDefault(data, 'context.type', '');
    if (!type) {
        type = loadOrDefault(data, 'item.type', '');
    }
    let progress = loadOrDefault(data, 'progress_ms', 0);
    let progressPercentage = 0;
    if (duration > 0) {
        progressPercentage = Math.floor(progress / duration * 100);
    }
    let contextDescription = '';
    let contextImage = '';
    let album = loadOrDefault(data, 'item.album.name', '');
    let albumUrl = loadOrDefault(data, 'item.album.images[0].url', '');
    let artist = getArtistNamesOrDefault(data, 'item.artists');
    if (type === 'album') {
        contextDescription = 'Album: ' + album;
        contextImage = albumUrl;
    } else if (type === 'artist') {
        contextDescription = 'Artist: ' + artist;
    } else if (type === 'track') {
        contextDescription = 'Track';
        // tracks has no images
        contextImage = albumUrl;
    }

    let shuffle = loadOrDefault(data, 'shuffle_state', false);

    return Promise.all([
        cache.setValue('player.device.id', deviceId),
        cache.setValue('player.device.isActive', isDeviceActive),
        cache.setValue('player.device.isRestricted', isDeviceRestricted),
        cache.setValue('player.device.name', deviceName),
        cache.setValue('player.device.type', deviceType),
        cache.setValue('player.device.volume', deviceVolume),
        cache.setValue('player.device.isAvailable', !isEmpty(deviceName)),
        cache.setValue('player.device', null, {
            type: 'device',
            common: {
                name: (isEmpty(deviceName) ? 'Commands to control playback related to the current active device' : deviceName),
                icon: getIconByType(deviceType)
            },
            native: {}
        }),
        cache.setValue('player.isPlaying', isPlaying),
        setOrDefault(data, 'item.id', 'player.trackId', ''),
        cache.setValue('player.artistName', artist),
        cache.setValue('player.album', album),
        cache.setValue('player.albumImageUrl', albumUrl),
        setOrDefault(data, 'item.name', 'player.trackName', ''),
        cache.setValue('player.durationMs', duration),
        cache.setValue('player.duration', convertToDigiClock(duration)),
        cache.setValue('player.type', type),
        cache.setValue('player.progressMs', progress),
        cache.setValue('player.progressPercentage', progressPercentage),
        cache.setValue('player.progress', convertToDigiClock(progress)),
        cache.setValue('player.shuffle', (shuffle ? 'on' : 'off')),
        setOrDefault(data, 'repeat_state', 'player.repeat', 'off'),
        setOrDefault(data, 'device.volume_percent', 'player.device.volume', 100),
    ])
        .then(() => {
            if (deviceName) {
                deviceData.lastActiveDeviceId = deviceId;
                let states = cache.getValue('devices.*');

                let keys = Object.keys(states);
                let fn = function (key) {
                    if (!key.endsWith('.isActive')) {
                        return;
                    }
                    key = removeNameSpace(key);
                    let name = '';
                    if (deviceId != null) {
                        name = shrinkStateName(deviceId);
                    } else {
                        name = shrinkStateName(deviceName);
                    }
                    if (key !== `devices.${name}.isActive`) {
                        return cache.setValue(key, false);
                    }
                };
                return Promise.all(keys.map(fn))
                    .then(() => createDevices({
                            devices: [{
                                id: deviceId,
                                is_active: isDeviceActive,
                                is_restricted: isDeviceRestricted,
                                name: deviceName,
                                type: deviceType,
                                volume_percent: deviceVolume
                            }]
                        }))
                    .then(() => refreshDeviceList());
            } else {
                let states = cache.getValue('devices.*');
                let keys = Object.keys(states);
                let fn = function (key) {
                    if (!key.endsWith('.isActive')) {
                        return;
                    }
                    key = removeNameSpace(key);
                    return cache.setValue(key, false);
                };
                return Promise.all(keys.map(fn));
            }
        })
        .then(() => {
            if (progress && isPlaying && application.statusPollingDelaySeconds > 0) {
                scheduleStatusInternalTimer(duration, progress, Date.now(), application.statusPollingDelaySeconds - 1);
            }
        })
        .then(() => {
            //let album = loadOrDefault(data, 'item.album.name', '');
            let artists = [];
            for (let i = 0; i < 100; i++) {
                let id = loadOrDefault(data, `item.artists[${i}].id`, '');
                if (isEmpty(id)) {
                    break;
                } else {
                    artists.push(id);
                }
            }
            let urls = [];
            let fn = function (artist) {
                if (artistImageUrlCache.hasOwnProperty(artist)) {
                    urls.push(artistImageUrlCache[artist]);
                } else {
                    return sendRequest('/v1/artists/' + artist,
                        'GET', '')
                        .then(parseJson => {
                            let url = loadOrDefault(parseJson, 'images[0].url', '');
                            if (!isEmpty(url)) {
                                artistImageUrlCache[artist] = url;
                                urls.push(url);
                            }
                        });
                }
            };

            return Promise.all(artists.map(fn))
                .then(() => {
                    let set = '';
                    if (urls.length !== 0) {
                        set = urls[0];
                    }
                    if (type === 'artist') {
                        contextImage = set;
                    }
                    return cache.setValue('player.artistImageUrl', set);
                });
        })
        .then(() => {
            let uri = loadOrDefault(data, 'context.uri', '');
            if (type === 'playlist' && uri) {
                let indexOfUser = uri.indexOf('user:') + 5;
                let endIndexOfUser = uri.indexOf(':', indexOfUser);
                let indexOfPlaylistId = uri.indexOf('playlist:') + 9;
                let playlistId = uri.slice(indexOfPlaylistId);
                let userId = uri.substring(indexOfUser, endIndexOfUser);
                let query = {
                    fields: 'name,id,owner.id,tracks.total,images',
                };
                return cache.setValue('player.playlist.id', playlistId)
                    .then(() => {
                        let refreshPlaylist = function (parseJson) {
                            let playlistName = loadOrDefault(parseJson, 'name', '');
                            contextDescription = 'Playlist: ' + playlistName;
                            let songId = loadOrDefault(data, 'item.id', '');
                            let playlistImage = loadOrDefault(parseJson, 'images[0].url', '');
                            contextImage = playlistImage;
                            let ownerId = loadOrDefault(parseJson, 'owner.id', '');
                            let trackCount = loadOrDefault(parseJson, 'tracks.total', '');
                            let prefix = shrinkStateName(ownerId + '-' + playlistId);
                            playlistCache[ownerId + '-' + playlistId] = {
                                id: playlistId,
                                name: playlistName,
                                images: [{url: playlistImage}],
                                owner: {id: ownerId},
                                tracks: {total: trackCount}
                            };

                            return Promise.all([
                                cache.setValue('player.playlist.owner', ownerId),
                                cache.setValue('player.playlist.tracksTotal', trackCount),
                                cache.setValue('player.playlist.imageUrl', playlistImage),
                                cache.setValue('player.playlist.name', playlistName),
                                cache.setValue('player.playlist', null, {
                                    type: 'channel',
                                    common: {
                                        name: (isEmpty(playlistName) ? 'Commands to control playback related to the playlist' : playlistName)
                                    },
                                    native: {}
                                })
                            ])
                                .then(() => {
                                    if (cache.getValue(`playlists.${prefix}.trackListIds`) == null) {
                                        return createPlaylists({
                                            items: [
                                                parseJson
                                            ]
                                        });
                                    } else {
                                        return refreshPlaylistList();
                                    }
                                })
                                .then(() => Promise.all([
                                    copyState(`playlists.${prefix}.trackListNumber`, 'player.playlist.trackListNumber'),
                                    copyState(`playlists.${prefix}.trackListString`, 'player.playlist.trackListString'),
                                    copyState(`playlists.${prefix}.trackListStates`, 'player.playlist.trackListStates'),
                                    cache.setValue('player.playlist.trackNo', parseInt(cache.getValue(`playlists.${prefix}.trackList`).val, 10) + 1),
                                    copyObjectStates(`playlists.${prefix}.trackList`, 'player.playlist.trackList'),
                                    copyState(`playlists.${prefix}.trackListIdMap`, 'player.playlist.trackListIdMap'),
                                    copyState(`playlists.${prefix}.trackListIds`, 'player.playlist.trackListIds'),
                                    copyState(`playlists.${prefix}.trackListArray`, 'player.playlist.trackListArray')
                                ]))
                                .then(() => {
                                    let state = cache.getValue(`playlists.${prefix}.trackListIds`);
                                    let ids = loadOrDefault(state, 'val', '');
                                    if (isEmpty(ids)) {
                                        return Promise.reject('no ids in trackListIds');
                                    }
                                    let stateName = ids.split(';');
                                    let stateArr = [];
                                    for (let i = 0; i < stateName.length; i++) {
                                        let ele = stateName[i].split(':');
                                        stateArr[ele[1]] = ele[0];
                                    }
                                    if (stateArr[songId] !== '' && (stateArr[songId] !== null)) {
                                        let no = stateArr[songId];
                                        return Promise.all([
                                            cache.setValue(`playlists.${prefix}.trackList`, no),
                                            cache.setValue('player.playlist.trackList', no),
                                            cache.setValue('player.playlist.trackNo', parseInt(no, 10) + 1)
                                        ]);
                                    }
                                });
                        }

                        if (playlistCache.hasOwnProperty(userId + '-' + playlistId)) {
                            return refreshPlaylist(playlistCache[userId + '-' + playlistId]);
                        } else {
                            return sendRequest(`/v1/users/${userId}/playlists/${playlistId}?${querystring.stringify(query)}`,
                                'GET', '')
                                .then(refreshPlaylist);
                        }
                    });
            } else {
                adapter.log.debug('context type: "' + type + '"');
                return Promise.all([
                    cache.setValue('player.playlist.id', ''),
                    cache.setValue('player.playlist.name', ''),
                    cache.setValue('player.playlist.owner', ''),
                    cache.setValue('player.playlist.tracksTotal', ''),
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
                        type: 'channel',
                        common: {
                            name: 'Commands to control playback related to the playlist'
                        },
                        native: {}
                    })
                ])
                    .then(() => Promise.all([
                        listenOnHtmlPlaylists(),
                        listenOnHtmlTracklist()
                    ]));
            }
        })
        .then(() => Promise.all([
            cache.setValue('player.contextImageUrl', contextImage),
            cache.setValue('player.contextDescription', contextDescription)
        ]));
}

function convertToDigiClock(ms) {
    // milliseconds to digital time, e.g. 3:59=238759
    if (!ms) {
        ms = 0;
    }
    let min = Math.floor(ms / 60000);
    let sec = Math.floor(((ms % 360000) % 60000) / 1000);
    if (min < 10) {
        min = '0' + min;
    }
    if (sec < 10) {
        sec = '0' + sec;
    }
    return min + ':' + sec;
}

function setUserInformation(data) {
    application.userId = data.id;
    return cache.setValue('authorization.userId', data.id);
}

function reloadUsersPlaylist() {
    return getUsersPlaylist(0)
        .then(addedList => {
            if (application.deletePlaylists) {
                return deleteUsersPlaylist(addedList);
            }
        })
        .then(() => refreshPlaylistList());
}

function deleteUsersPlaylist(addedList) {
    let states = cache.getValue('playlists.*');
    let keys = Object.keys(states);
    let fn = function (key) {
        key = removeNameSpace(key);
        let found = false;
        for (let i = 0; i < addedList.length; i++) {
            if (key.startsWith(addedList[i])) {
                found = true;
                break;
            }
        }

        if (!found &&
            key !== 'playlists.playlistList' &&
            key !== 'playlists.playlistListIds' &&
            key !== 'playlists.playlistListString' &&
            key !== 'playlists.yourPlaylistListIds' &&
            key !== 'playlists.yourPlaylistListString'
        ) {
            return cache.delObject(key)
                .then(() => {
                    if (key.endsWith('.id')) {
                        return cache.delObject(key.substring(0, key.length - 3));
                    }
                });
        }
    };
    return Promise.all(keys.map(fn));
}

function createPlaylists(parseJson, autoContinue, addedList) {
    if (isEmpty(parseJson) || isEmpty(parseJson.items)) {
        adapter.log.debug('no playlist content');
        return Promise.reject('no playlist content');
    }
    let fn = function (item) {
        let playlistName = loadOrDefault(item, 'name', '');
        if (isEmpty(playlistName)) {
            adapter.log.warn('empty playlist name');
            return Promise.reject('empty playlist name');
        }
        let playlistId = loadOrDefault(item, 'id', '');
        let ownerId = loadOrDefault(item, 'owner.id', '');
        let trackCount = loadOrDefault(item, 'tracks.total', '');
        let imageUrl = loadOrDefault(item, 'images[0].url', '');
        playlistCache[ownerId + '-' + playlistId] = {
            id: playlistId,
            name: playlistName,
            images: [{url: imageUrl}],
            owner: {id: ownerId},
            tracks: {total: trackCount}
        };

        let prefix = 'playlists.' + shrinkStateName(ownerId + '-' + playlistId);
        addedList = addedList || [];
        addedList.push(prefix);

        return Promise.all([
            cache.setValue(prefix, null, {
                type: 'channel',
                common: {name: playlistName},
                native: {}
            }),
            cache.setValue(prefix + '.playThisList', false, {
                type: 'state',
                common: {
                    name: 'press to play this playlist',
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                    icon: 'icons/play_black.png'
                },
                native: {}
            }),
            createOrDefault(item, 'id', prefix + '.id', '', 'playlist id', 'string'),
            createOrDefault(item, 'owner.id', prefix + '.owner', '', 'playlist owner', 'string'),
            createOrDefault(item, 'name', prefix + '.name', '', 'playlist name', 'string'),
            createOrDefault(item, 'tracks.total', prefix + '.tracksTotal', '', 'number of songs', 'number'),
            createOrDefault(item, 'images[0].url', prefix + '.imageUrl', '', 'image url', 'string')
        ])
            .then(() => getPlaylistTracks(ownerId, playlistId, 0))
            .then(playlistObject => {
                let trackListValue = '';
                let currentPlaylistId = cache.getValue('player.playlist.id').val;
                let currentPlaylistOwnerId = cache.getValue('player.playlist.owner').val;
                let songId = cache.getValue('player.trackId').val;

                if (`${ownerId}-${playlistId}` === `${currentPlaylistOwnerId}-${currentPlaylistId}`) {
                    let stateName = playlistObject.trackIds.split(';');
                    let stateArr = [];
                    for (let i = 0; i < stateName.length; i++) {
                        let ele = stateName[i].split(':');
                        stateArr[ele[1]] = ele[0];
                    }
                    if (stateArr[songId] !== '' && (stateArr[songId] !== null)) {
                        trackListValue = stateArr[songId];
                    }
                }

                return Promise.all([
                    cache.setValue(prefix + '.trackList', trackListValue, {
                        type: 'state',
                        common: {
                            name: 'Tracks of the playlist saved in common part. Change this value to a track position number to start this playlist with this track. First track is 0',
                            type: 'mixed',
                            role: 'value',
                            states: loadOrDefault(playlistObject, 'stateString', ''),
                            read: true,
                            write: true
                        },
                        native: {}
                    }),

                    createOrDefault(playlistObject, 'listNumber', prefix + '.trackListNumber', '',
                        'contains list of tracks as string, patter: 0;1;2;...',
                        'string'),
                    createOrDefault(playlistObject, 'listString', prefix + '.trackListString', '',
                        'contains list of tracks as string, patter: title - artist;title - artist;title - artist;...',
                        'string'),
                    createOrDefault(playlistObject, 'stateString', prefix + '.trackListStates', '',
                        'contains list of tracks as string with position, pattern: 0:title - artist;1:title - artist;2:title - artist;...',
                        'string'),
                    createOrDefault(playlistObject, 'trackIdMap', prefix + '.trackListIdMap', '',
                        'contains list of track ids as string with position, pattern: 0:id;1:id;2:id;...',
                        'string'),
                    createOrDefault(playlistObject, 'trackIds', prefix + '.trackListIds', '',
                        'contains list of track ids as string, pattern: id;id;id;...',
                        'string'),
                    createOrDefault(playlistObject, 'songs', prefix + '.trackListArray', '',
                        'contains list of tracks as array object, pattern:\n[{id: "id",\ntitle: "title",\nartistName: "artistName1, artistName2",\nartistArray: [{id: "artistId", name: "artistName"}, {id: "artistId", name: "artistName"}, ...],\nalbum: {id: "albumId", name: "albumName"},\ndurationMs: 253844,\nduration: 4:13,\naddedAt: 15395478261235,\naddedBy: "userId",\ndiscNumber: 1,\nepisode: false,\nexplicit: false,\npopularity: 56\n}, ...]',
                        'object')
                ]);
            });
    };

    let p = Promise.resolve();
    for (let i = 0; i < parseJson.items.length; i++) {
        p = p
            .then(() => new Promise(resolve => setTimeout(() => resolve(), 1000)))
            .then(() => fn(parseJson.items[i]));
    }

    return p.then(() => {
        if (autoContinue && parseJson.items.length !== 0 && (parseJson['next'] !== null)) {
            return getUsersPlaylist(parseJson.offset + parseJson.limit, addedList);
        } else {
            return addedList;
        }
    });
}

function getUsersPlaylist(offset, addedList) {
    addedList = addedList || [];

    if (!isEmpty(application.userId)) {
        let query = {
            limit: 30,
            offset: offset
        };
        return sendRequest(`/v1/users/${application.userId}/playlists?${querystring.stringify(query)}`, 'GET', '')
            .then(parsedJson => createPlaylists(parsedJson, true, addedList))
            .catch(err => adapter.log.error('playlist error ' + err));
    } else {
        adapter.log.warn('no userId');
        return Promise.reject('no userId');
    }
}

function getSelectedDevice(deviceData) {
    if (deviceData.lastSelectDeviceId === '') {
        return deviceData.lastActiveDeviceId;
    } else {
        return deviceData.lastSelectDeviceId;
    }
}

function cleanState(str) {
    str = str.replace(/:/g, ' ');
    str = str.replace(/;/g, ' ');
    let old;
    do {
        old = str;
        str = str.replace('  ', ' ');
    }
    while (old !== str);
    return str.trim();
}

function getPlaylistTracks(owner, id, offset, playlistObject) {
    playlistObject = playlistObject || {
        stateString: '',
        listString: '',
        listNumber: '',
        trackIdMap: '',
        trackIds: '',
        songs: []
    };
    let regParam = `${owner}/playlists/${id}/tracks`;
    let query = {
        fields: 'total,offset,items(added_at,added_by.id,track(name,id,artists(name,id),duration_ms,album(name,id),disc_number,episode,explicit,popularity))',
        limit: 100,
        offset: offset
    };
    return sendRequest(`/v1/users/${regParam}?${querystring.stringify(query)}`, 'GET', '')
        .then(data => {
            let i = offset;
            data.items.forEach(item => {
                let no = i.toString();
                let artist = getArtistNamesOrDefault(item, 'track.artists');
                let artistArray = getArtistArrayOrDefault(item, 'track.artists');
                let trackName = loadOrDefault(item, 'track.name', '');
                let trackDuration = loadOrDefault(item, 'track.duration_ms', '');
                let trackId = loadOrDefault(item, 'track.id', '');
                if (isEmpty(trackId)) {
                    return adapter.log.debug(
                        `There was a playlist track ignored because of missing id; playlist: ${id}; track name: ${trackName}`);
                }
                let addedAt = loadOrDefault(item, 'added_at', '');
                let addedBy = loadOrDefault(item, 'added_by.id', '');
                let trackAlbumId = loadOrDefault(item, 'track.album.id', '');
                let trackAlbumName = loadOrDefault(item, 'track.album.name', '');
                let trackDiscNumber = loadOrDefault(item, 'track.disc_number', 1);
                let trackEpisode = loadOrDefault(item, 'track.episode', false);
                let trackExplicit = loadOrDefault(item, 'track.explicit', false);
                let trackPopularity = loadOrDefault(item, 'track.popularity', 0);
                if (playlistObject.songs.length > 0) {
                    playlistObject.stateString += ';';
                    playlistObject.listString += ';';
                    playlistObject.trackIdMap += ';';
                    playlistObject.trackIds += ';';
                    playlistObject.listNumber += ';';
                }
                playlistObject.stateString += `${no}:${cleanState(trackName)} - ${cleanState(artist)}`;
                playlistObject.listString += `${cleanState(trackName)} - ${cleanState(artist)}`;
                playlistObject.trackIdMap += cleanState(trackId);
                playlistObject.trackIds += `${no}:${cleanState(trackId)}`;
                playlistObject.listNumber += no;
                let a = {
                    id: trackId,
                    title: trackName,
                    artistName: artist,
                    artistArray: artistArray,
                    album: {id: trackAlbumId, name: trackAlbumName},
                    durationMs: trackDuration,
                    duration: convertToDigiClock(trackDuration),
                    addedAt: addedAt,
                    addedBy: addedBy,
                    discNumber: trackDiscNumber,
                    episode: trackEpisode,
                    explicit: trackExplicit,
                    popularity: trackPopularity
                };
                playlistObject.songs.push(a);
                i++;
            });
            if (offset + 100 < data.total) {
                return new Promise(resolve => setTimeout(resolve, 1000))
                    .then(() => getPlaylistTracks(owner, id, offset + 100, playlistObject));
            } else {
                return Promise.resolve(playlistObject);
            }
        })
        .catch(err => adapter.log.warn('error on load tracks: ' + err));
}

function reloadDevices(data) {
    return createDevices(data)
        .then(addedList => {
            let p;
            if (application.deleteDevices) {
                p = deleteDevices(addedList);
            } else {
                p = disableDevices(addedList);
            }
            return p
                .then(() => refreshDeviceList());
        });
}

function disableDevices(addedList) {
    let states = cache.getValue('devices.*');
    let keys = Object.keys(states);
    let fn = function (key) {
        key = removeNameSpace(key);
        let found = false;
        for (let i = 0; i < addedList.length; i++) {
            if (key.startsWith(addedList[i])) {
                found = true;
                break;
            }
        }
        if (!found && key.endsWith('.isAvailable')) {
            return cache.setValue(key, false);
        }
    };
    return Promise.all(keys.map(fn));
}

function deleteDevices(addedList) {
    let states = cache.getValue('devices.*');
    let keys = Object.keys(states);
    let fn = function (key) {
        key = removeNameSpace(key);
        let found = false;
        for (let i = 0; i < addedList.length; i++) {
            if (key.startsWith(addedList[i])) {
                found = true;
                break;
            }
        }

        if (!found &&
            key !== 'devices.deviceList' &&
            key !== 'devices.deviceListIds' &&
            key !== 'devices.deviceListString' &&
            key !== 'devices.availableDeviceListIds' &&
            key !== 'devices.availableDeviceListString') {
            return cache.delObject(key)
                .then(() => {
                    if (key.endsWith('.id')) {
                        return cache.delObject(key.substring(0, key.length - 3));
                    }
                });
        }
    };
    return Promise.all(keys.map(fn));
}

function getIconByType(type) {
    if (type === 'Computer') {
        return 'icons/computer_black.png';
    } else if (type === 'Smartphone') {
        return 'icons/smartphone_black.png';
    }
    // Speaker
    return 'icons/speaker_black.png';
}

function createDevices(data) {
    if (isEmpty(data) || isEmpty(data.devices)) {
        data = {devices: []};
    }
    let addedList = [];
    let fn = function (device) {
        let deviceId = loadOrDefault(device, 'id', '');
        let deviceName = loadOrDefault(device, 'name', '');
        if (isEmpty(deviceName)) {
            adapter.log.warn('empty device name')
            return Promise.reject('empty device name');
        }
        let name = '';
        if (deviceId != null) {
            name = shrinkStateName(deviceId);
        } else {
            name = shrinkStateName(deviceName);
        }
        let prefix = 'devices.' + name;
        addedList.push(prefix);

        let isRestricted = loadOrDefault(device, 'is_restricted', false);
        let useForPlayback;
        if (!isRestricted) {
            useForPlayback = cache.setValue(prefix + '.useForPlayback', false, {
                type: 'state',
                common: {
                    name: 'press to use device for playback (only for non restricted devices)',
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                    icon: 'icons/play_black.png'
                },
                native: {}
            });
        } else {
            useForPlayback = cache.delObject(prefix + '.useForPlayback');
        }
        return Promise.all([
            cache.setValue(prefix, null, {
                type: 'device',
                common: {
                    name: deviceName,
                    icon: getIconByType(loadOrDefault(device, 'type', 'Computer'))
                },
                native: {}
            }),
            createOrDefault(device, 'id', prefix + '.id', '', 'device id', 'string'),
            createOrDefault(device, 'is_active', prefix + '.isActive', false, 'current active device', 'boolean'),
            createOrDefault(device, 'is_restricted', prefix + '.isRestricted', false, 'it is not possible to control restricted devices with the adapter', 'boolean'),
            createOrDefault(device, 'name', prefix + '.name', '', 'device name', 'string'),
            createOrDefault(device, 'type', prefix + '.type', 'Speaker', 'device type', 'string',
                "{\"Computer\": \"Computer\",\"Smartphone\": \"Smartphone\",\"Speaker\": \"Speaker\"}"
            ),
            createOrDefault(device, 'volume_percent', prefix + '.volume', '', 'volume in percent',
                'number'),
            cache.setValue(prefix + '.isAvailable', true, {
                type: 'state',
                common: {
                    name: 'can used for playing',
                    type: 'boolean',
                    role: 'value',
                    read: true,
                    write: false
                },
                native: {}
            }),
            useForPlayback
        ]);
    };
    return Promise.all(data.devices.map(fn))
        .then(() => addedList);
}

function refreshPlaylistList() {
    let a = [];
    let states = cache.getValue('playlists.*');
    let keys = Object.keys(states);
    let fn = function (key) {
        if (!key.endsWith('.name')) {
            return;
        }
        let normKey = removeNameSpace(key);
        let id = normKey.substring(10, normKey.length - 5);
        a.push({
            id: id,
            name: states[key].val,
            your: application.userId === cache.getValue(`playlists.${id}.owner`).val
        });
    };

    return Promise.all(keys.map(fn))
        .then(() => {
            let stateList = {};
            let listIds = '';
            let listString = '';
            let yourIds = '';
            let yourString = '';
            for (let i = 0, len = a.length; i < len; i++) {
                let normId = a[i].id;
                let normName = cleanState(a[i].name);
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
            return Promise.all([
                setObjectStatesIfChanged('playlists.playlistList', stateList),
                cache.setValue('playlists.playlistListIds', listIds),
                cache.setValue('playlists.playlistListString', listString),
                cache.setValue('playlists.yourPlaylistListIds', yourIds),
                cache.setValue('playlists.yourPlaylistListString', yourString)
            ]);
        })
        .then(() => {
            let id = cache.getValue('player.playlist.id').val;
            if (id) {
                let owner = cache.getValue('player.playlist.owner').val;
                if (owner) {
                    return cache.setValue('playlists.playlistList', owner + '-' + id);
                }
            }
        });
}

function refreshDeviceList() {
    let a = [];
    let states = cache.getValue('devices.*');
    let keys = Object.keys(states);
    let fn = function (key) {
        if (!states[key] || !key.endsWith('.name')) {
            return;
        }
        let normKey = removeNameSpace(key);
        let id = normKey.substring(8, normKey.length - 5);
        a.push({
            id,
            name: states[key].val,
            available: cache.getValue(`devices.${id}.isAvailable`).val
        });
    };

    let activeDevice = false;
    return Promise.all(keys.map(fn))
        .then(() => {
            let stateList = {};
            let listIds = '';
            let listString = '';
            let availableIds = '';
            let availableString = '';
            for (let i = 0, len = a.length; i < len; i++) {
                let normId = a[i].id;
                let normName = cleanState(a[i].name);
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

            return Promise.all([
                setObjectStatesIfChanged('devices.deviceList', stateList),
                cache.setValue('devices.deviceListIds', listIds),
                cache.setValue('devices.deviceListString', listString),
                cache.setValue('devices.availableDeviceListIds', availableIds),
                cache.setValue('devices.availableDeviceListString', availableString),
            ]);
        })
        .then(() =>  {
            let states = cache.getValue('devices.*');
            let keys = Object.keys(states);
            let fn = function (key) {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                let val = states[key].val;
                if (val) {
                    key = removeNameSpace(key);
                    let id = key.substring(8, key.length - 9);
                    activeDevice = true;
                    return cache.setValue('devices.deviceList', id);
                }
            };
            return Promise.all(keys.map(fn));
        })
        .then(() => {
            if (!activeDevice) {
                return Promise.all([
                    cache.setValue('devices.deviceList', ''),
                    cache.setValue('player.device.id', ''),
                    cache.setValue('player.device.name', ''),
                    cache.setValue('player.device.type', ''),
                    cache.setValue('player.device.volume', 100),
                    cache.setValue('player.device.isActive', false),
                    cache.setValue('player.device.isAvailable', false),
                    cache.setValue('player.device.isRestricted', false),
                    cache.setValue('player.device', null, {
                        type: 'device',
                        common: {
                            name: 'Commands to control playback related to the current active device',
                            icon: getIconByType('')
                        },
                        native: {}
                    })
                ]);
            }
        })
        .then(() => listenOnHtmlDevices());
}

function generateRandomString(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getToken() {
    let options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + Buffer.from(`${application.clientId}:${application.clientSecret}`).toString('base64')
        },
        form: {
            grant_type: 'authorization_code',
            code: application.code,
            redirect_uri: application.redirect_uri
        }
    };

    let tokenObj;

    return request(options)
        .then(response => {
            let body = response.body;
            let parsedBody;
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                parsedBody = {};
            }
            return saveToken(parsedBody);
        })
        .then(_tokenObj => {
            tokenObj = _tokenObj;
            return Promise.all([
                cache.setValue('authorization.authorizationUrl', ''),
                cache.setValue('authorization.authorizationReturnUri', ''),
                cache.setValue('authorization.authorized', true),
                cache.setValue('info.connection', true)
            ])
        })
        .then(() => {
            application.token = tokenObj.accessToken;
            application.refreshToken = tokenObj.refreshToken;
            return start();
        })
        .catch(err => adapter.log.debug(err));
}

function refreshToken() {
    adapter.log.debug('token is requested again');
    let options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + Buffer.from(`${application.clientId}:${application.clientSecret}`).toString('base64')
        },
        form: {
            grant_type: 'refresh_token',
            refresh_token: application.refreshToken
        }
    };

    if (application.refreshToken !== '') {
        return request(options)
            .then(response => {
                // this request gets the new token
                if (response.statusCode === 200) {
                    let body = response.body;
                    adapter.log.debug('new token arrived');
                    adapter.log.debug(body);
                    let parsedJson;
                    try {
                        parsedJson = JSON.parse(body);
                    } catch (e) {
                        parsedJson = {};
                    }
                    if (!parsedJson.hasOwnProperty('refresh_token')) {
                        parsedJson.refresh_token = application.refreshToken;
                    }
                    adapter.log.debug(JSON.stringify(parsedJson))

                    return saveToken(parsedJson)
                        .then(tokenObj => application.token = tokenObj.accessToken)
                        .catch(err => {
                            adapter.log.debug(err);
                            return Promise.reject(err);
                        });
                } else {
                    return Promise.reject(response.statusCode);
                }
            });
    }

    return Promise.reject('no refresh token');
}

function saveToken(data) {
    adapter.log.debug('saveToken');
    if ('undefined' !== typeof data.access_token && 'undefined' !== typeof data.refresh_token) {
        let token = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            clientId: application.clientId,
            clientSecret: application.clientSecret
        };
        return cache.setValue('authorization.token', token)
            .then(() => token);
    } else {
        adapter.log.error(JSON.stringify(data));
        return Promise.reject('no tokens found in server response');
    }
}

function increaseTime(durationMs, progressMs, startDate, count) {
    let now = Date.now();
    count--;
    progressMs += now - startDate;
    let tDurationMs = cache.getValue('player.durationMs').val;
    let percentage = Math.floor(progressMs / tDurationMs * 100);
    return Promise.all([
        cache.setValue('player.progress', convertToDigiClock(progressMs)),
        cache.setValue('player.progressMs', progressMs),
        cache.setValue('player.progressPercentage', percentage)
    ])
        .then(() => {
            if (count > 0) {
                if (progressMs + 1000 > durationMs) {
                    setTimeout(pollStatusApi, 1000);
                } else {
                    let state = cache.getValue('player.isPlaying');
                    if (state.val) {
                        scheduleStatusInternalTimer(durationMs, progressMs, now, count);
                    }
                }
            }
        });
}

function scheduleStatusInternalTimer(durationMs, progressMs, startDate, count) {
    clearTimeout(application.statusInternalTimer);
    application.statusInternalTimer = setTimeout(increaseTime, 1000, durationMs, progressMs, startDate, count);
}

function scheduleStatusPolling() {
    clearTimeout(application.statusPollingHandle);
    if (application.statusPollingDelaySeconds > 0) {
        application.statusPollingHandle = setTimeout(pollStatusApi, application.statusPollingDelaySeconds * 1000);
    }
}

function pollStatusApi(noReschedule) {
    if (!noReschedule) {
        clearTimeout(application.statusInternalTimer);
    }
    adapter.log.debug('call status polling');
    return sendRequest('/v1/me/player', 'GET', '')
        .then(data => {
            createPlaybackInfo(data);
            if (!noReschedule) {
                scheduleStatusPolling();
            }
        })
        .catch(err => {
            if (err !== 202) {
                application.error202shown = false;
            }
            if (err === 202 || err === 401 || err === 502) {
                if (err === 202) {
                    if (!application.error202shown) {
                        adapter.log.debug(
                            'unexpected api response http 202; continue polling; nothing is wrong with the adapter; you will see a 202 response the first time a user connects to the spotify connect api or when the device is temporarily unavailable'
                        );
                    }
                    application.error202shown = true;
                } else {
                    adapter.log.warn('unexpected api response http ' + err + '; continue polling');
                }
                // 202, 401 and 502 keep the polling running
                let dummyBody = {
                    is_playing: false
                };
                // occurs when no player is open
                createPlaybackInfo(dummyBody);
                if (!noReschedule) {
                    scheduleStatusPolling();
                }
            } else {
                // other errors stop the polling
                adapter.log.error('spotify status polling stopped with error ' + err);
            }
        });
}

function scheduleDevicePolling() {
    clearTimeout(application.devicePollingHandle);
    if (application.devicePollingDelaySeconds > 0) {
        application.devicePollingHandle = setTimeout(pollDeviceApi, application.devicePollingDelaySeconds *
            1000);
    }
}

function pollDeviceApi() {
    clearTimeout(application.deviceInternalTimer);
    adapter.log.debug('call device polling');
    sendRequest('/v1/me/player/devices', 'GET', '')
        .then(data => {
            reloadDevices(data);
            scheduleDevicePolling();
        })
        .catch(err =>adapter.log.error('spotify device polling stopped with error ' + err));
}

function schedulePlaylistPolling() {
    clearTimeout(application.playlistPollingHandle);
    if (application.playlistPollingDelaySeconds > 0) {
        application.playlistPollingHandle = setTimeout(pollPlaylistApi, application.playlistPollingDelaySeconds *
            1000);
    }
}

function pollPlaylistApi() {
    clearTimeout(application.playlistInternalTimer);
    adapter.log.debug('call playlist polling');
    reloadUsersPlaylist();
    schedulePlaylistPolling();
}

function startPlaylist(playlist, owner, trackNo, keepTrack) {
    if (isEmpty(owner)) {
        owner = application.userId;
    }
    if (isEmpty(trackNo)) {
        return Promise.reject('no track no');
    }
    if (isEmpty(playlist)) {
        return Promise.reject('no playlist no');
    }
    if (keepTrack !== true) {
        keepTrack = false;
    }
    let resetShuffle = false;
    let r = Promise.resolve();

    if (application.keepShuffleState) {
        r = r
            .then(() => {
                let state = cache.getValue('player.shuffle');
                if (state.val) {
                    resetShuffle = true;
                    if (!keepTrack) {
                        trackNo = Math.floor(Math.random() * Math.floor(cache.getValue(`playlists.${shrinkStateName(owner + '-' + playlist)}.tracksTotal`).val));
                    }
                }
            });
    }

    return r
        .then(() => {
            let send = {
                context_uri: `spotify:user:${owner}:playlist:${playlist}`,
                offset: {
                    position: trackNo
                }
            };
            return sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), true)
                .then(() => setTimeout(pollStatusApi, 1000, true))
                .catch(err => adapter.log.error(`could not start playlist ${playlist} of user ${owner}; error: ${err}`));
        })
        .then(() => {
            if (application.keepShuffleState && resetShuffle) {
                if (adapter.config.defaultShuffle === 'off') {
                    return listenOnShuffleOff();
                } else {
                    return listenOnShuffleOn();
                }
            }
        });
}

function listenOnAuthorizationReturnUri(obj) {
    let state = cache.getValue('authorization.state')
    let returnUri = querystring.parse(obj.state.val.slice(obj.state.val.search('[?]') + 1, obj.state.val.length));
    if ('undefined' !== typeof returnUri.state) {
        returnUri.state = returnUri.state.replace(/#_=_$/g, '');
    }
    if (returnUri.state === state.val) {
        adapter.log.debug('getToken');
        application.code = returnUri.code;
        return getToken();
    } else {
        adapter.log.error('invalid session. you need to open the actual authorization.authorizationUrl');
        return cache.setValue('Authorization.Authorization_Return_URI',
            'invalid session. You need to open the actual Authorization.Authorization_URL again');
    }
}

function listenOnGetAuthorization() {
    adapter.log.debug('requestAuthorization');
    let state = generateRandomString(20);
    let query = {
        client_id: application.clientId,
        response_type: 'code',
        redirect_uri: application.redirect_uri,
        state: state,
        scope: 'user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-read-private'
    };

    let options = {
        url: 'https://accounts.spotify.com/de/authorize/?' + querystring.stringify(query),
        method: 'GET',
        followAllRedirects: true,
    };

    return Promise.all([
        cache.setValue('authorization.state', state),
        cache.setValue('authorization.authorizationUrl', options.url),
        cache.setValue('authorization.authorized', false),
        cache.setValue('info.connection', false)
    ]);
}

function listenOnAuthorized(obj) {
    if (obj.state.val === true) {
        scheduleStatusPolling();
        scheduleDevicePolling();
        schedulePlaylistPolling();
    }
}

function listenOnUseForPlayback(obj) {
    deviceData.lastSelectDeviceId = cache.getValue(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id').val;
    let send = {
        device_ids: [deviceData.lastSelectDeviceId],
        play: true
    };
    return sendRequest('/v1/me/player', 'PUT', JSON.stringify(send), true)
        .then(() => setTimeout(pollStatusApi, 1000, true))
        .catch(err => adapter.log.error('could not execute command: ' + err));
}

function listenOnTrackList(obj) {
    if (obj.state.val >= 0) {
        listenOnPlayThisList(obj, obj.state.val);
    }
}

function listenOnPlayThisList(obj, pos) {
    let keepTrack = true;
    if (isEmpty(pos)) {
        keepTrack = false;
        pos = 0;
    }
    // Play a specific playlist immediately
    let id = cache.getValue(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id').val;
    let owner = cache.getValue(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.owner').val;
    return startPlaylist(id, owner, pos, keepTrack);
}

function listenOnDeviceList(obj) {
    if (!isEmpty(obj.state.val)) {
        listenOnUseForPlayback({id: `devices.${obj.state.val}.useForPlayback`});
    }
}

function listenOnPlaylistList(obj) {
    if (!isEmpty(obj.state.val)) {
        listenOnPlayThisList({id: `playlists.${obj.state.val}.playThisList`});
    }
}

function listenOnPlayUri(obj) {
    let query = {
        device_id: getSelectedDevice(deviceData)
    };

    let send = obj.state.val;
    if (!isEmpty(send['device_id'])) {
        query.device_id = send['device_id'];
        delete send['device_id'];
    }

    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT', send, true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnPlay() {
    let query = {
        device_id: getSelectedDevice(deviceData)
    };
    adapter.log.debug(getSelectedDevice(deviceData))
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT', '', true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnPause() {
    let query = {
        device_id: getSelectedDevice(deviceData)
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/pause?' + querystring.stringify(query), 'PUT', '', true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnSkipPlus() {
    let query = {
        device_id: getSelectedDevice(deviceData)
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/next?' + querystring.stringify(query), 'POST', '', true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnSkipMinus() {
    let query = {
        device_id: getSelectedDevice(deviceData)
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/previous?' + querystring.stringify(query), 'POST', '', true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnRepeat(obj) {
    if (['track', 'context', 'off'].indexOf(obj.state.val) >= 0) {
        clearTimeout(application.statusInternalTimer);
        sendRequest('/v1/me/player/repeat?state=' + obj.state.val, 'PUT', '', true)
            .catch(err => adapter.log.error('could not execute command: ' + err))
            .then(() => setTimeout(pollStatusApi, 1000));
    }
}

function listenOnRepeatTrack() {
    listenOnRepeat({
        state: {
            val: 'track'
        }
    });
}

function listenOnRepeatContext() {
    listenOnRepeat({
        state: {
            val: 'context'
        }
    });
}

function listenOnRepeatOff() {
    listenOnRepeat({
        state: {
            val: 'off'
        }
    });
}

function listenOnVolume(obj) {
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/volume?volume_percent=' + obj.state.val, 'PUT', '', true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnProgressMs(obj) {
    let progress = obj.state.val;
    clearTimeout(application.statusInternalTimer);

    sendRequest('/v1/me/player/seek?position_ms=' + progress, 'PUT', '', true).then(function () {
        let duration = cache.getValue('player.durationMs').val;

        if (duration > 0 && duration <= progress) {
            let progressPercentage = Math.floor(progress / duration * 100);
            return Promise.all([
                cache.setValue('player.progressMs', progress),
                cache.setValue('player.progress', convertToDigiClock(progress)),
                cache.setValue('player.progressPercentage', progressPercentage)
            ]);
        }
    })
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnProgressPercentage(obj) {
    let progressPercentage = obj.state.val;
    if (progressPercentage < 0 || progressPercentage > 100) {
        return;
    }
    clearTimeout(application.statusInternalTimer);
    let duration = cache.getValue('player.durationMs').val;
    if (duration > 0) {
        let progress = Math.floor(progressPercentage / 100 * duration);
        sendRequest('/v1/me/player/seek?position_ms=' + progress, 'PUT', '', true)
            .then(() => Promise.all([
                cache.setValue('player.progressMs', progress),
                cache.setValue('player.progress', convertToDigiClock(progress)),
                cache.setValue('player.progressPercentage', progressPercentage)
            ]))
            .catch(err => adapter.log.error('could not execute command: ' + err))
            .then(() => setTimeout(pollStatusApi, 1000));
    }
}

function listenOnShuffle(obj) {
    clearTimeout(application.statusInternalTimer);
    return sendRequest('/v1/me/player/shuffle?state=' + (obj.state.val === 'on' ? 'true' : 'false'), 'PUT', '', true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnShuffleOff() {
    return listenOnShuffle({
        state: {
            val: 'off',
            ack: false
        }
    });
}

function listenOnShuffleOn() {
    return listenOnShuffle({
        state: {
            val: 'on',
            ack: false
        }
    });
}

function listenOnTrackId(obj) {
    let send = {
        uris: ['spotify:track:' + obj.state.val],
        offset: {
            position: 0
        }
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), true)
        .catch(err => adapter.log.error('could not execute command: ' + err))
        .then(() => setTimeout(pollStatusApi, 1000));
}

function listenOnPlaylistId(obj) {
    return startPlaylist(obj.state.val, cache.getValue('player.playlist.owner').val, 0);
}

function listenOnPlaylistOwner(obj) {
    return startPlaylist(cache.getValue('player.playlist.id').val, obj.state.val, 0);
}

function listenOnPlaylistTrackNo(obj) {
    let owner = cache.getValue('player.playlist.owner').val;
    let id = cache.getValue('player.playlist.id').val;
    let o = obj.state.val;
    o = parseInt(o, 10) || 1;

    return startPlaylist(id, owner, o - 1, true);
}

function listenOnGetPlaybackInfo() {
    return pollStatusApi(true);
}

function listenOnGetDevices() {
    return sendRequest('/v1/me/player/devices', 'GET', '')
        .then(data => reloadDevices(data));
}

function clearCache() {
    artistImageUrlCache = {};
    playlistCache = {};
    application.cacheClearHandle = setTimeout(clearCache, 1000 * 60 * 60 * 24);
}

function listenOnHtmlPlaylists() {
    let obj = cache.getValue('playlists.playlistList');
    let current;
    if (obj === null || !obj.val) {
        current = '';
    } else {
        current = obj.val;
    }
    obj = cache.getValue('playlists.playlistListIds');
    if (obj === null || !obj.val) {
        return cache.setValue('html.playlists', '');
    }
    let ids = obj.val.split(';');
    obj = cache.getValue('playlists.playlistListString');
    if (obj === null || !obj.val) {
        return cache.setValue('html.playlists', '');
    }
    let strings = obj.val.split(';');
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
        html += `<tr class="spotifyPlaylistsRow${cssClassRow}" onclick="vis.setValue('${adapter.namespace}.playlists.playlistList', '${ids[i]}')">`;
        html += '<td' + style + ' class="spotifyPlaylistsCol spotifyPlaylistsColTitle' + cssClassTitle + '">';
        html += strings[i];
        html += '</td>';
        html += '<td class="spotifyPlaylistsCol spotifyPlaylistsColIcon' + cssClassIcon + '">';
        if (current === ids[i]) {
            html += '<img style="width: 16px; height: 16px" class="spotifyPlaylistsColIconActive" src="widgets/spotify-premium/img/active_song_speaker_green.png" alt="cover" />';
        }
        html += '</td>';
        html += '</tr>';
    }

    html += '</table>';

    return cache.setValue('html.playlists', html);
}

function listenOnHtmlTracklist() {
    let obj = cache.getValue('player.playlist.trackList');
    let current;
    if (obj === null || !obj.val) {
        current = '';
    } else {
        current = obj.val;
    }

    obj = cache.getValue('player.playlist.trackListArray');
    if (obj === null || !obj.val) {
        return cache.setValue('html.tracks', '');
    }
    if (typeof obj.val === 'string') {
        try {
            obj.val = JSON.parse(obj.val);
        } catch (e) {
            obj.val = [];
        }
    }

    let source = obj.val;
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
        if (current == i) {
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

        html += `<tr class="spotifyTracksRow${cssClassRow}" onclick="vis.setValue('${adapter.namespace}.player.playlist.trackList', ${i})">`;
        html += `<td class="spotifyTracksColIcon${cssClassIcon}">`;
        if (current == i) {
            html += '<img style="width: 16px; height: 16px" class="spotifyTracksIconActive" src="widgets/spotify-premium/img/active_song_speaker_green.png" />';
        } else {
            html += '<img style="width: 16px; height: 16px" class="spotifyTracksIconInactive" src="widgets/spotify-premium/img/inactive_song_note_white.png" />';
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
        html += source[i].album ? source[i].album.name || '--' : '--';
        html += '</span></span></td>';
        html += `<td${styleDuration} class="spotifyTracksColDuration${cssClassColDuration}">`;
        html += source[i].duration;
        html += '</td>';
        html += '</tr>';
    }

    html += '</table>';

    return cache.setValue('html.tracks', html);
}

function listenOnHtmlDevices() {
    let obj = cache.getValue('devices.deviceList');
    let current;
    if (obj === null || !obj.val) {
        current = '';
    } else {
        current = obj.val
    }
    obj = cache.getValue('devices.deviceListIds');
    if (obj === null || !obj.val) {
        return cache.setValue('html.devices', '');
    }
    let ids = obj.val.split(';');
    obj = cache.getValue('devices.availableDeviceListString');
    if (obj === null || !obj.val) {
        return cache.setValue('html.devices', '');
    }
    let strings = obj.val.split(';');
    let html = '<table class="spotifyDevicesTable">';

    for (let i = 0; i < ids.length; i++) {
        let type = getIconByType(cache.getValue('devices.' + ids[i] + '.type').val);

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
        html += `<tr class="spotifyDevicesRow${cssClassRow}" onclick="vis.setValue('${adapter.namespace}.devices.deviceList', '${ids[i]}')">`;
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

    cache.setValue('html.devices', html);
}

//If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
