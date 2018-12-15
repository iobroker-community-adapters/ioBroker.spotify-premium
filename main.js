/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
'use strict';
const adapter = require('@iobroker/adapter-core').adapter('spotify-premium');
const cache = require(__dirname + '/lib/cache')(adapter);
const ownUtils = require(__dirname + '/lib/utils')(adapter);
const querystring = require('querystring');
const Promise = require('promise');
const request = Promise.denodeify(require('request'));

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
        adapter.log.error('Client_ID is not filled');
        return;
    }
    if (isEmpty(application.clientSecret)) {
        adapter.log.error('Client_Secret is not filled');
        return;
    }
    if (isEmpty(application.deleteDevices)) {
        application.deleteDevices = false;
    }
    if (isEmpty(application.deletePlaylists)) {
        application.deletePlaylists = false;
    }
    if (isEmpty(application.keepShuffleState)) {
        application.keepShuffleState = true;
    }
    if (isEmpty(application.statusPollingDelaySeconds)) {
        application.statusPollingDelaySeconds = 5;
    } else if (application.statusPollingDelaySeconds < 1 && application.statusPollingDelaySeconds != 0) {
        application.statusPollingDelaySeconds = 1;
    }
    if (isEmpty(deviceInterval)) {
        deviceInterval = 0;
    }
    if (isEmpty(playlistInterval)) {
        playlistInterval = 0;
    }
    if (deviceInterval < 1 && deviceInterval != 0) {
        deviceInterval = 1;
    }
    if (playlistInterval < 1 && playlistInterval != 0) {
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
        .then(function(tokenObj) {
            application.token = tokenObj.accessToken;
            application.refreshToken = tokenObj.refreshToken;
        })
        .then(function() {
            return sendRequest('/v1/me', 'GET', '')
                .then(function(data) {
                    return setUserInformation(data).then(function() {
                        return cache.set('authorization.authorized', {val: true, ack: true})
                            .then(function() {
                                return listenOnGetPlaybackInfo().catch(function() {});
                            })
                            .then(function() {
                                return reloadUsersPlaylist().catch(function() {});
                            })
                            .then(function() {
                                return listenOnGetDevices().catch(function() {});
                            });
                    })
                });
        })
        .catch(function(err) {
            adapter.log.warn(err);
            return cache.set('authorization.authorized', {val: false, ack: true});
        });
}

function readTokenStates() {
	let state = cache.get('authorization.token')

    let tokenObj = state.val;
	let validAccessToken = !isEmpty(loadOrDefault(tokenObj, 'accessToken', ''));
	let validRefreshToken = !isEmpty(loadOrDefault(tokenObj, 'refreshToken', ''));
	let validClientId = !isEmpty(loadOrDefault(tokenObj, 'clientId', '')) && tokenObj.clientId == application.clientId;
	let validClientSecret = !isEmpty(loadOrDefault(tokenObj, 'clientSecret', '')) && tokenObj.clientSecret == application.clientSecret;
    if (validAccessToken && validRefreshToken && validClientId && validClientSecret) {
        adapter.log.debug('spotify token readed');
        return Promise.resolve(tokenObj);
    } else {
        return Promise.reject('invalid or no spotify token');
    }
}

