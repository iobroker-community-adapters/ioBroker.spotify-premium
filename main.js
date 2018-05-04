/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
'use strict';
var utils = require(__dirname + '/lib/utils');
var querystring = require('querystring');
var Promise = require('promise');
var adapter = new utils.Adapter('spotify-premium');
var request = Promise.denodeify(require('request'));

function setState(id, state, ack, options) {
    return new Promise(function(resolve, reject) {
        var retFunc = function(err, id) {
            if (err) {
                reject(err);
            } else {
                resolve(id);
            }
        }
        if (options === undefined) {
            options = retFunc;
            retFunc = undefined;
        }
        if (typeof state === 'object') {
            state = {
                val: state,
                ack: ack
            };
            ack = undefined;
        }
        if (ack === undefined && typeof options === 'function') {
            ack = options;
            options = undefined;
        }
        adapter.setState(id, state, ack, options, retFunc);
    });
}

function setObjectNotExists(id, object, options) {
    return new Promise(function(resolve, reject) {
        var retFunc = function(err, obj) {
            if (err) {
                reject(err);
            } else {
                resolve(obj);
            }
        }
        if (options === undefined) {
            options = retFunc;
            retFunc = undefined;
        }
        adapter.setObjectNotExists(id, object, options, retFunc);
    });
}

function setObject(id, object, options) {
    return new Promise(function(resolve, reject) {
        var retFunc = function(err, obj) {
            if (err) {
                reject(err);
            } else {
                resolve(obj);
            }
        }
        if (options === undefined) {
            options = retFunc;
            retFunc = undefined;
        }
        adapter.setObject(id, object, options, retFunc);
    });
}

function getStates(pattern, options) {
    return new Promise(function(resolve, reject) {
        var retFunc = function(err, states) {
            if (err) {
                reject(err);
            } else {
                resolve(states);
            }
        }
        if (options === undefined) {
            options = retFunc;
            retFunc = undefined;
        }
        adapter.getStates(pattern, options, retFunc);
    });
}

function getState(id) {
    return new Promise(function(resolve, reject) {
        adapter.getState(id, function(err, state) {
            if (err) {
                reject(err);
            } else if (state !== null) {
                resolve(state);
            } else {
                reject('not existing state ' + id);
            }
        });
    });
}

function delObject(id, options, callback) {
    return new Promise(function(resolve, reject) {
        var retFunc = function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        }
        if (options === undefined) {
            options = retFunc;
            retFunc = undefined;
        }
        adapter.delObject(id, options, retFunc);
    });
}
var listener = [];
var application = {
    userId: '',
    baseUrl: 'https://api.spotify.com',
    clientId: '',
    clientSecret: '',
    deleteDevices: false,
    deletePlaylists: false,
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
    error202shown: false
};
var deviceData = {
    lastActiveDeviceId: '',
    lastSelectDeviceId: ''
};

function isEmpty(str) {
    return ((!str && typeof str != 'number') || 0 === str.length);
}

function main() {
    application.clientId = adapter.config.client_id;
    application.clientSecret = adapter.config.client_secret;
    application.deleteDevices = adapter.config.delete_devices;
    application.deletePlaylists = adapter.config.delete_playlists;
    application.statusPollingDelaySeconds = adapter.config.status_interval;
    var deviceInterval = adapter.config.device_interval;
    var playlistInterval = adapter.config.playlist_interval;
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
    return readTokenStates()
        .then(function(tokenObj) {
            application.token = tokenObj.accessToken;
            application.refreshToken = tokenObj.refreshToken;
        })
        .then(function() {
            return sendRequest('/v1/me', 'GET', '')
                .then(function(data) {
                    return setUserInformation(data).then(function() {
                        return setState('authorization.authorized', true, true)
                            .then(function() {
                                return listenOnGetPlaybackInfo();
                            }).catch(function() {
                            }).then(function() {
                                return reloadUsersPlaylist();
                            }).catch(function() {
                            }).then(function() {
                                return listenOnGetDevices();
                            }).catch(function() {
                            });
                    })
                });
        })
        .catch(function(err) {
            adapter.log.warn(err);
            return setState('authorization.authorized', false, true);
        });
}

function readTokenStates() {
    return getState('authorization.token').then(function(state) {
        var tokenObj = state.val;
        var validAccessToken = !isEmpty(loadOrDefault(tokenObj, 'accessToken', ''));
        var validRefreshToken = !isEmpty(loadOrDefault(tokenObj, 'refreshToken', ''));
        var validClientId = !isEmpty(loadOrDefault(tokenObj, 'clientId', '')) && tokenObj.clientId ==
            application.clientId;
        var validClientSecret = !isEmpty(loadOrDefault(tokenObj, 'clientSecret', '')) && tokenObj.clientSecret ==
            application.clientSecret;
        if (validAccessToken && validRefreshToken && validClientId && validClientSecret) {
            adapter.log.debug('spotify token readed');
            return tokenObj;
        } else {
            return Promise.reject('invalid or no spotify token');
        }
    });
}

