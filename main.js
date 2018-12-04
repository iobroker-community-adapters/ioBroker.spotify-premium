/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
'use strict';
var utils = require(__dirname + '/lib/utils');
var querystring = require('querystring');
var Promise = require('promise');
var adapter = new utils.Adapter('spotify-premium');
var request = Promise.denodeify(require('request'));
var artistImageUrlCache = {};
var playlistCache = {};

let cache = {values: {children: [], nodes: {}}};

cache.init = function () {
	return getStates('*').then(function(states) {
		let keys = Object.keys(states);
		for(let i = 0; i < keys.length; i++) {
			let longKey = keys[i];
			let key = removeNameSpace(longKey);

			let parts = key.split(".");
			let path = cache.values;

			for(let j = 0; j < parts.length; j++) {
				let partName = parts[j];
				let currentPath = path.nodes[partName];
				if(currentPath === undefined) {
					path.nodes[partName] = {children: [], nodes: {}, name: partName};
					path.children.push(path.nodes[partName]);
				}
				path = path.nodes[partName];
			}
			if (states[longKey] != null) {
				path.state = {};
				if(states[longKey]['val'] !== undefined) {
					path.state.val = states[longKey]['val'];
				}
				if(states[longKey]['ack'] !== undefined) {
					path.state.ack = states[longKey]['ack'];
				}
			} else {
				path.state = null;
			}
		}
	});	
}

cache.get = function (name) {
	let parts = name.split(".");
	let path = cache.values;

	for(let i = 0; i < parts.length; i++) {
		let partName = parts[i];
		let currentPath = path.nodes[partName];
		if(currentPath === undefined) {
			path.nodes[partName] = {children: [], nodes: {}};
			path.children.push(path.nodes[partName]);
		}
		path = path.nodes[partName];
	}

	let stateChanged = false;
	if(path.state === undefined) {
		Promise.reject('not existing state ' + name);
	}

	return Promise.resolve(path.state);
}

cache.set = function (name, state) {
	let parts = name.split(".");
	let path = cache.values;
	
	for(let i = 0; i < parts.length; i++) {
		let partName = parts[i];
		let currentPath = path.nodes[partName];
		if(currentPath === undefined) {
			path.nodes[partName] = {children: [], nodes: {}};
			path.children.push(path.nodes[partName]);
		}
		path = path.nodes[partName];
	}
	
	let stateChanged = false;
	if(path.state === undefined) {
		path.state = {
			val: null,
			ack: true
		};
		stateChanged = true;
	}

	if(state != null) {
		if(state['val'] != undefined && JSON.stringify(state['val']) !== JSON.stringify(path.state.val)) {
			path.state.val = state['val'];
			stateChanged = true;
		}
		if(state['ack'] !== undefined && state['ack'] !== path.state.ack) {
			path.state.ack = state['ack'];
			stateChanged = true;
		}
	}

	if(stateChanged) {
		adapter.log.debug('save state: ' + name + ' -> ' + JSON.stringify(path.state.val));
		return setState(name, path.state.val, path.state.ack);
	} else {
	    if (path.state == null || (!path.state.val && typeof path.state.val != 'number')) {
	        
	    } else {
		    listener.forEach(function(value) {
		        if (value.ackIsFalse && path.state.ack) {
		            return;
		        }
		        if ((value.name instanceof RegExp && value.name.test(name)) || value.name == name) {
		            value.func({
		                id: name,
		                state: path.state
		            });
		        }
		    });
	    }
	}

	return Promise.resolve(null, adapter.namespace + '.' + name);
};

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

function getObject(id, options) {
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
        adapter.getObject(id, options, retFunc);
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
    application.keepShuffleState = adapter.config.keep_shuffle_state;
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
    return cache.get('authorization.token').then(function(state) {
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
        return cache.set(state, {val: t, ack: true});
    });
}

function setOrDefault(obj, name, state, defaultVal) {
    var t = loadOrDefault(obj, name, defaultVal);
    return cache.set(state, {val: t, ack: true});
}