function sendRequest(endpoint, method, sendBody) {
	let options = {
        url: application.baseUrl + endpoint,
        method: method,
        headers: {
            Authorization: 'Bearer ' + application.token
        },
        form: sendBody
    };
    adapter.log.debug('spotify api call...' + endpoint + '; ' + options.form);
    let callStack = new Error().stack;
    return request(options)
        .then(function(response) {
        	let body = response.body;
        	let ret;
        	let parsedBody;
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                parsedBody = {
                    error: {
                        message: "no active device"
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
                    ret = Promise.reject(response.statusCode);
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
                    if (parsedBody.error.message == 'The access token expired') {
                        adapter.log.debug('access token expired!');
                        ret = cache.set('authorization.authorized', {val: false, ack: true})
                            .then(function() {
                                return refreshToken().then(function() {
                                    return cache.set('authorization.authorized', {val: true, ack: true}).then(
                                        function() {
                                            return sendRequest(endpoint, method, sendBody)
                                                .then(function(data) {
                                                    // this Request get the data which requested with the old token
                                                    adapter.log.debug(
                                                        'data with new token');
                                                    return data;
                                                }).catch(function(err) {
                                                    if (err == 202) {
                                                        adapter.log.debug(err +
                                                            ' request accepted but no data, try again'
                                                        );
                                                    } else {
                                                        adapter.log.error(
                                                            'error on request data again. ' +
                                                            err);
                                                    }
                                                    return Promise.reject(err);
                                                });
                                        });
                                }).catch(function(err) {
                                    adapter.log.error(err);
                                    return Promise.reject(err);
                                });
                            });
                    } else {
                        // if other error with code 401
                        ret = cache.set('authorization.authorized', {val: false, ack: true})
                            .then(function() {
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
                    ret = new Promise(function(resolve) {
                        setTimeout(resolve, wait * 1000);
                    }).then(function() {
                        return sendRequest(endpoint, method, sendBody);
                    });
                    break;
                default:
                    adapter.log.warn('http request error not handled, please debug');
                    adapter.log.warn(callStack);
                    adapter.log.warn(new Error().stack);
                    adapter.log.debug('status code: ' + response.statusCode);
                    adapter.log.debug('body: ' + body);
                    ret = Promise.reject(response.statusCode);
            }
            return ret;
        }).catch(function(err) {
            adapter.log.error('erron in request: ' + err);
            return 0;
        });
}

function loadOrDefault(obj, name, defaultVal) {
	let t = undefined;
    try {
        eval('t = obj.' + name + ';');
    } catch (e) {}
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
            type: type,
            role: 'value',
            write: false,
            read: true
        },
        native: {}
    };
    if (!isEmpty(states)) {
        object.states = states;
    }
    return cache.set(state, {val: t, ack: true}, object);
}

function setOrDefault(obj, name, state, defaultVal) {
	let t = loadOrDefault(obj, name, defaultVal);
    return cache.set(state, {val: t, ack: true});
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
    	let artistName = loadOrDefault(data, name + '[' + i + '].name', '');
    	let artistId = loadOrDefault(data, name + '[' + i + '].id', '');
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
    	let artist = loadOrDefault(data, name + '[' + i + '].name', '');
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

	return cache.set(id, null, {
        type: obj.type,
        common: {
            name: obj.common.name,
            type: obj.common.type,
            role: obj.common.role,
            states: states,
            read: obj.common.read,
            write: obj.common.write
        },
        native: {}
    });
}

function copyState(src, dst) {
    return cache.set(dst, {val: cache.get(src).val});
}

function copyObjectStates(src, dst) {
    return setObjectStatesIfChanged(dst, cache.getObj(src).common.states);
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        adapter.log.debug('no playback content');
        return Promise.reject('no playback content');
    }
    let deviceId = loadOrDefault(data, 'device.id', '');
    let isDeviceActive = loadOrDefault(data, 'device.is_active', false);
    let isDeviceRestricted = loadOrDefault(data, 'device.is_restricted', false);
    let deviceName = loadOrDefault(data, 'device.name', '');
    let deviceType = loadOrDefault(data, 'device.type', 'Speaker');
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
    let contextDescription;
    let contextImage;
    let album = loadOrDefault(data, 'item.album.name', '');
    let albumUrl = loadOrDefault(data, 'item.album.images[0].url', '');
    let artist = getArtistNamesOrDefault(data, 'item.artists');
    if (type == 'album') {
        contextDescription = 'Album: ' + album;
        contextImage = albumUrl;
    } else if (type == 'artist') {
        contextDescription = 'Artist: ' + artist;
    } else if (type == 'track') {
        contextDescription = 'Track';
        // tracks has no images
        contextImage = albumUrl;
    }
    let shuffle = loadOrDefault(data, 'shuffle_state', false);
    Promise.all([
    	cache.set('player.device.id', {val: deviceId, ack: true}),
    	cache.set('player.device.isActive', {val: isDeviceActive, ack: true}),
    	cache.set('player.device.isRestricted', {val: isDeviceRestricted, ack: true}),
    	cache.set('player.device.name', {val: deviceName, ack: true}),
    	cache.set('player.device.type', {val: deviceType, ack: true}),
    	cache.set('player.device.volume', {val: deviceVolume, ack: true}),
    	cache.set('player.device.isAvailable', {val: true, ack: true}),
    	cache.set('player.device', null, {
            type: 'device',
            common: {
                name: deviceName,
                icon: getIconByType(deviceType)
            },
            native: {}
        }),
        cache.set('player.isPlaying', {val: isPlaying, ack: true}),
        setOrDefault(data, 'item.id', 'player.trackId', ''),
        cache.set('player.artistName', {val: artist, ack: true}),
        cache.set('player.album', {val: album, ack: true}),
        cache.set('player.albumImageUrl', {val: albumUrl, ack: true}),
        setOrDefault(data, 'item.name', 'player.trackName', ''),
        cache.set('player.durationMs', {val: duration, ack: true}),
        cache.set('player.duration', {val: convertToDigiClock(duration), ack: true}),
        cache.set('player.type', {val: type, ack: true}),
        cache.set('player.progressMs', {val: progress, ack: true}),
        cache.set('player.progressPercentage', {val: progressPercentage, ack: true}),
        cache.set('player.progress', {val: convertToDigiClock(progress), ack: true}),
        cache.set('player.shuffle', {val: (shuffle ? 'on' : 'off'), ack: true}),
        setOrDefault(data, 'repeat_state', 'player.repeat', 'off'),
        setOrDefault(data, 'device.volume_percent', 'player.device.volume', 100),
    ]).then(function() {
        if (deviceName) {
            deviceData.lastActiveDeviceId = deviceId;
            let states = cache.get('devices.*');

            let keys = Object.keys(states);
            let fn = function(key) {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                key = removeNameSpace(key);
                let name = '';
                if(deviceId != null) {
                	name = shrinkStateName(deviceId);
                } else {
                	name = shrinkStateName(deviceName);
                }
                if (key !== 'devices.' + name + '.isActive') {
                    return cache.set(key, {val: false, ack: true});
                }
            };
            return Promise.all(keys.map(fn)).then(function() {
                return createDevices({
                    devices: [{
                        id: deviceId,
                        is_active: isDeviceActive,
                        is_restricted: isDeviceRestricted,
                        name: deviceName,
                        type: deviceType,
                        volume_percent: deviceVolume
                    }]
                }).then(function() {
                	return refreshDeviceList();
                });
            });
        } else {
        	let states = cache.get('devices.*');
        	let keys = Object.keys(states);
        	let fn = function(key) {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                key = removeNameSpace(key);
                return cache.set(key, {val: false, ack: true});
            };
            return Promise.all(keys.map(fn));
        }
    }).then(function() {
        if (progress && isPlaying && application.statusPollingDelaySeconds > 0) {
            scheduleStatusInternalTimer(duration, progress, Date.now(), application.statusPollingDelaySeconds - 1);
        }
    }).then(function() {
    	let album = loadOrDefault(data, 'item.album.name', '');
    	let artists = [];
        for (let i = 0; i < 100; i++) {
        	let id = loadOrDefault(data, 'item.artists[' + i + '].id', '');
            if (isEmpty(id)) {
                break;
            } else {
                artists.push(id);
            }
        }
        let urls = [];
        let fn = function(artist) {
            if (artistImageUrlCache.hasOwnProperty(artist)) {
                urls.push(artistImageUrlCache[artist]);
            } else {
                return sendRequest('/v1/artists/' + artist,
                    'GET', '').then(
                    function(parseJson) {
                    	let url = loadOrDefault(parseJson, 'images[0].url', '');
                        if (!isEmpty(url)) {
                            artistImageUrlCache[artist] = url;
                            urls.push(url);
                        }
                    });
            }
        };
        return Promise.all(artists.map(fn)).then(function() {
        	let set = '';
            if (urls.length !== 0) {
                set = urls[0];
            }
            if (type == 'artist') {
                contextImage = set;
            }
            return cache.set('player.artistImageUrl', {val: set, ack: true});
        });
    }).then(function() {
    	let uri = loadOrDefault(data, 'context.uri', '');
        if (type == 'playlist' && uri) {
        	let indexOfUser = uri.indexOf('user:') + 5;
        	let endIndexOfUser = uri.indexOf(':', indexOfUser);
        	let indexOfPlaylistId = uri.indexOf('playlist:') + 9;
        	let playlistId = uri.slice(indexOfPlaylistId);
        	let userId = uri.substring(indexOfUser, endIndexOfUser);
        	let query = {
                fields: 'name,id,owner.id,tracks.total,images',
            };
            return cache.set('player.playlist.id', {val: playlistId, ack: true}).then(function() {
            	let refreshPlaylist = function(parseJson) {
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
                        images: [{
                            url: playlistImage
                        }],
                        owner: {
                            id: ownerId
                        },
                        tracks: {
                            total: trackCount
                        }
                    };

                    return Promise.all([
                    	cache.set('player.playlist.owner', {val: ownerId, ack: true}),
                    	cache.set('player.playlist.tracksTotal', {val: trackCount, ack: true}),
                        cache.set('player.playlist.imageUrl', {val: playlistImage, ack: true}),
                        cache.set('player.playlist.name', {val: playlistName, ack: true}),
                        cache.set('player.playlist', null, {
                            type: 'channel',
                            common: {
                                name: playlistName
                            },
                            native: {}
                        })
                    ]).then(function() {
                    	if(cache.get('playlists.' + prefix + '.trackListIds') == null) {
                    		return createPlaylists({
                                items: [
                                    parseJson
                                ]
                            });
                    	} else {
                    		return refreshPlaylistList();
                    	}
                    }).then(function() {
                        return Promise.all([
                            copyState('playlists.' +
                                prefix +
                                '.trackListNumber',
                                'player.playlist.trackListNumber'
                            ),
                            copyState('playlists.' +
                                prefix +
                                '.trackListString',
                                'player.playlist.trackListString'
                            ),
                            copyState('playlists.' +
                                prefix +
                                '.trackListStates',
                                'player.playlist.trackListStates'
                            ),
                            copyObjectStates(
                                'playlists.' +
                                prefix +
                                '.trackList',
                                'player.playlist.trackList'
                            ),
                            copyState('playlists.' +
                                prefix +
                                '.trackListIdMap',
                                'player.playlist.trackListIdMap'
                            ),
                            copyState('playlists.' +
                                prefix +
                                '.trackListIds',
                                'player.playlist.trackListIds'
                            ),
                            copyState('playlists.' +
                                prefix +
                                '.trackListArray',
                                'player.playlist.trackListArray'
                            )
                        ]);
                    }).then(function() {
                    	let state = cache.get('playlists.' + prefix + '.trackListIds');
                        let ids = loadOrDefault(state, 'val', '');
                        if (isEmpty(ids)) {
                            return Promise.reject(
                                'no ids in trackListIds'
                            );
                        }
                        let stateName = ids.split(
                            ';');
                        let stateArr = [];
                        for (let i = 0; i < stateName.length; i++) {
                        	let ele = stateName[i].split(':');
                            stateArr[ele[1]] = ele[0];
                        }
                        if (stateArr[songId] !== '' && (stateArr[songId] !== null)) {
                            return Promise.all([
                            	cache.set(
                                    'playlists.' + prefix + '.trackList',
                                    {val: stateArr[
                                        songId
                                    ],
                                    ack: true}),
                                cache.set(
                                    'player.playlist.trackList',
                                    {val: stateArr[
                                        songId
                                    ],
                                    ack: true}),
                                cache.set(
                                    'player.playlist.trackNo',
                                    {val: stateArr[
                                        songId
                                    ],
                                    ack: true})
                            ]);
                        }
	                });
	            }
                if (playlistCache.hasOwnProperty(userId + '-' + playlistId)) {
                    return refreshPlaylist(playlistCache[userId + '-' + playlistId]);
                } else {
                    return sendRequest('/v1/users/' + userId + '/playlists/' +
                        playlistId +
                        '?' + querystring.stringify(query),
                        'GET', '').then(refreshPlaylist);
                }
            });
        } else {
            adapter.log.debug('context type: ' + type);
            return Promise.all([
            	cache.set('player.playlist.id', {val: '', ack: true}),
            	cache.set('player.playlist.name', {val: '', ack: true}),
            	cache.set('player.playlist.owner', {val: '', ack: true}),
            	cache.set('player.playlist.tracksTotal', {val: '', ack: true}),
            	cache.set('player.playlist.imageUrl', {val: '', ack: true}),
            	cache.set('player.playlist.trackList', {val: '', ack: true}),
            	cache.set('player.playlist.trackListNumber', {val: '', ack: true}),
            	cache.set('player.playlist.trackListString', {val: '', ack: true}),
            	cache.set('player.playlist.trackListStates', {val: '', ack: true}),
            	cache.set('player.playlist.trackListIdMap', {val: '', ack: true}),
            	cache.set('player.playlist.trackListIds', {val: '', ack: true}),
            	cache.set('player.playlist.trackListArray', {val: '', ack: true}),
            	cache.set('player.playlist.trackNo', {val: '', ack: true}),
            	cache.set('player.playlist', null, {
                    type: 'channel',
                    common: {
                        name: ''
                    },
                    native: {}
                })
            ]);
        }
    }).then(function() {
        return Promise.all([
        	cache.set('player.contextImageUrl', {val: contextImage, ack: true}),
        	cache.set('player.contextDescription', {val: contextDescription, ack: true})
        ]);
    });
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
    return cache.set('authorization.userId', {val: data.id, ack: true});
}