function sendRequest(endpoint, method, sendBody) {
    var options = {
        url: application.baseUrl + endpoint,
        method: method,
        headers: {
            Authorization: 'Bearer ' + application.token
        },
        form: sendBody
    };
    adapter.log.debug('spotify api call...' + endpoint + '; ' + options.form);
    var callStack = new Error().stack;
    return request(options)
        .then(function(response) {
            var body = response.body;
            var ret;
            var parsedBody;
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
                        ret = setState('authorization.authorized', false, true)
                            .then(function() {
                                return refreshToken().then(function() {
                                    return setState('authorization.authorized', true, true).then(
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
                        ret = setState('authorization.authorized', false, true)
                            .then(function() {
                                adapter.log.error(parsedBody.error.message);
                                return Promise.reject(response.statusCode);
                            });
                    }
                    break;
                case 429:
                    // Too Many Requests
                    var wait = 1;
                    if (response.headers.hasOwnProperty('retry-after') && response.headers['retry-after'] >
                        0) {
                        wait = response.headers['retry-after'];
                        adapter.log.warn('too many requests, wait ' + wait + 's');
                    }
                    ret = new Promise(function(resolve) {
                        setTimeout(resolve, wait * 1000)
                    }).then(function() {
                        return sendRequest(endpoint, method, sendBody);
                    });
                    break;
                default:
                    adapter.log.warn('http request error not handled, please debug');
                    adapter.log.warn(callStack);
                    adapter.log.warn(new Error().stack);
                    ret = Promise.reject(response.statusCode);
            }
            return ret;
        }).catch(function(err) {
            adapter.log.error('erron in request: ' + err);
            return 0;
        });
}

function loadOrDefault(obj, name, defaultVal) {
    var t = undefined;
    try {
        eval('t = obj.' + name + ';');
    } catch (e) {}
    if (t === undefined) {
        t = defaultVal;
    }
    return t;
}

function createOrDefault(obj, name, state, defaultVal, description, type, states) {
    var t = loadOrDefault(obj, name, defaultVal);
    var object = {
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
    return setObjectNotExists(state, object).then(function() {
        return setState(state, t, true);
    });
}

function setOrDefault(obj, name, state, defaultVal) {
    var t = loadOrDefault(obj, name, defaultVal);
    return setState(state, t, true);
}

function shrinkStateName(v) {
	return v.replace(/\s+/g, '').replace(/\.+/g, '');
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        adapter.log.warn('no playback content');
        return Promise.reject('no playback content');
    }
    var deviceId = loadOrDefault(data, 'device.id', '');
    var isDeviceActive = loadOrDefault(data, 'device.is_active', false);
    var isDeviceRestricted = loadOrDefault(data, 'device.is_restricted', false);
    var deviceName = loadOrDefault(data, 'device.name', '');
    var deviceType = loadOrDefault(data, 'device.type', 'Speaker');
    var deviceVolume = loadOrDefault(data, 'device.volume_percent', 100);
    var isPlaying = loadOrDefault(data, 'is_playing', false);
    var duration = loadOrDefault(data, 'item.duration_ms', 0);
    var type = loadOrDefault(data, 'context.type', '');
    if (!type) {
        type = loadOrDefault(data, 'item.type', '');
    }
    var progress = loadOrDefault(data, 'progress_ms', 0);
    Promise.all([
        setState('playbackInfo.device.id', deviceId, true),
        setState('playbackInfo.device.isActive', isDeviceActive, true),
        setState('playbackInfo.device.isRestricted', isDeviceRestricted, true),
        setState('playbackInfo.device.name', deviceName, true),
        setState('playbackInfo.device.type', deviceType, true),
        setState('playbackInfo.device.volume', deviceVolume, true),
        setState('playbackInfo.device.isAvailable', true, true),
        setObject('playbackInfo.device', {
            type: 'device',
            common: {
                name: deviceName,
                icon: getIconByType(deviceType)
            },
            native: {}
        }),
        setState('playbackInfo.isPlaying', isPlaying, true),
        setOrDefault(data, 'item.id', 'playbackInfo.trackId', ''),
        setOrDefault(data, 'item.artists[0].name', 'playbackInfo.artist', ''),
        setOrDefault(data, 'item.album.name', 'playbackInfo.album', ''),
        setOrDefault(data, 'item.album.images[0].url', 'playbackInfo.albumImageUrl', ''),
        setOrDefault(data, 'item.name', 'playbackInfo.trackName', ''),
        setState('playbackInfo.durationMs', duration, true),
        setState('playbackInfo.duration', convertToDigiClock(duration), true),
        setState('playbackInfo.type', type, true),
        setOrDefault(data, 'timestamp', 'playbackInfo.timestamp', 0),
        setState('playbackInfo.progressMs', progress, true),
        setState('playbackInfo.progress', convertToDigiClock(progress), true),
        setOrDefault(data, 'shuffle_state', 'playbackInfo.shuffle', false),
        setOrDefault(data, 'repeat_state', 'playbackInfo.repeat', 'off'),
        // refresh Player states too
        setOrDefault(data, 'shuffle_state', 'player.shuffle', false),
        setOrDefault(data, 'repeat_state', 'player.repeat', 'off'),
        setOrDefault(data, 'item.id', 'player.trackId', ''),
        setOrDefault(data, 'device.volume_percent', 'player.volume', 100),
        setState('player.progressMs', progress, true)
    ]).then(function() {
        if (deviceId) {
            deviceData.lastActiveDeviceId = deviceId;
            return getStates('devices.*.isActive').then(function(state) {
                var keys = Object.keys(state);
                var fn = function(key) {
                    key = removeNameSpace(key);
                    if (key !== 'devices.' + shrinkStateName(deviceName) + '.isActive' &&
                        key.endsWith('.isActive')) {
                        return setState(key, false, true);
                    }
                };
                return Promise.all(keys.map(fn));
            }).then(function() {
                return createDevices({
                    devices: [{
                        id: deviceId,
                        is_active: isDeviceActive,
                        is_restricted: isDeviceRestricted,
                        name: deviceName,
                        type: deviceType,
                        volume_percent: deviceVolume
                    }]
                });
            });
        } else {
            return getStates('devices.*.isActive').then(function(state) {
                var keys = Object.keys(state);
                var fn = function(key) {
                    key = removeNameSpace(key);
                    if (key.endsWith('.isActive')) {
                        return setState(key, false, true);
                    }
                };
                return Promise.all(keys.map(fn));
            });
        }
    }).then(function() {
        if (progress && isPlaying && application.statusPollingDelaySeconds > 0) {
            scheduleStatusInternalTimer(duration, progress, Date.now(), application.statusPollingDelaySeconds -
                1);
        }
    }).then(function() {
        var uri = loadOrDefault(data, 'context.uri', '');
        if (type == 'playlist' && uri) {
            var indexOfUser = uri.indexOf('user:') + 5;
            var endIndexOfUser = uri.indexOf(':', indexOfUser);
            var indexOfPlaylistId = uri.indexOf('playlist:') + 9;
            var playlistId = uri.slice(indexOfPlaylistId);
            var query = {
                fields: 'name,id,owner.id,tracks.total,images',
            };
            return Promise.all([
                setState('player.playlist.id', playlistId, true),
                setState('playbackInfo.playlist.id', playlistId, true),
                sendRequest('/v1/users/' +
                    uri.substring(indexOfUser, endIndexOfUser) + '/playlists/' + playlistId +
                    '?' + querystring.stringify(query),
                    'GET', '').then(
                    function(parseJson) {
                        var playListName = loadOrDefault(parseJson, 'name', '');
                        var songId = loadOrDefault(data, 'item.id', '');
                        var p = Promise.all([
                            setOrDefault(parseJson, 'owner.id',
                                'playbackInfo.playlist.owner', ''),
                            setOrDefault(parseJson, 'owner.id',
                                'player.playlist.owner', ''),
                            setOrDefault(parseJson, 'tracks.total',
                                'playbackInfo.playlist.tracksTotal', ''),
                            setOrDefault(parseJson, 'images[0].url',
                                'playbackInfo.playlist.imageUrl', ''),
                        ]);
                        if (playListName) {
                            p.then(function() {
                                var shrinkPlaylistName = shrinkStateName(playListName);
                                return Promise.all([
                                    setState('playbackInfo.playlist.name',
                                        playListName, true),
                                    setObject('playbackInfo.playlist', {
                                        type: 'channel',
                                        common: {
                                            name: playListName
                                        },
                                        native: {}
                                    }),
                                    setObject('player.playlist', {
                                        type: 'channel',
                                        common: {
                                            name: playListName
                                        },
                                        native: {}
                                    }),
                                    getState('playlists.' +
                                        shrinkPlaylistName + '.trackListIds')
                                    .catch(
                                        function() {
                                            return persistPlaylist({
                                                items: [parseJson]
                                            });
                                        }).then(function(state) {
                                        var ids = loadOrDefault(state,
                                            'val', '');
                                        if (isEmpty(ids)) {
                                            return Promise.reject(
                                                'no ids in trackListIds'
                                            );
                                        }
                                        var stateName = ids.split(';');
                                        var stateArr = [];
                                        for (var i = 0; i < stateName.length; i++) {
                                            var ele = stateName[i].split(
                                                ':');
                                            stateArr[ele[1]] = ele[0];
                                        }
                                        if (stateArr[songId] !== '' && (
                                                stateArr[songId] !== null
                                            )) {
                                            return Promise.all([
                                                setState(
                                                    'playlists.' +
                                                    shrinkPlaylistName +
                                                    '.trackList',
                                                    stateArr[
                                                        songId],
                                                    true),
                                                setState(
                                                    'playbackInfo.playlist.trackList',
                                                    stateArr[
                                                        songId],
                                                    true),
                                                setState(
                                                    'playbackInfo.playlist.trackNo',
                                                    stateArr[
                                                        songId],
                                                    true),
                                                setState(
                                                    'player.playlist.trackNo',
                                                    stateArr[
                                                        songId],
                                                    true)
                                            ]);
                                        }
                                    })
                                ]);
                            })
                        }
                        return p;
                    })
            ]);
        } else {
            adapter.log.debug('context type: ' + type);
            return Promise.all([
                setState('playbackInfo.playlist.id', '', true),
                setState('playbackInfo.playlist.name', '', true),
                setState('playbackInfo.playlist.owner', '', true),
                setState('playbackInfo.playlist.tracksTotal', '', true),
                setState('playbackInfo.playlist.imageUrl', '', true),
                setState('playbackInfo.playlist.trackList', '', true),
                setState('playbackInfo.playlist.trackListNumber', '', true),
                setState('playbackInfo.playlist.trackListString', '', true),
                setState('playbackInfo.playlist.trackListStates', '', true),
                setState('playbackInfo.playlist.trackListIdMap', '', true),
                setState('playbackInfo.playlist.trackListIds', '', true),
                setState('playbackInfo.playlist.trackListArray', '', true),
                setState('playbackInfo.playlist.trackNo', '', true),
                setState('player.playlist.id', '', true),
                setState('player.playlist.owner', '', true),
                setState('player.playlist.trackNo', '', true)
            ]);
        }
    });
}

function convertToDigiClock(ms) {
    // milliseconds to digital time, e.g. 3:59=238759
    if (!ms) {
        ms = 0;
    }
    var min = Math.floor(ms / 60000);
    var sec = Math.floor(((ms % 360000) % 60000) / 1000);
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
    return setState('authorization.userId', data.id, true);
}

function reloadUsersPlaylist() {
    if (application.deletePlaylists) {
        return deleteUsersPlaylist().then(function() {
            return getUsersPlaylist(0);
        });
    } else {
        return getUsersPlaylist(0);
    }
}

function deleteUsersPlaylist() {
    return getStates('playlists.*').then(function(state) {
        var keys = Object.keys(state);
        var fn = function(key) {
            key = removeNameSpace(key);
            return delObject(key);
        };
        return Promise.all(keys.map(fn));
    });
}

function persistPlaylist(parseJson, autoContinue) {
    if (isEmpty(parseJson) || isEmpty(parseJson.items)) {
        adapter.log.warn('no playlist content');
        return Promise.reject('no playlist content');
    }
    var fn = function(item) {
        var playlistName = loadOrDefault(item, 'name', '');
        if (isEmpty(playlistName)) {
            adapter.log.warn('empty playlist name');
            return Promise.reject('empty playlist name');
        }
        var prefix = 'playlists.' + shrinkStateName(playlistName);
        return Promise.all([
            setObjectNotExists(prefix + '.playThisList', {
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
            setState(prefix + '.playThisList', false, true),
            createOrDefault(item, 'id', prefix + '.id', '', 'playlist id', 'string'),
            createOrDefault(item, 'owner.id', prefix + '.owner', '', 'playlist owner', 'string'),
            createOrDefault(item, 'name', prefix + '.name', '', 'playlist name', 'string'),
            createOrDefault(item, 'tracks.total', prefix + '.tracksTotal', '', 'number of songs',
                'number'),
            createOrDefault(item, 'images[0].url', prefix + '.imageUrl', '', 'image url',
                'string')
        ]).then(function() {
            return getPlaylistTracks(item.owner.id, item.id, prefix, 0).then(function(
                playListObject) {
                return Promise.all([
                    setObject(prefix + '.trackList', {
                        type: 'state',
                        common: {
                            name: 'Tracks of the playlist saved in common part. Change this value to a track position number to start this playlist with this track.',
                            type: 'number',
                            role: 'value',
                            states: playListObject.stateString,
                            read: true,
                            write: true
                        },
                        native: {}
                    }).then(function() {
                        return setState(prefix + '.trackList', '', true);
                    }),
                    createOrDefault(playListObject, 'listNumber', prefix +
                        '.trackListNumber', '',
                        'contains list of tracks as string, patter: 0;1;2;...',
                        'string'),
                    createOrDefault(playListObject, 'listString', prefix +
                        '.trackListString', '',
                        'contains list of tracks as string, patter: title - artist;title - artist;title - artist;...',
                        'string'),
                    createOrDefault(playListObject, 'stateString', prefix +
                        '.trackListStates', '',
                        'contains list of tracks as string with position, pattern: 0:title - artist;1:title - artist;2:title - artist;...',
                        'string'),
                    createOrDefault(playListObject, 'trackIdMap', prefix +
                        '.trackListIdMap', '',
                        'contains list of track ids as string with position, pattern: 0:id;1:id;2:id;...',
                        'string'),
                    createOrDefault(playListObject, 'trackIds', prefix +
                        '.trackListIds', '',
                        'contains list of track ids as string, pattern: id;id;id;...',
                        'string'),
                    createOrDefault(playListObject, 'songs', prefix +
                        '.trackListArray', '',
                        'contains list of tracks as array object, pattern: [{id: "id", title: "title", artist: "artist"}, {id: "id", title: "title", artist: "artist"},...]',
                        'object')
                ]).then(function() {
                    return getState('playbackInfo.playlist.id').then(function(
                        state) {
                        if (state.val == item.id) {
                            return Promise.all([
                                setObject(
                                    'playbackInfo.playlist.trackList', {
                                        type: 'state',
                                        common: {
                                            name: 'Tracks of the playlist saved in common part. Change this value to a track position number to start this playlist with this track.',
                                            type: 'number',
                                            role: 'value',
                                            states: playListObject
                                                .stateString,
                                            read: true,
                                            write: true
                                        },
                                        native: {}
                                    }).then(function() {
                                    return setState(
                                        'playbackInfo.playlist.trackList',
                                        '', true);
                                }),
                                setState(
                                    'playbackInfo.playlist.trackListNumber',
                                    playListObject.listNumber,
                                    true),
                                setState(
                                    'playbackInfo.playlist.trackListString',
                                    playListObject.listString,
                                    true),
                                setState(
                                    'playbackInfo.playlist.trackListStates',
                                    playListObject.stateString,
                                    true),
                                setState(
                                    'playbackInfo.playlist.trackListIdMap',
                                    playListObject.trackIdMap,
                                    true),
                                setState(
                                    'playbackInfo.playlist.trackListIds',
                                    playListObject.trackIds, true
                                ),
                                setState(
                                    'playbackInfo.playlist.trackListArray',
                                    playListObject.songs, true)
                            ]);
                        } else {
                            return Promise.resolve();
                        }
                    });
                });
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
        var query = {
            limit: 30,
            offset: offset
        };
        return sendRequest('/v1/users/' + application.userId + '/playlists?' +
            querystring.stringify(query), 'GET', '').then(
            function(parsedJson) {
                persistPlaylist(parsedJson, true);
            }).catch(function(err) {
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
    var old;
    do {
        old = str;
        str = str.replace('  ', ' ');
    }
    while (old != str);
    return str.trim();
}

function getPlaylistTracks(owner, id, prefix, offset, playListObject) {
    playListObject = playListObject && playListObject !== undefined ? playListObject : {
        stateString: '',
        listString: '',
        listNumber: '',
        trackIdMap: '',
        trackIds: '',
        songs: []
    };
    var regParam = owner + '/playlists/' + id + '/tracks';
    var query = {
        fields: 'items.track.name,items.track.id,items.track.artists.name,total,offset',
        limit: 100,
        offset: offset
    };
    return sendRequest('/v1/users/' + regParam + '?' + querystring.stringify(query), 'GET', '').then(
        function(data) {
            var i = offset;
            data.items.forEach(function(item) {
                var no = i.toString();
                if (playListObject.songs.length > 0) {
                    playListObject.stateString += ';';
                    playListObject.listString += ';';
                    playListObject.trackIdMap += ';';
                    playListObject.trackIds += ';';
                    playListObject.listNumber += ';';
                }
                playListObject.stateString += no + ':' + cleanState(item.track.name) + ' - ' +
                    cleanState(item.track.artists[0].name);
                playListObject.listString += cleanState(item.track.name) + ' - ' + cleanState(
                    item.track.artists[0].name);
                playListObject.trackIdMap += cleanState(item.track.id);
                playListObject.trackIds += no + ':' + cleanState(item.track.id);
                playListObject.listNumber += no;
                var a = {
                    id: item.track.id,
                    title: item.track.name,
                    artist: item.track.artists[0].name
                };
                playListObject.songs.push(a);
                i++;
            });
            if (offset + 100 < data.total) {
                return getPlaylistTracks(owner, id, prefix, offset + 100, playListObject);
            } else {
                return Promise.resolve(playListObject);
            }
        }).catch(function(err) {
        adapter.log.warn('error on load tracks: ' + err);
    });
}

function removeNameSpace(id) {
    var re = new RegExp(adapter.namespace + '*\.', 'g');
    return id.replace(re, '');
}

function reloadDevices(data) {
    if (application.deleteDevices) {
        return deleteDevices().then(function() {
            return createDevices(data);
        });
    } else {
        return disableDevices().then(function() {
            return createDevices(data);
        });
    }
}

function disableDevices() {
    return getStates('devices.*').then(function(state) {
        var keys = Object.keys(state);
        var fn = function(key) {
            key = removeNameSpace(key);
            if (key.endsWith('.isAvailable')) {
                return setState(key, false, true);
            }
        };
        return Promise.all(keys.map(fn));
    });
}

function deleteDevices() {
    return getStates('devices.*').then(function(state) {
        var keys = Object.keys(state);
        var fn = function(key) {
            key = removeNameSpace(key);
            return delObject(key);
        };
        return Promise.all(keys.map(fn));
    });
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
        adapter.log.warn('no device content')
        return Promise.reject('no device content');
    }
    var fn = function(device) {
        var deviceName = loadOrDefault(device, 'name', '');
        if (isEmpty(deviceName)) {
            adapter.log.warn('empty device name')
            return Promise.reject('empty device name');
        }
        var prefix = 'devices.' + shrinkStateName(deviceName);
        return Promise.all([
            setObjectNotExists(prefix, {
                type: 'device',
                common: {
                    name: deviceName,
                    icon: getIconByType(loadOrDefault(device, 'type', 'Computer'))
                },
                native: {}
            }),
            createOrDefault(device, 'id', prefix + '.id', '', 'device id', 'string'),
            createOrDefault(device, 'is_active', prefix + '.isActive', false,
                'current active device', 'boolean'),
            createOrDefault(device, 'is_restricted', prefix + '.isRestricted', false,
                'restricted', 'boolean'),
            createOrDefault(device, 'name', prefix + '.name', '', 'device name', 'string'),
            createOrDefault(device, 'type', prefix + '.type', 'Speaker', 'device type', 'string',
                "{\"Computer\": \"Computer\",\"Smartphone\": \"Smartphone\",\"Speaker\": \"Speaker\"}"
            ),
            createOrDefault(device, 'volume_percent', prefix + '.volume', '', 'volume in percent',
                'number'),
            setObjectNotExists(prefix + '.useForPlayback', {
                type: 'state',
                common: {
                    name: 'press to use device for playback',
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                    icon: 'icons/play.png'
                },
                native: {}
            }),
            setObjectNotExists(prefix + '.isAvailable', {
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
            setState(prefix + '.useForPlayback', false, true),
            setState(prefix + '.isAvailable', true, true)
        ]);
    };
    return Promise.all(data.devices.map(fn));
}

function generateRandomString(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getToken() {
    var options = {
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
            var body = response.body;
            saveToken(JSON.parse(body)).then(function(tokenObj) {
                return Promise.all([
                    setState('authorization.authorizationUrl', '', true),
                    setState('authorization.authorizationReturnUri', '', true),
                    setState('authorization.authorized', true, true)
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
    var options = {
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
                    var body = response.body;
                    adapter.log.debug('new token arrived');
                    adapter.log.debug(body);
                    var parsedJson = JSON.parse(body);
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
        var token = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            clientId: application.clientId,
            clientSecret: application.clientSecret
        };
        return setState('authorization.token', token, true).then(function() {
            return token;
        });
    } else {
        adapter.log.error(JSON.stringify(data));
        return Promise.reject('no tokens found in server response');
    }
}

function on(str, obj, triggeredByOtherService) {
    if (isEmpty(triggeredByOtherService)) {
        triggeredByOtherService = false;
    }
    var a = {
        name: str,
        func: obj,
        ackIsFalse: triggeredByOtherService
    };
    listener.push(a);
}

function increaseTime(duration_ms, progress_ms, startDate, count) {
    var now = Date.now();
    count--;
    progress_ms += now - startDate;
    return Promise.all([
        setState('playbackInfo.progressMs', progress_ms),
        setState('playbackInfo.progress', convertToDigiClock(progress_ms)),
        setState('player.progressMs', progress_ms, true)
    ]).then(function() {
        if (count > 0) {
            if (progress_ms + 1000 > duration_ms) {
                setTimeout(pollStatusApi, 1000);
            } else {
                scheduleStatusInternalTimer(duration_ms, progress_ms, now, count);
            }
        }
    })
}

function scheduleStatusInternalTimer(duration_ms, progress_ms, startDate, count) {
    clearTimeout(application.statusInternalTimer);
    application.statusInternalTimer = setTimeout(increaseTime, 1000, duration_ms, progress_ms, startDate,
        count);
}

function scheduleStatusPolling() {
    clearTimeout(application.statusPollingHandle);
    if (application.statusPollingDelaySeconds > 0) {
        application.statusPollingHandle = setTimeout(pollStatusApi, application.statusPollingDelaySeconds *
            1000);
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
            var dummyBody = {
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

function startPlaylist(playlist, owner, trackNo) {
    if (isEmpty(owner)) {
        owner = application.userId;
    }
    if (isEmpty(trackNo)) {
        return Promise.reject('no track no');
    }
    if (isEmpty(playlist)) {
        return Promise.reject('no playlist no');
    }
    var send = {
        context_uri: 'spotify:user:' + owner + ':playlist:' + playlist,
        offset: {
            position: trackNo
        }
    };
    return sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send)).then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not start playlist ' + playlist + ' of user ' + owner + '; error: ' +
            err);
    });
}

function listenOnAuthorizationReturnUri(obj) {
    return getState('authorization.state').then(function(state) {
        var returnUri = querystring.parse(obj.state.val.slice(obj.state.val
            .search('[?]') + 1, obj.state.val.length));
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
            return setState('Authorization.Authorization_Return_URI',
                'invalid session. You need to open the actual Authorization.Authorization_URL again',
                true);
        }
    });
}

function listenOnGetAuthorization() {
    adapter.log.debug('requestAuthorization');
    var state = generateRandomString(20);
    var query = {
        client_id: application.clientId,
        response_type: 'code',
        redirect_uri: application.redirect_uri,
        state: state,
        scope: 'user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-read-private'
    };
    var options = {
        url: 'https://accounts.spotify.com/de/authorize/?' +
            querystring.stringify(query),
        method: 'GET',
        followAllRedirects: true,
    };
    return Promise.all([
        setState('authorization.state', state, true),
        setState('authorization.authorizationUrl', options.url, true),
        setState('authorization.authorized', false, true)
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
    return getState(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id').then(function(state) {
        deviceData.lastSelectDeviceId = state.val;
        var send = {
            device_ids: [deviceData.lastSelectDeviceId],
        };
        return sendRequest('/v1/me/player', 'PUT', JSON.stringify(send)).then(function() {
            return pollStatusApi(true);
        }).catch(function(err) {
            adapter.log.error('could not execute command: ' + err);
        });
    });
}

function listenOnTrackList(obj) {
    if (obj.state.val >= 0) {
        listenOnPlayThisList(obj, obj.state.val);
    }
}

function listenOnPlayThisList(obj, pos) {
    if (isEmpty(pos)) {
        pos = 1;
    }
    // Play a specific playlist immediately
    return getState(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.owner').then(function(state) {
        var owner = state;
        return getState(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id')
            .then(function(state) {
                var id = state;
                var send = {
                    context_uri: 'spotify:user:' + owner.val + ':playlist:' + id.val,
                    offset: {
                        position: pos
                    }
                };
                var query = {
                    device_id: getSelectedDevice(deviceData)
                };
                return sendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT',
                        JSON.stringify(send))
                    .then(function() {
                        return pollStatusApi(true);
                    }).catch(function(err) {
                        adapter.log.error('could not execute command: ' + err);
                    });
            });
    });
}

function listenOnPlay() {
    var query = {
        device_id: getSelectedDevice(deviceData)
    };
    adapter.log.debug(getSelectedDevice(deviceData))
    sendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnPause() {
    var query = {
        device_id: getSelectedDevice(deviceData)
    };
    sendRequest('/v1/me/player/pause?' + querystring.stringify(query), 'PUT', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnSkipPlus() {
    var query = {
        device_id: getSelectedDevice(deviceData)
    };
    sendRequest('/v1/me/player/next?' + querystring.stringify(query), 'POST', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnSkipMinus() {
    var query = {
        device_id: getSelectedDevice(deviceData)
    };
    sendRequest('/v1/me/player/previous?' + querystring.stringify(query), 'POST', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnRepeat(obj) {
    if (['track', 'context', 'off'].indexOf(obj.state.val) >= 0) {
        sendRequest('/v1/me/player/repeat?state=' + obj.state.val, 'PUT', '').then(function() {
            return pollStatusApi(true);
        }).catch(function(err) {
            adapter.log.error('could not execute command: ' + err);
        });
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
    sendRequest('/v1/me/player/volume?volume_percent=' + obj.state.val, 'PUT', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnProgressMs(obj) {
    sendRequest('/v1/me/player/seek?position_ms=' + obj.state.val,
        'PUT', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnShuffle(obj) {
    sendRequest('/v1/me/player/shuffle?state=' + (obj.state.val === true ? 'true' : 'false'),
        'PUT', '').then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnShuffleOff() {
    listenOnShuffle({
        state: {
            val: false
        }
    });
}

function listenOnShuffleOn() {
    listenOnShuffle({
        state: {
            val: true
        }
    });
}

function listenOnTrackId(obj) {
    var send = {
        uris: ['spotify:track:' + obj.state.val],
        offset: {
            position: 0
        }
    };
    sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send)).then(function() {
        return pollStatusApi(true);
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    });
}

function listenOnPlaylistId(obj) {
    return getState('player.playlist.owner').then(function(state) {
        return startPlaylist(obj.state.val, state.val, 1);
    });
}

function listenOnPlaylistOwner(obj) {
    return getState('player.playlist.id').then(function(state) {
        return startPlaylist(state.val, obj.state.val, 1);
    });
}

function listenOnPlaylistTrackNo(obj) {
    getState('player.playlist.owner').then(function(state) {
        var owner = state.val;
        return getState('player.playlist.id').then(function(state) {
            return startPlaylist(state.val, owner, obj.state.val);
        });
    });
}

function listenOnGetPlaybackInfo() {
    return pollStatusApi(true);
}

function listenOnGetDevices() {
    return sendRequest('/v1/me/player/devices', 'GET', '').then(function(data) {
        return reloadDevices(data);
    });
}
on('authorization.authorizationReturnUri', listenOnAuthorizationReturnUri, true);
on('authorization.getAuthorization', listenOnGetAuthorization);
on('authorization.authorized', listenOnAuthorized);
on(/\.useForPlayback$/, listenOnUseForPlayback);
on(/\.trackList$/, listenOnTrackList, true);
on(/\.playThisList$/, listenOnPlayThisList);
on('player.play', listenOnPlay);
on('player.pause', listenOnPause);
on('player.skipPlus', listenOnSkipPlus);
on('player.skipMinus', listenOnSkipMinus);
on('player.repeat', listenOnRepeat, true);
on('player.repeatTrack', listenOnRepeatTrack);
on('player.repeatContext', listenOnRepeatContext);
on('player.repeatOff', listenOnRepeatOff);
on('player.volume', listenOnVolume, true);
on('player.progressMs', listenOnProgressMs, true);
on('player.shuffle', listenOnShuffle, true);
on('player.shuffleOff', listenOnShuffleOff);
on('player.shuffleOn', listenOnShuffleOn);
on('player.trackId', listenOnTrackId, true);
on('player.playlist.id', listenOnPlaylistId, true);
on('player.playlist.owner', listenOnPlaylistOwner, true);
on('player.playlist.trackNo', listenOnPlaylistTrackNo, true);
on('getPlaylists', reloadUsersPlaylist);
on('getPlaybackInfo', listenOnGetPlaybackInfo);
on('getDevices', listenOnGetDevices);
adapter.on('ready', function() {
    main();
});
adapter.on('stateChange', function(id, state) {
    if (state == null || (!state.val && typeof state.val != 'number')) {
        return;
    }
    var shrikId = removeNameSpace(id);
    listener.forEach(function(value) {
        if (value.ackIsFalse && state.ack) {
            return;
        }
        if ((value.name instanceof RegExp && value.name.test(shrikId)) || value.name ==
            shrikId) {
            value.func({
                id: shrikId,
                state: state
            });
        }
    });
});
adapter.on('unload', function(callback) {
    Promise.all([
        setState('authorization.authorizationUrl', '', true),
        setState('authorization.authorizationReturnUri', '', true),
        setState('authorization.userId', '', true),
        setState('player.trackId', '', true),
        setState('player.playlist.id', '', true),
        setState('player.playlist.trackNo', '', true),
        setState('player.playlist.owner', '', true),
        setState('authorization.authorized', false, true)
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
    }).nodeify(callback);
});