function shrinkStateName(v) {
    var n = v.replace(/[\s."`'*,\\?<>[\];:]+/g, '');
    if (isEmpty(n)) {
        n = 'onlySpecialCharacters';
    }
    return n;
}

function getArtistArrayOrDefault(data, name) {
    var ret = [];
    for (var i = 0; i < 100; i++) {
        var artistName = loadOrDefault(data, name + '[' + i + '].name', '');
        var artistId = loadOrDefault(data, name + '[' + i + '].id', '');
        if (!isEmpty(artistName) && !isEmpty(artistId)) {
            ret.push({id: artistId, name: artistName});
        } else {
            break;
        }
    }
    return ret;
}

function getArtistNamesOrDefault(data, name) {
    var ret = '';
    for (var i = 0; i < 100; i++) {
        var artist = loadOrDefault(data, name + '[' + i + '].name', '');
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
    return getObject(id).catch(function() {
        return {
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
    }).then(function(obj) {
        var o = obj;
        if (JSON.stringify(states) != JSON.stringify(o.common.states)) {
            return setObject(
                id, {
                    type: o.type,
                    common: {
                        name: o.common.name,
                        type: o.common.type,
                        role: o.common.role,
                        states: states,
                        read: o.common.read,
                        write: o.common.write
                    },
                    native: {}
                });
        }
    });
}

function copyState(src, dst) {
    return cache.get(src).then(function(state) {
        return cache.set(dst, {val: state.val});
    });
}

function copyObjectStates(src, dst) {
    return getObject(src).then(function(obj) {
        return setObjectStatesIfChanged(dst, obj.common.states);
    });
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        adapter.log.debug('no playback content');
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
    var progressPercentage = 0;
    if (duration > 0) {
        progressPercentage = Math.floor(progress / duration * 100);
    }
    var contextDescription;
    var contextImage;
    var album = loadOrDefault(data, 'item.album.name', '');
    var albumUrl = loadOrDefault(data, 'item.album.images[0].url', '');
    var artist = getArtistNamesOrDefault(data, 'item.artists');
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
    var shuffle = loadOrDefault(data, 'shuffle_state', false);
    Promise.all([
    	cache.set('player.device.id', {val: deviceId, ack: true}),
    	cache.set('player.device.isActive', {val: isDeviceActive, ack: true}),
    	cache.set('player.device.isRestricted', {val: isDeviceRestricted, ack: true}),
    	cache.set('player.device.name', {val: deviceName, ack: true}),
    	cache.set('player.device.type', {val: deviceType, ack: true}),
    	cache.set('player.device.volume', {val: deviceVolume, ack: true}),
    	cache.set('player.device.isAvailable', {val: true, ack: true}),
        setObject('player.device', {
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
        setOrDefault(data, 'device.volume_percent', 'player.volume', 100),
    ]).then(function() {
        if (deviceName) {
            deviceData.lastActiveDeviceId = deviceId;
            return getStates('devices.*').then(function(states) {
                var keys = Object.keys(states);
                var fn = function(key) {
                    if (!key.endsWith('.isActive')) {
                        return;
                    }
                    key = removeNameSpace(key);
                    var name = '';
                    if(deviceId != null) {
                    	name = shrinkStateName(deviceId);
                    } else {
                    	name = shrinkStateName(deviceName);
                    }
                    if (key !== 'devices.' + name + '.isActive') {
                        return cache.set(key, {val: false, ack: true});
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
            return getStates('devices.*').then(function(states) {
                var keys = Object.keys(states);
                var fn = function(key) {
                    if (!key.endsWith('.isActive')) {
                        return;
                    }
                    key = removeNameSpace(key);
                    return cache.set(key, {val: false, ack: true});
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
        var album = loadOrDefault(data, 'item.album.name', '');
        var artists = [];
        for (var i = 0; i < 100; i++) {
            var id = loadOrDefault(data, 'item.artists[' + i + '].id', '');
            if (isEmpty(id)) {
                break;
            } else {
                artists.push(id);
            }
        }
        var urls = [];
        var fn = function(artist) {
            if (artistImageUrlCache.hasOwnProperty(artist)) {
                urls.push(artistImageUrlCache[artist]);
            } else {
                return sendRequest('/v1/artists/' + artist,
                    'GET', '').then(
                    function(parseJson) {
                        var url = loadOrDefault(parseJson, 'images[0].url', '');
                        if (!isEmpty(url)) {
                            artistImageUrlCache[artist] = url;
                            urls.push(url);
                        }
                    });
            }
        };
        return Promise.all(artists.map(fn)).then(function() {
            var set = '';
            if (urls.length !== 0) {
                set = urls[0];
            }
            if (type == 'artist') {
                contextImage = set;
            }
            return cache.set('player.artistImageUrl', {val: set, ack: true});
        });
    }).then(function() {
        var uri = loadOrDefault(data, 'context.uri', '');
        if (type == 'playlist' && uri) {
            var indexOfUser = uri.indexOf('user:') + 5;
            var endIndexOfUser = uri.indexOf(':', indexOfUser);
            var indexOfPlaylistId = uri.indexOf('playlist:') + 9;
            var playlistId = uri.slice(indexOfPlaylistId);
            var userId = uri.substring(indexOfUser, endIndexOfUser);
            var query = {
                fields: 'name,id,owner.id,tracks.total,images',
            };
            return Promise.all([
            	cache.set('player.playlist.id', {val: playlistId, ack: true}),
            ]).then(function() {
                var refreshPlaylist = function(parseJson) {
                    var playlistName = loadOrDefault(parseJson, 'name', '');
                    contextDescription = 'Playlist: ' + playlistName;
                    var songId = loadOrDefault(data, 'item.id', '');
                    var playlistImage = loadOrDefault(parseJson, 'images[0].url', '');
                    contextImage = playlistImage;
                    var ownerId = loadOrDefault(parseJson, 'owner.id', '');
                    var trackCount = loadOrDefault(parseJson, 'tracks.total', '');
                    var prefix = shrinkStateName(ownerId + '-' + playlistId);
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
                    	cache.set('player.playlist.tracksTotal', {val: trackCount,
                            ack: true}),
                        cache.set('player.playlist.imageUrl', {val: playlistImage,
                            ack: true}),
                        cache.set('player.playlist.name', {val: playlistName, ack: true}),
                        setObject('player.playlist', {
                            type: 'channel',
                            common: {
                                name: playlistName
                            },
                            native: {}
                        })
                    ]).then(function() {
                        return cache.get('playlists.' + prefix + '.trackListIds').catch(
                            function() {
                                return createPlaylists({
                                    items: [
                                        parseJson
                                    ]
                                });
                            }).then(function() {
                            return refreshPlaylistList();
                        });
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
                        return cache.get('playlists.' +
                                prefix +
                                '.trackListIds')
                            .then(function(state) {
                                var ids = loadOrDefault(
                                    state, 'val', '');
                                if (isEmpty(ids)) {
                                    return Promise.reject(
                                        'no ids in trackListIds'
                                    );
                                }
                                var stateName = ids.split(
                                    ';');
                                var stateArr = [];
                                for (var i = 0; i <
                                    stateName.length; i++
                                ) {
                                    var ele = stateName[i]
                                        .split(':');
                                    stateArr[ele[1]] =
                                        ele[0];
                                }
                                if (stateArr[songId] !==
                                    '' && (stateArr[
                                            songId] !==
                                        null)) {
                                    return Promise.all([
                                    	cache.set(
                                            'playlists.' +
                                            prefix +
                                            '.trackList',
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
                    });
                }
                if (playlistCache.hasOwnProperty(userId + '-' + playlistId)) {
                    return Promise.resolve().then(refreshPlaylist(playlistCache[userId + '-' +
                        playlistId]));
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
                setObject('player.playlist', {
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
    return cache.set('authorization.userId', {val: data.id, ack: true});
}

function reloadUsersPlaylist() {
    var r;
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
    return getStates('playlists.*').then(function(states) {
        var keys = Object.keys(states);
        var fn = function(key) {
            key = removeNameSpace(key);
            if (key != 'playlists.playlistList' &&
                key != 'playlists.playlistListIds' &&
                key != 'playlists.playlistListString' &&
                key != 'playlists.yourPlaylistListIds' &&
                key != 'playlists.yourPlaylistListString') {
                return delObject(key).then(function() {
                    if (key.endsWith('.id')) {
                        return delObject(key.substring(0, key.length - 3));
                    }
                });
            } else {
                return Promise.resolve();
            }
        };
        return Promise.all(keys.map(fn));
    });
}

function createPlaylists(parseJson, autoContinue) {
    if (isEmpty(parseJson) || isEmpty(parseJson.items)) {
        adapter.log.debug('no playlist content');
        return Promise.reject('no playlist content');
    }
    var fn = function(item) {
        var playlistName = loadOrDefault(item, 'name', '');
        if (isEmpty(playlistName)) {
            adapter.log.warn('empty playlist name');
            return Promise.reject('empty playlist name');
        }
        var playlistId = loadOrDefault(item, 'id', '');
        var ownerId = loadOrDefault(item, 'owner.id', '');
        var trackCount = loadOrDefault(item, 'tracks.total', '');
        var imageUrl = loadOrDefault(item, 'images[0].url', '');
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
        var prefix = 'playlists.' + shrinkStateName(ownerId + '-' + playlistId);
        return Promise.all([
            setObject(prefix, {
                type: 'channel',
                common: {
                    name: playlistName
                },
                native: {}
            }),
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
            cache.set(prefix + '.playThisList', {val: false, ack: true}),
            createOrDefault(item, 'id', prefix + '.id', '', 'playlist id', 'string'),
            createOrDefault(item, 'owner.id', prefix + '.owner', '', 'playlist owner', 'string'),
            createOrDefault(item, 'name', prefix + '.name', '', 'playlist name', 'string'),
            createOrDefault(item, 'tracks.total', prefix + '.tracksTotal', '', 'number of songs',
                'number'),
            createOrDefault(item, 'images[0].url', prefix + '.imageUrl', '', 'image url',
                'string')
        ]).then(function() {
            return getPlaylistTracks(ownerId, playlistId, 0).then(function(
                playlistObject) {
                return Promise.all([
                    setObject(prefix + '.trackList', {
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
                    }).then(function() {
                        return cache.set(prefix + '.trackList', {val: '', ack: true});
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
        var query = {
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
    var old;
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
    var regParam = owner + '/playlists/' + id + '/tracks';
    var query = {
        fields: 'total,offset,items(added_at,added_by.id,track(name,id,artists(name,id),duration_ms,album(name,id),disc_number,episode,explicit,popularity))',
        limit: 100,
        offset: offset
    };
    return sendRequest('/v1/users/' + regParam + '?' + querystring.stringify(query), 'GET', '').then(
        function(data) {
            var i = offset;
            data.items.forEach(function(item) {
                var no = i.toString();
                var artist = getArtistNamesOrDefault(item, 'track.artists');
                var artistArray = getArtistArrayOrDefault(item, 'track.artists');
                var trackName = loadOrDefault(item, 'track.name', '');
                var trackDuration = loadOrDefault(item, 'track.duration_ms', '');
                var trackId = loadOrDefault(item, 'track.id', '');
                if (isEmpty(trackId)) {
                	adapter.log.debug(
                			'There was a playlist track ignored because of missing id; playlist: ' +
                			id + '; track name: ' + trackName);
                	return;
                }
                var addedAt = loadOrDefault(item, 'added_at', '');
                var addedBy = loadOrDefault(item, 'added_by.id', '');
                var trackAlbumId = loadOrDefault(item, 'track.album.id', '');
                var trackAlbumName = loadOrDefault(item, 'track.album.name', '');
                var trackDiscNumber = loadOrDefault(item, 'track.disc_number', 1);
                var trackEpisode = loadOrDefault(item, 'track.episode', false);
                var trackExplicit = loadOrDefault(item, 'track.explicit', false);
                var trackPopularity = loadOrDefault(item, 'track.popularity', 0);
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
                var a = {
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
    return getStates('devices.*').then(function(states) {
        var keys = Object.keys(states);
        var fn = function(key) {
            key = removeNameSpace(key);
            if (key.endsWith('.isAvailable')) {
                return cache.set(key, {val: false, ack: true});
            }
        };
        return Promise.all(keys.map(fn));
    });
}

function deleteDevices() {
    return getStates('devices.*').then(function(states) {
        var keys = Object.keys(states);
        var fn = function(key) {
            key = removeNameSpace(key);
            if (key != 'devices.deviceList' &&
                key != 'devices.deviceListIds' &&
                key != 'devices.deviceListString' &&
                key != 'devices.availableDeviceListIds' &&
                key != 'devices.availableDeviceListString') {
                return delObject(key).then(function() {
                    if (key.endsWith('.id')) {
                        return delObject(key.substring(0, key.length - 3));
                    }
                });
            }
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
        adapter.log.debug('no device content')
        return Promise.reject('no device content');
    }
    var fn = function(device) {
        var deviceId = loadOrDefault(device, 'id', '');
        var deviceName = loadOrDefault(device, 'name', '');
        if (isEmpty(deviceName)) {
        	adapter.log.warn('empty device name')
        	return Promise.reject('empty device name');
        }
        var name = '';
        if(deviceId != null) {
        	name = shrinkStateName(deviceId);
        } else {
        	name = shrinkStateName(deviceName);
        }
        var prefix = 'devices.' + name;
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
            cache.set(prefix + '.useForPlayback', {val: false, ack: true}),
            cache.set(prefix + '.isAvailable', {val: true, ack: true})
        ]);
    };
    return Promise.all(data.devices.map(fn)).then(function() {
        return refreshDeviceList();
    });
}

function refreshPlaylistList() {
    var a = [];
    return getStates('playlists.*').then(function(states) {
        var keys = Object.keys(states);
        var fn = function(key) {
            if (!key.endsWith('.name')) {
                return;
            }
            var normKey = removeNameSpace(key);
            var id = normKey.substring(10, normKey.length - 5);
            return cache.get('playlists.' + id + '.owner').then(function(state) {
                a.push({
                    id: id,
                    name: states[key].val,
                    your: application.userId == state.val
                });
            });
        };
        return Promise.all(keys.map(fn)).then(function() {
            var stateList = {};
            var listIds = '';
            var listString = '';
            var yourIds = '';
            var yourString = '';
            for (var i = 0, len = a.length; i < len; i++) {
                var normId = a[i].id;
                var normName = cleanState(a[i].name);
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
                return cache.get('player.playlist.id').then(function(state) {
                    var id = state.val;
                    if (id) {
                        return cache.get('player.playlist.owner').then(
                            function(state) {
                                var owner = state.val;
                                if (owner) {
                                    return cache.set(
                                        'playlists.playlistList',
                                        {val: owner + '-' + id});
                                }
                            });
                    }
                });
            });
        });
    });
}

function refreshDeviceList() {
    var a = [];
    return getStates('devices.*').then(function(states) {
        var keys = Object.keys(states);
        var fn = function(key) {
            if (!key.endsWith('.name')) {
                return;
            }
            var normKey = removeNameSpace(key);
            var id = normKey.substring(8, normKey.length - 5);
            return cache.get('devices.' + id + '.isAvailable').then(function(state) {
                a.push({
                    id: id,
                    name: states[key].val,
                    available: state.val
                });
            });
        };
        return Promise.all(keys.map(fn)).then(function() {
            var stateList = {};
            var listIds = '';
            var listString = '';
            var availableIds = '';
            var availableString = '';
            for (var i = 0, len = a.length; i < len; i++) {
                var normId = a[i].id;
                var normName = cleanState(a[i].name);
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
                cache.set('devices.availableDeviceListString',
                	{val: availableString})
            ]).then(function() {
                return getStates('devices.*').then(function(states) {
                    var keys = Object.keys(states);
                    var fn = function(key) {
                        if (!key.endsWith('.isActive')) {
                            return;
                        }
                        var val = states[key].val;
                        if (val) {
                            key = removeNameSpace(key);
                            var id = key.substring(8, key.length - 9);
                            return cache.set('devices.deviceList',
                            	{val: id});
                        }
                    };
                    return Promise.all(keys.map(fn))
                });
            });
        });
    });
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
            var parsedBody;
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
                    var parsedJson;
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
        var token = {
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
    	cache.set('player.progress', {val: convertToDigiClock(progress_ms), ack: true}),
    	cache.set('player.progressMs', {val: progress_ms, ack: true}),
    	cache.get('player.durationMs').then(function(state) {
            var val = state.val;
            if (val > 0) {
                var percentage = Math.floor(progress_ms / val * 100);
                return Promise.all([
                	cache.set('player.progressPercentage', {val: percentage, ack: true})
                ]);
            }
        })
    ]).then(function() {
    	adapter.log.info('reschedule ' + count + ' ' + (progress_ms + 1000) + ' > ' + duration_ms);
        if (count > 0) {
            if (progress_ms + 1000 > duration_ms) {
                setTimeout(pollStatusApi, 1000);
            } else {
            	cache.get('player.isPlaying').then(function(state) {
            		if(state.val) {
            			scheduleStatusInternalTimer(duration_ms, progress_ms, now, count);
            		}
            	});
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
    var resetShuffle = false;
    var r = Promise.resolve();
    if (application.keepShuffleState) {
        r = r.then(function() {
            return cache.get('player.shuffle').then(function(state) {
                if (state.val) {
                    resetShuffle = true;
                    if (!keepTrack) {
                        return cache.get('playlists.' + shrinkStateName(owner + '-' + playlist) +
                            '.tracksTotal').then(function(state) {
                            trackNo = Math.floor(Math.random() * Math.floor(state.val));
                        });
                    }
                }
            });
        });
    }
    return r.then(function() {
        var send = {
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
    return cache.get('authorization.state').then(function(state) {
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
            return cache.set('Authorization.Authorization_Return_URI',
            	{val: 'invalid session. You need to open the actual Authorization.Authorization_URL again',
                ack: true});
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
    return cache.get(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id').then(function(state) {
        deviceData.lastSelectDeviceId = state.val;
        var send = {
            device_ids: [deviceData.lastSelectDeviceId],
        };
        return sendRequest('/v1/me/player', 'PUT', JSON.stringify(send)).then(function() {
            setTimeout(pollStatusApi, 1000, true);
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
    var keepTrack = true;
    if (isEmpty(pos)) {
        keepTrack = false;
        pos = 0;
    }
    // Play a specific playlist immediately
    return cache.get(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.owner').then(function(state) {
        var owner = state;
        return cache.get(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id')
            .then(function(state) {
                return startPlaylist(state.val, owner.val, pos, keepTrack);
            });
    });
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
    var query = {
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
    var query = {
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
    var query = {
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
    var query = {
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
    var progress = obj.state.val;
    clearTimeout(application.statusInternalTimer);
    sendRequest('/v1/me/player/seek?position_ms=' + progress,
        'PUT', '').then(function() {
        return cache.get('player.durationMs').then(function(state) {
            var duration = state.val;
            if (duration > 0 && duration <= progress) {
                var progressPercentage = Math.floor(progress / duration * 100);
                return Promise.all([
                	cache.set('player.progressMs', {val: progress, ack: true}),
                	cache.set('player.progress', {val: convertToDigiClock(progress),
                        ack: true}),
                    cache.set('player.progressPercentage', {val: progressPercentage, ack: true})
                ]);
            }
        });
    }).catch(function(err) {
        adapter.log.error('could not execute command: ' + err);
    }).then(function() {
    	setTimeout(pollStatusApi, 1000);
    });
}

function listenOnProgressPercentage(obj) {
    var progressPercentage = obj.state.val;
    if (progressPercentage < 0 || progressPercentage > 100) {
        return;
    }
    clearTimeout(application.statusInternalTimer);
    cache.get('player.durationMs').then(function(state) {
        var duration = state.val;
        if (duration > 0) {
            var progress = Math.floor(progressPercentage / 100 * duration);
            sendRequest('/v1/me/player/seek?position_ms=' + progress,
                'PUT', '').then(function() {
                return Promise.all([
                	cache.set('player.progressMs', {val: progress, ack: true}),
                	cache.set('player.progress', {val: convertToDigiClock(progress),
                        ack: true}),
                    cache.set('player.progressPercentage', {val: progressPercentage,
                        ack: true})
                ]);
            }).catch(function(err) {
                adapter.log.error('could not execute command: ' + err);
            }).then(function () {
            	setTimeout(pollStatusApi, 1000);
            });
        }
    });
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
    var send = {
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
    return cache.get('player.playlist.owner').then(function(state) {
        return startPlaylist(obj.state.val, state.val, 0);
    });
}

function listenOnPlaylistOwner(obj) {
    return cache.get('player.playlist.id').then(function(state) {
        return startPlaylist(state.val, obj.state.val, 0);
    });
}

function listenOnPlaylistTrackNo(obj) {
	cache.get('player.playlist.owner').then(function(state) {
        var owner = state.val;
        return cache.get('player.playlist.id').then(function(state) {
            return startPlaylist(state.val, owner, obj.state.val, true);
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

function clearCache() {
    artistImageUrlCache = {};
    playlistCache = {};
    application.cacheClearHandle = setTimeout(clearCache, 1000 * 60 * 60 * 24);
}
on('authorization.authorizationReturnUri', listenOnAuthorizationReturnUri, true);
on('authorization.getAuthorization', listenOnGetAuthorization);
on('authorization.authorized', listenOnAuthorized);
on(/\.useForPlayback$/, listenOnUseForPlayback);
on(/\.trackList$/, listenOnTrackList, true);
on(/\.playThisList$/, listenOnPlayThisList);
on('devices.deviceList', listenOnDeviceList, true);
on('playlists.playlistList', listenOnPlaylistList, true);
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
on('player.progressPercentage', listenOnProgressPercentage, true);
on('player.shuffle', listenOnShuffle, 'on');
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
	cache.init().then(function() {		
		main();
	});
});
adapter.on('stateChange', function(id, state) {
    if (state == null || (!state.val && typeof state.val != 'number')) {
        return;
    }
    var shrikId = removeNameSpace(id);


	let parts = shrikId.split(".");
	let path = cache.values;
	
	for(let i = 0; i < parts.length; i++) {
		let partName = parts[i];
		let currentPath = path.nodes[partName];
		if(currentPath === undefined) {
			path.nodes[partName] = {children: [], nodes: {}};
			path.children.push(path.nodes[partName]);
		}
		path = path.nodes[partName];
	}
	
	if(path.state === undefined) {
		path.state = {
			val: null,
			ack: true
		};
	}

	if(state != null && path.state != null) {
		if(state['val'] != undefined &&state['val'] !== path.state.val) {
			path.state.val = state['val'];
		}
		if(state['ack'] !== undefined && state['ack'] !== path.state.ack) {
			path.state.ack = state['ack'];
		}
	}

    listener.forEach(function(value) {
        if (value.ackIsFalse && state.ack) {
            return;
        }
        if ((value.name instanceof RegExp && value.name.test(shrikId)) || value.name == shrikId) {
            value.func({
                id: shrikId,
                state: state
            });
        }
    });
});
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