function reloadUsersPlaylist() {
	let r;
    if (application.deletePlaylists) {
        r = deleteUsersPlaylist().then(function() {
            return getUsersPlaylist(0);
        });
    } else {
        r = getUsersPlaylist(0);
    }
    return r.then(function() {
        return refreshPlaylistList();
    });
}

function deleteUsersPlaylist() {
	let states = cache.get('playlists.*');
    let keys = Object.keys(states);
    let fn = function(key) {
        key = removeNameSpace(key);
        if (key != 'playlists.playlistList' &&
            key != 'playlists.playlistListIds' &&
            key != 'playlists.playlistListString' &&
            key != 'playlists.yourPlaylistListIds' &&
            key != 'playlists.yourPlaylistListString') {
            return cache.delObject(key).then(function() {
                if (key.endsWith('.id')) {
                    return cache.delObject(key.substring(0, key.length - 3));
                }
            });
        }
    };
    return Promise.all(keys.map(fn));
}

function createPlaylists(parseJson, autoContinue) {
    if (isEmpty(parseJson) || isEmpty(parseJson.items)) {
        adapter.log.debug('no playlist content');
        return Promise.reject('no playlist content');
    }
    let fn = function(item) {
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
            images: [{
                url: imageUrl
            }],
            owner: {
                id: ownerId
            },
            tracks: {
                total: trackCount
            }
        };
        let prefix = 'playlists.' + shrinkStateName(ownerId + '-' + playlistId);
        return Promise.all([
        	cache.set(prefix, null, {
                type: 'channel',
                common: {
                    name: playlistName
                },
                native: {}
            }),
            cache.set(prefix + '.playThisList', {val: false, ack: true}, {
                type: 'state',
                common: {
                    name: 'press to play this playlist',
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                    icon: 'icons/play.png'
                },
                native: {}
            }),
            createOrDefault(item, 'id', prefix + '.id', '', 'playlist id', 'string'),
            createOrDefault(item, 'owner.id', prefix + '.owner', '', 'playlist owner', 'string'),
            createOrDefault(item, 'name', prefix + '.name', '', 'playlist name', 'string'),
            createOrDefault(item, 'tracks.total', prefix + '.tracksTotal', '', 'number of songs', 'number'),
            createOrDefault(item, 'images[0].url', prefix + '.imageUrl', '', 'image url', 'string')
        ]).then(function() {
            return getPlaylistTracks(ownerId, playlistId, 0).then(function(
                playlistObject) {
                return Promise.all([
                	cache.set(prefix + '.trackList', {val: '', ack: true}, {
                        type: 'state',
                        common: {
                            name: 'Tracks of the playlist saved in common part. Change this value to a track position number to start this playlist with this track. First track is 0',
                            type: 'number',
                            role: 'value',
                            states: playlistObject.stateString,
                            read: true,
                            write: true
                        },
                        native: {}
                    }),
                    createOrDefault(playlistObject, 'listNumber', prefix +
                        '.trackListNumber', '',
                        'contains list of tracks as string, patter: 0;1;2;...',
                        'string'),
                    createOrDefault(playlistObject, 'listString', prefix +
                        '.trackListString', '',
                        'contains list of tracks as string, patter: title - artist;title - artist;title - artist;...',
                        'string'),
                    createOrDefault(playlistObject, 'stateString', prefix +
                        '.trackListStates', '',
                        'contains list of tracks as string with position, pattern: 0:title - artist;1:title - artist;2:title - artist;...',
                        'string'),
                    createOrDefault(playlistObject, 'trackIdMap', prefix +
                        '.trackListIdMap', '',
                        'contains list of track ids as string with position, pattern: 0:id;1:id;2:id;...',
                        'string'),
                    createOrDefault(playlistObject, 'trackIds', prefix +
                        '.trackListIds', '',
                        'contains list of track ids as string, pattern: id;id;id;...',
                        'string'),
                    createOrDefault(playlistObject, 'songs', prefix +
                        '.trackListArray', '',
                        'contains list of tracks as array object, pattern:\n[{id: "id",\ntitle: "title",\nartistName: "artistName1, artistName2",\nartistArray: [{id: "artistId", name: "artistName"}, {id: "artistId", name: "artistName"}, ...],\nalbum: {id: "albumId", name: "albumName"},\ndurationMs: 253844,\nduration: 4:13,\naddedAt: 15395478261235,\naddedBy: "userId",\ndiscNumber: 1,\nepisode: false,\nexplicit: false,\npopularity: 56\n}, ...]',
                        'object')
                ]);
            });
        });
    };
    return Promise.all(parseJson.items.map(fn)).then(function() {
        if (autoContinue && parseJson.items.length !== 0 && (parseJson['next'] !== null)) {
            return getUsersPlaylist(parseJson.offset + parseJson.limit);
        }
    });
}

function getUsersPlaylist(offset) {
    if (!isEmpty(application.userId)) {
    	let query = {
            limit: 30,
            offset: offset
        };
        return sendRequest('/v1/users/' + application.userId + '/playlists?' +
            querystring.stringify(query), 'GET', '').then(
            function(parsedJson) {
                return createPlaylists(parsedJson, true);
            }
        ).catch(function(err) {
            adapter.log.error('playlist error ' + err);
        });
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
    while (old != str);
    return str.trim();
}

function getPlaylistTracks(owner, id, offset, playlistObject) {
    playlistObject = playlistObject && playlistObject !== undefined ? playlistObject : {
        stateString: '',
        listString: '',
        listNumber: '',
        trackIdMap: '',
        trackIds: '',
        songs: []
    };
    let regParam = owner + '/playlists/' + id + '/tracks';
    let query = {
        fields: 'total,offset,items(added_at,added_by.id,track(name,id,artists(name,id),duration_ms,album(name,id),disc_number,episode,explicit,popularity))',
        limit: 100,
        offset: offset
    };
    return sendRequest('/v1/users/' + regParam + '?' + querystring.stringify(query), 'GET', '').then(
        function(data) {
        	let i = offset;
            data.items.forEach(function(item) {
            	let no = i.toString();
            	let artist = getArtistNamesOrDefault(item, 'track.artists');
            	let artistArray = getArtistArrayOrDefault(item, 'track.artists');
            	let trackName = loadOrDefault(item, 'track.name', '');
            	let trackDuration = loadOrDefault(item, 'track.duration_ms', '');
            	let trackId = loadOrDefault(item, 'track.id', '');
                if (isEmpty(trackId)) {
                	adapter.log.debug(
                			'There was a playlist track ignored because of missing id; playlist: ' +
                			id + '; track name: ' + trackName);
                	return;
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
                playlistObject.stateString += no + ':' + cleanState(trackName) + ' - ' +
                    cleanState(artist);
                playlistObject.listString += cleanState(trackName) + ' - ' + cleanState(artist);
                playlistObject.trackIdMap += cleanState(trackId);
                playlistObject.trackIds += no + ':' + cleanState(trackId);
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
                return getPlaylistTracks(owner, id, offset + 100, playlistObject);
            } else {
                return Promise.resolve(playlistObject);
            }
        }).catch(function(err) {
        adapter.log.warn('error on load tracks: ' + err);
    });
}

function reloadDevices(data) {
	return createDevices(data).then(function (addedList) {
		let p;
		if (application.deleteDevices) {
			p = deleteDevices(addedList);
	    } else {
	    	p = disableDevices(addedList);
	    }
		return p.then(function() {
			return refreshDeviceList();
		})
	})
}

function disableDevices(addedList) {
	let states = cache.get('devices.*');
	let keys = Object.keys(states);
	let fn = function(key) {
        key = removeNameSpace(key);
        let found = false;
        for(let i = 0; i < addedList.length; i++) {
        	if(key.startsWith(addedList[i])) {
        		found = true;
        		break;
        	}
        }
        if (!found && key.endsWith('.isAvailable')) {
            return cache.set(key, {val: false, ack: true});
        }
    };
    return Promise.all(keys.map(fn));
}

function deleteDevices(addedList) {
	let states = cache.get('devices.*');
    let keys = Object.keys(states);
    let fn = function(key) {
        key = removeNameSpace(key);
        let found = false;
        for(let i = 0; i < addedList.length; i++) {
        	if(key.startsWith(addedList[i])) {
        		found = true;
        		break;
        	}
        }

        if (!found &&
        	key != 'devices.deviceList' &&
            key != 'devices.deviceListIds' &&
            key != 'devices.deviceListString' &&
            key != 'devices.availableDeviceListIds' &&
            key != 'devices.availableDeviceListString') {
            return cache.delObject(key).then(function() {
                if (key.endsWith('.id')) {
                    return cache.delObject(key.substring(0, key.length - 3));
                }
            });
        }
    };
    return Promise.all(keys.map(fn));
}

function getIconByType(type) {
    if (type == 'Computer') {
        return 'icons/computer.png';
    } else if (type == 'Smartphone') {
        return 'icons/smartphone.png';
    }
    // Speaker
    return 'icons/speaker.png';
}

function createDevices(data) {
    if (isEmpty(data) || isEmpty(data.devices)) {
        adapter.log.debug('no device content')
        return Promise.reject('no device content');
    }
    let addedList = [];
    let fn = function(device) {
    	let deviceId = loadOrDefault(device, 'id', '');
    	let deviceName = loadOrDefault(device, 'name', '');
        if (isEmpty(deviceName)) {
        	adapter.log.warn('empty device name')
        	return Promise.reject('empty device name');
        }
        let name = '';
        if(deviceId != null) {
        	name = shrinkStateName(deviceId);
        } else {
        	name = shrinkStateName(deviceName);
        }
        let prefix = 'devices.' + name;
        addedList.push(prefix);

        let isRestricted = loadOrDefault(device, 'is_restricted', false);
        let useForPlayback;
        if(!isRestricted) {
        	useForPlayback = cache.set(prefix + '.useForPlayback', {val: false, ack: true}, {
        		type: 'state',
        		common: {
        			name: 'press to use device for playback (only for non restricted devices)',
        			type: 'boolean',
        			role: 'button',
        			read: false,
        			write: true,
        			icon: 'icons/play.png'
        		},
        		native: {}
        	});
        } else {
        	useForPlayback = cache.delObject(prefix + '.useForPlayback');
        }
        return Promise.all([
        	cache.set(prefix, null, {
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
            cache.set(prefix + '.isAvailable', {val: true, ack: true}, {
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
    return Promise.all(data.devices.map(fn)).then(function() {
        return addedList;
    });
}

function refreshPlaylistList() {
    let a = [];
    let states = cache.get('playlists.*');
    let keys = Object.keys(states);
    let fn = function(key) {
        if (!key.endsWith('.name')) {
            return;
        }
        let normKey = removeNameSpace(key);
        let id = normKey.substring(10, normKey.length - 5);
        a.push({
            id: id,
            name: states[key].val,
            your: application.userId == cache.get('playlists.' + id + '.owner').val
        });
    };
    return Promise.all(keys.map(fn)).then(function() {
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
            cache.set('playlists.playlistListIds', {val: listIds}),
            cache.set('playlists.playlistListString', {val: listString}),
            cache.set('playlists.yourPlaylistListIds', {val: yourIds}),
            cache.set('playlists.yourPlaylistListString',
                {val: yourString})
        ]).then(function() {
        	let id = cache.get('player.playlist.id').val;
            if (id) {
            	let owner = cache.get('player.playlist.owner').val;
                if (owner) {
                    return cache.set('playlists.playlistList', {val: owner + '-' + id});
                }
            }
        });
    });
}

function refreshDeviceList() {
    let a = [];
    let states = cache.get('devices.*');
    let keys = Object.keys(states);
    let fn = function(key) {
        if (!key.endsWith('.name')) {
            return;
        }
        let normKey = removeNameSpace(key);
        let id = normKey.substring(8, normKey.length - 5);
        a.push({
            id: id,
            name: states[key].val,
            available: cache.get('devices.' + id + '.isAvailable').val
        });
    };

    return Promise.all(keys.map(fn)).then(function() {
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
            cache.set('devices.deviceListIds', {val: listIds}),
            cache.set('devices.deviceListString', {val: listString}),
            cache.set('devices.availableDeviceListIds', {val: availableIds}),
            cache.set('devices.availableDeviceListString', {val: availableString}),
        ]).then(function() {
        	let states = cache.get('devices.*');
        	let keys = Object.keys(states);
        	let fn = function(key) {
                if (!key.endsWith('.isActive')) {
                    return;
                }
                let val = states[key].val;
                if (val) {
                    key = removeNameSpace(key);
                    let id = key.substring(8, key.length - 9);
                    return cache.set('devices.deviceList', {val: id});
                }
            };
            return Promise.all(keys.map(fn));
        });
    });
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
            Authorization: 'Basic ' +
                Buffer.from(
                    application.clientId + ':' +
                    application.clientSecret).toString(
                    'base64')
        },
        form: {
            grant_type: 'authorization_code',
            code: application.code,
            redirect_uri: application.redirect_uri
        }
    };
    return request(options)
        .then(function(response) {
        	let body = response.body;
        	let parsedBody;
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                parsedBody = {};
            }
            saveToken(parsedBody).then(function(tokenObj) {
                return Promise.all([
                	cache.set('authorization.authorizationUrl', {val: '', ack: true}),
                	cache.set('authorization.authorizationReturnUri', {val: '', ack: true}),
                	cache.set('authorization.authorized', {val: true, ack: true})
                ]).then(function() {
                    application.token = tokenObj.accessToken;
                    application.refreshToken = tokenObj.refreshToken;
                    return start();
                });
            }).catch(function(err) {
                adapter.log.debug(err);
            })
        });
}

function refreshToken() {
    adapter.log.debug('token is requested again');
    let options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' +
                Buffer.from(
                    application.clientId + ':' +
                    application.clientSecret).toString(
                    'base64')
        },
        form: {
            grant_type: 'refresh_token',
            refresh_token: application.refreshToken
        }
    };
    if (application.refreshToken !== '') {
        return request(options)
            .then(function(response) {
                // this request gets the new token
                if (response.statusCode == 200) {
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
                    return saveToken(parsedJson).then(
                        function(tokenObj) {
                            application.token = tokenObj.accessToken;
                        }).catch(function(err) {
                        adapter.log.debug(err);
                        return Promise.reject(err);
                    })
                } else {
                    return Promise.reject(response.statusCode);
                }
            });
    }
    return Promise.reject('no refresh token');
}

function saveToken(data) {
    adapter.log.debug('saveToken');
    if ('undefined' !== typeof data.access_token && ('undefined' !== typeof data.refresh_token)) {
    	let token = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            clientId: application.clientId,
            clientSecret: application.clientSecret
        };
        return cache.set('authorization.token', {val: token, ack: true}).then(function() {
            return token;
        });
    } else {
        adapter.log.error(JSON.stringify(data));
        return Promise.reject('no tokens found in server response');
    }
}

function increaseTime(durationMs, progressMs, startDate, count) {
	let now = Date.now();
    count--;
    progressMs += now - startDate;
    let tDurationMs = cache.get('player.durationMs').val;
    let percentage = Math.floor(progressMs / tDurationMs * 100);
    return Promise.all([
    	cache.set('player.progress', {val: convertToDigiClock(progressMs), ack: true}),
    	cache.set('player.progressMs', {val: progressMs, ack: true}),
    	cache.set('player.progressPercentage', {val: percentage, ack: true})
    ]).then(function() {
        if (count > 0) {
            if (progressMs + 1000 > durationMs) {
                setTimeout(pollStatusApi, 1000);
            } else {
            	let state = cache.get('player.isPlaying');
        		if(state.val) {
        			scheduleStatusInternalTimer(durationMs, progressMs, now, count);
        		}
            }
        }
    })
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
    return sendRequest('/v1/me/player', 'GET', '').then(function(data) {
        createPlaybackInfo(data);
        if (!noReschedule) {
            scheduleStatusPolling();
        }
    }).catch(function(err) {
        if (err != 202) {
            application.error202shown = false;
        }
        if (err == 202 || err == 401 || err == 502) {
            if (err == 202) {
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
    sendRequest('/v1/me/player/devices', 'GET', '').then(function(data) {
        reloadDevices(data);
        scheduleDevicePolling();
    }).catch(function(err) {
        adapter.log.error('spotify device polling stopped with error ' + err);
    });
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
        r = r.then(function() {
        	let state = cache.get('player.shuffle');
            if (state.val) {
                resetShuffle = true;
                if (!keepTrack) {
                    trackNo = Math.floor(Math.random() * Math.floor(cache.get('playlists.' + shrinkStateName(owner + '-' + playlist) +'.tracksTotal').val));
                }
            }
            return;
        });
    }
    return r.then(function() {
    	let send = {
            context_uri: 'spotify:user:' + owner + ':playlist:' + playlist,
            offset: {
                position: trackNo
            }
        };
        return sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send)).then(function() {
            setTimeout(pollStatusApi, 1000, true);
        }).catch(function(err) {
            adapter.log.error('could not start playlist ' + playlist + ' of user ' + owner +
                '; error: ' +
                err);
        });
    }).then(function() {
        if (application.keepShuffleState && resetShuffle) {
            return listenOnShuffleOn();
        }
    });
}

function listenOnAuthorizationReturnUri(obj) {
	let state = cache.get('authorization.state')
    let returnUri = querystring.parse(obj.state.val.slice(obj.state.val.search('[?]') + 1, obj.state.val.length));
    if ('undefined' !== typeof returnUri.state) {
        returnUri.state = returnUri.state.replace(/#_=_$/g, '');
    }
    if (returnUri.state == state.val) {
        adapter.log.debug('getToken');
        application.code = returnUri.code;
        return getToken();
    } else {
        adapter.log.error(
            'invalid session. you need to open the actual authorization.authorizationUrl'
        );
        return cache.set('Authorization.Authorization_Return_URI',
        	{val: 'invalid session. You need to open the actual Authorization.Authorization_URL again',
            ack: true});
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
        url: 'https://accounts.spotify.com/de/authorize/?' +
            querystring.stringify(query),
        method: 'GET',
        followAllRedirects: true,
    };
    return Promise.all([
    	cache.set('authorization.state', {val: state, ack: true}),
    	cache.set('authorization.authorizationUrl', {val: options.url, ack: true}),
    	cache.set('authorization.authorized', {val: false, ack: true})
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
    deviceData.lastSelectDeviceId = cache.get(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id').val;
    let send = {
        device_ids: [deviceData.lastSelectDeviceId],
    };
    return sendRequest('/v1/me/player', 'PUT', JSON.stringify(send)).then(function() {
        setTimeout(pollStatusApi, 1000, true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
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
    let id = cache.get(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id').val;
    let owner = cache.get(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.owner').val;
    return startPlaylist(id, owner, pos, keepTrack);
}

function listenOnDeviceList(obj) {
    if (!isEmpty(obj.state.val)) {
        listenOnUseForPlayback({
            id: 'devices.' + obj.state.val + '.useForPlayback'
        });
    }
}

function listenOnPlaylistList(obj) {
    if (!isEmpty(obj.state.val)) {
        listenOnPlayThisList({
            id: 'playlists.' + obj.state.val + '.playThisList'
        });
    }
}

function listenOnPlay() {
	let query = {
        device_id: getSelectedDevice(deviceData)
    };
    adapter.log.debug(getSelectedDevice(deviceData))
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT', '').catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    })
}

function listenOnPause() {
	let query = {
        device_id: getSelectedDevice(deviceData)
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/pause?' + querystring.stringify(query), 'PUT', '').catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    })
}

function listenOnSkipPlus() {
	let query = {
        device_id: getSelectedDevice(deviceData)
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/next?' + querystring.stringify(query), 'POST', '').catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    });
}

function listenOnSkipMinus() {
	let query = {
        device_id: getSelectedDevice(deviceData)
    };
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/previous?' + querystring.stringify(query), 'POST', '').catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    });
}

function listenOnRepeat(obj) {
    if (['track', 'context', 'off'].indexOf(obj.state.val) >= 0) {
    	clearTimeout(application.statusInternalTimer);
        sendRequest('/v1/me/player/repeat?state=' + obj.state.val, 'PUT', '').catch(function(err) {
            adapter.log.error('could not execute command: ' + err);
        }).then(function() {
            setTimeout(pollStatusApi, 1000);
        })
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
    sendRequest('/v1/me/player/volume?volume_percent=' + obj.state.val, 'PUT', '').catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    });
}

function listenOnProgressMs(obj) {
	let progress = obj.state.val;
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/seek?position_ms=' + progress, 'PUT', '').then(function() {
    	let duration = cache.get('player.durationMs').val;
        if (duration > 0 && duration <= progress) {
        	let progressPercentage = Math.floor(progress / duration * 100);
            return Promise.all([
            	cache.set('player.progressMs', {val: progress, ack: true}),
            	cache.set('player.progress', {val: convertToDigiClock(progress), ack: true}),
                cache.set('player.progressPercentage', {val: progressPercentage, ack: true})
            ]);
        }
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
    	setTimeout(pollStatusApi, 1000);
    });
}

function listenOnProgressPercentage(obj) {
	let progressPercentage = obj.state.val;
    if (progressPercentage < 0 || progressPercentage > 100) {
        return;
    }
    clearTimeout(application.statusInternalTimer);
    let duration = cache.get('player.durationMs').val;
    if (duration > 0) {
        let progress = Math.floor(progressPercentage / 100 * duration);
        sendRequest('/v1/me/player/seek?position_ms=' + progress, 'PUT', '').then(function() {
            return Promise.all([
            	cache.set('player.progressMs', {val: progress, ack: true}),
            	cache.set('player.progress', {val: convertToDigiClock(progress), ack: true}),
                cache.set('player.progressPercentage', {val: progressPercentage, ack: true})
            ]);
        }).catch(function(err) {
            adapter.log.error('could not execute command: ' + err);
        }).then(function () {
        	setTimeout(pollStatusApi, 1000);
        });
    }
}

function listenOnShuffle(obj) {
	clearTimeout(application.statusInternalTimer);
    return sendRequest('/v1/me/player/shuffle?state=' + (obj.state.val === 'on' ? 'true' : 'false'), 'PUT', '').catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    });
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
    sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send)).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
        setTimeout(pollStatusApi, 1000);
    });
}

function listenOnPlaylistId(obj) {
    return startPlaylist(obj.state.val, cache.get('player.playlist.owner').val, 0);
}

function listenOnPlaylistOwner(obj) {
    return startPlaylist(cache.get('player.playlist.id').val, obj.state.val, 0);
}

function listenOnPlaylistTrackNo(obj) {
    let owner = cache.get('player.playlist.owner').val;
    let id = cache.get('player.playlist.id').val;
    return startPlaylist(id, owner, obj.state.val, true);
}

function listenOnGetPlaybackInfo() {
    return pollStatusApi(true);
}

function listenOnGetDevices() {
    return sendRequest('/v1/me/player/devices', 'GET', '').then(function(data) {
        return reloadDevices(data);
    });
}

function clearCache() {
    artistImageUrlCache = {};
    playlistCache = {};
    application.cacheClearHandle = setTimeout(clearCache, 1000 * 60 * 60 * 24);
}

cache.on('authorization.authorizationReturnUri', listenOnAuthorizationReturnUri, true);
cache.on('authorization.getAuthorization', listenOnGetAuthorization);
cache.on('authorization.authorized', listenOnAuthorized);
cache.on(/\.useForPlayback$/, listenOnUseForPlayback);
cache.on(/\.trackList$/, listenOnTrackList, true);
cache.on(/\.playThisList$/, listenOnPlayThisList);
cache.on('devices.deviceList', listenOnDeviceList, true);
cache.on('playlists.playlistList', listenOnPlaylistList, true);
cache.on('player.play', listenOnPlay);
cache.on('player.pause', listenOnPause);
cache.on('player.skipPlus', listenOnSkipPlus);
cache.on('player.skipMinus', listenOnSkipMinus);
cache.on('player.repeat', listenOnRepeat, true);
cache.on('player.repeatTrack', listenOnRepeatTrack);
cache.on('player.repeatContext', listenOnRepeatContext);
cache.on('player.repeatOff', listenOnRepeatOff);
cache.on('player.device.volume', listenOnVolume, true);
cache.on('player.progressMs', listenOnProgressMs, true);
cache.on('player.progressPercentage', listenOnProgressPercentage, true);
cache.on('player.shuffle', listenOnShuffle, 'on');
cache.on('player.shuffleOff', listenOnShuffleOff);
cache.on('player.shuffleOn', listenOnShuffleOn);
cache.on('player.trackId', listenOnTrackId, true);
cache.on('player.playlist.id', listenOnPlaylistId, true);
cache.on('player.playlist.owner', listenOnPlaylistOwner, true);
cache.on('player.playlist.trackNo', listenOnPlaylistTrackNo, true);
cache.on('getPlaylists', reloadUsersPlaylist);
cache.on('getPlaybackInfo', listenOnGetPlaybackInfo);
cache.on('getDevices', listenOnGetDevices);
adapter.on('ready', function() {
	cache.init().then(function() {		
		main();
	});
});
adapter.on('objectChange', cache.setExternalObj);
adapter.on('stateChange', cache.setExternal);
adapter.on('unload', function(callback) {
    Promise.all([
    	cache.set('authorization.authorizationUrl', {val: '', ack: true}),
    	cache.set('authorization.authorizationReturnUri', {val: '', ack: true}),
    	cache.set('authorization.userId', {val: '', ack: true}),
    	cache.set('player.trackId', {val: '', ack: true}),
    	cache.set('player.playlist.id', {val: '', ack: true}),
    	cache.set('player.playlist.trackNo', {val: '', ack: true}),
    	cache.set('player.playlist.owner', {val: '', ack: true}),
    	cache.set('authorization.authorized', {val: false, ack: true})
    ]).then(function() {
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
    }).nodeify(callback);
});
