/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
'use strict';
var utils = require(__dirname + '/lib/utils');
var request = require('request');
var querystring = require('querystring');
var adapter = new utils.Adapter('spotify-premium');
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
    pollingHandle: null,
    internalTimer: null,
    pollingDelaySeconds: 5
};
var deviceData = {
    lastActiveDeviceId: '',
    lastSelectDeviceId: ''
};

function isEmpty(str) {
    return (!str || 0 === str.length);
}

function main() {
    application.clientId = adapter.config.client_id;
    application.clientSecret = adapter.config.client_secret;
    application.deleteDevices = adapter.config.delete_devices;
    application.deletePlaylists = adapter.config.delete_playlists;
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
    adapter.subscribeStates('*');
    start();
}

function start() {
    readTokenStates(function(err, tokenObj) {
        if (!err) {
            application.token = tokenObj.accessToken;
            application.refreshToken = tokenObj.refreshToken;
            sendRequest('/v1/me', 'GET', '', function(err, data) {
                if (!err) {
                    getUserInformation(data);
                    adapter.setState('Authorization.Authorized', {
                        val: true,
                        ack: true
                    });
                    sendRequest('/v1/me/player/devices', 'GET', '', function(err,
                        data) {
                        if (!err) {
                            reloadDevices(data);
                        }
                    });
                } else {
                    adapter.setState('Authorization.Authorized', {
                        val: false,
                        ack: true
                    });
                    adapter.log.error('sendRequest in readTokenStates ' + err);
                }
            });
        } else {
            adapter.setState('Authorization.Authorized', {
                val: false,
                ack: true
            });
            adapter.log.warn(err);
        }
    });
}

function readTokenStates(callback) {
    adapter.getState('Authorization.Token', function(err, state) {
        if (state !== null) {
            var tokenObj = state.val;
            var validAccessToken = 'undefined' !== typeof tokenObj.accessToken && (tokenObj.accessToken !==
                '');
            var validRefreshToken = 'undefined' !== typeof tokenObj.refreshToken && (tokenObj.refreshToken !==
                '');
            var validClientId = 'undefined' !== typeof tokenObj.clientId && (tokenObj.clientId !== '') &&
                tokenObj.clientId == application.clientId;
            var validClientSecret = 'undefined' !== typeof tokenObj.clientSecret && (tokenObj.clientSecret !==
                '') && tokenObj.clientSecret == application.clientSecret;
            if (validAccessToken && validRefreshToken && validClientId && validClientSecret) {
                adapter.log.debug('spotify token readed');
                callback(null, tokenObj);
            } else {
                callback('invalid or no spotify token', null);
            }
        } else {
            adapter.setState('Authorization.Authorized', {
                val: false,
                ack: true
            });
            adapter.log.warn('no spotify token');
        }
    });
}

function sendRequest(endpoint, method, sendBody, callback) {
    var options = {
        url: application.baseUrl + endpoint,
        method: method,
        headers: {
            Authorization: 'Bearer ' + application.token
        },
        form: sendBody
    };
    adapter.log.debug(options.form);
    adapter.log.debug('Spotify API Call...' + endpoint);
    var callStack = new Error().stack;
    request(
        options,
        function(error, response, body) {
            if (!error) {
                switch (response.statusCode) {
                    case 200:
                        // OK
                        callback(null, JSON.parse(body))
                        break;
                    case 202:
                        // Accepted, processing has not been completed.
                        adapter.log.debug('http response: ' + JSON.stringify(response));
                        callback(response.statusCode, null);
                        break;
                    case 204:
                        // OK, No Content
                        callback(null, null);
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
                        callback(response.statusCode, null);
                        break;
                    case 401:
                        // Unauthorized
                        if (JSON.parse(body).error.message == 'The access token expired') {
                            adapter.log.debug('Access Token expired!');
                            adapter.setState('Authorization.Authorized', {
                                val: false,
                                ack: true
                            });
                            refreshToken(function(err) {
                                if (!err) {
                                    adapter.setState('Authorization.Authorized', {
                                        val: true,
                                        ack: true
                                    });
                                    sendRequest(endpoint, method, sendBody, function(err, data) {
                                        // this Request get the data which requested with the old token
                                        if (!err) {
                                            adapter.log.debug('data with new token');
                                            callback(null, data);
                                        } else if (err == 202) {
                                            adapter.log.debug(err +
                                                ' Request accepted but no data, try again'
                                            );
                                            callback(err, null);
                                        } else {
                                            adapter.log.error(
                                                'Error on request data again. ' +
                                                err);
                                            callback(err, null);
                                        }
                                    });
                                } else {
                                    adapter.log.error(err);
                                    callback(err, null);
                                }
                            });
                        } else {
                            // if other error with code 401
                            adapter.setState('Authorization.Authorized', {
                                val: false,
                                ack: true
                            });
                            adapter.log.error(JSON.parse(body).error.message);
                            callback(response.statusCode, null);
                        }
                        break;
                    case 429:
                        // Too Many Requests
                        var wait = 1;
                        if (response.headers.hasOwnProperty('retry-after') && response.headers[
                                'retry-after'] > 0) {
                            wait = response.headers['retry-after'];
                            adapter.log.warn('too many requests, wait ' + wait + 's');
                        }
                        setTimeout(function() {
                            sendRequest(endpoint, method, sendBody, callback);
                        }, wait * 1000);
                        break;
                    default:
                        adapter.log
                            .warn('HTTP Request Error not handled, please debug');
                        adapter.log.warn(callStack);
                        adapter.log.warn(new Error().stack);
                        callback(response.statusCode, null);
                        break;
                }
            } else {
                adapter.log.error('erron in Request');
                callback(0, null);
            }
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

function setOrDefault(obj, name, state, defaultVal) {
    var t = loadOrDefault(obj, name, defaultVal);
    adapter.setState(state, {
        val: t,
        ack: true
    });
    return t;
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        adapter.log.warn('no playback content')
        return;
    }
    var deviceId = setOrDefault(data, 'device.id', 'PlaybackInfo.Device.id', '');
    var isDeviceActive = setOrDefault(data, 'device.is_active', 'PlaybackInfo.Device.is_active', false);
    var isDeviceRestricted = setOrDefault(data, 'device.is_restricted', 'PlaybackInfo.Device.is_restricted',
        false);
    var deviceName = setOrDefault(data, 'device.name', 'PlaybackInfo.Device.name', '');
    var deviceType = setOrDefault(data, 'device.type', 'PlaybackInfo.Device.type', '');
    var deviceVolume = setOrDefault(data, 'device.volume_percent', 'PlaybackInfo.Device.volume_percent', 100);
    if (deviceId) {
        deviceData.lastActiveDeviceId = deviceId;
        adapter.getStates('Devices.*.is_active', function(err, state) {
            var keys = Object.keys(state);
            keys.forEach(function(key) {
                key = removeNameSpace(key);
                if (key !== 'Devices.' + deviceName.replace(/\s+/g, '') + '.is_active' &&
                    key.endsWith(
                        '.is_active')) {
                    adapter.setState(key, {
                        val: false,
                        ack: true
                    });
                }
            });
        });
        createDevices({
            devices: [{
                id: deviceId,
                is_active: isDeviceActive,
                is_restricted: isDeviceRestricted,
                name: deviceName,
                type: deviceType,
                volume_percent: deviceVolume
            }]
        });
    } else {
        adapter.getStates('Devices.*.is_active', function(err, state) {
            var keys = Object.keys(state);
            keys.forEach(function(key) {
                key = removeNameSpace(key);
                if (key.endsWith('.is_active')) {
                    adapter.setState(key, {
                        val: false,
                        ack: true
                    });
                }
            });
        });
    }
    var isPlaying = setOrDefault(data, 'is_playing', 'PlaybackInfo.is_playing', false);
    setOrDefault(data, 'item.id', 'PlaybackInfo.Track_Id', '');
    setOrDefault(data, 'item.artists[0].name', 'PlaybackInfo.Artist_Name', '');
    setOrDefault(data, 'item.album.name', 'PlaybackInfo.Album', '');
    setOrDefault(data, 'item.album.images[0].url', 'PlaybackInfo.image_url', '');
    setOrDefault(data, 'item.name', 'PlaybackInfo.Track_Name', '');
    var duration = setOrDefault(data, 'item.duration_ms', 'PlaybackInfo.duration_ms', 0);
    adapter.setState('PlaybackInfo.duration', {
        val: convertToDigiClock(duration),
        ack: true
    });
    var type = setOrDefault(data, 'context.type', 'PlaybackInfo.Type', '');
    if (!type) {
        type = setOrDefault(data, 'item.type', 'PlaybackInfo.Type', '');
    }
    var uri = loadOrDefault(data, 'context.uri', '');
    if (type == 'playlist' && uri) {
        var indexOfUser = uri.indexOf('user:') + 5;
        var endIndexOfUser = uri.indexOf(':', indexOfUser);
        var indexOfPlaylistId = uri.indexOf('playlist:') + 9;
        var query = {
            fields: 'name,id,owner.id,tracks.total',
        };
        sendRequest('/v1/users/' +
            uri.substring(indexOfUser, endIndexOfUser) + '/playlists/' + uri.slice(indexOfPlaylistId) +
            '?' + querystring.stringify(query),
            'GET', '',
            function(err, parseJson) {
                if (!err) {
                    var playListName = setOrDefault(parseJson, 'name', 'PlaybackInfo.Playlist', '');
                    if (playListName) {
                        adapter.getState('Playlists.' + playListName.replace(/\s+/g, '') + '.name',
                            function(err, state) {
                                if (state === null) {
                                    persistPlaylist({
                                        items: [parseJson]
                                    });
                                }
                            });
                    }
                }
            });
    } else {
        adapter.setState('PlaybackInfo.Playlist', {
            val: '',
            ack: true
        });
    }
    setOrDefault(data, 'timestamp', 'PlaybackInfo.timestamp', 0);
    var progress = setOrDefault(data, 'progress_ms', 'PlaybackInfo.progress_ms', 0);
    adapter.setState('PlaybackInfo.progress', {
        val: convertToDigiClock(progress),
        ack: true
    });
    if (progress && isPlaying) {
        scheduleInternalTimer(duration, progress, Date.now(), application.pollingDelaySeconds - 1);
    }
    setOrDefault(data, 'shuffle_state', 'PlaybackInfo.shuffle', false);
    setOrDefault(data, 'repeat_state', 'PlaybackInfo.repeat', 'off');
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

function getUserInformation(data) {
    application.userId = data.id;
    adapter.setState('Authorization.User_ID', {
        val: data.id,
        ack: true
    });
}

function reloadUsersPlaylist() {
    if (application.deletePlaylists) {
        deleteUsersPlaylist(function() {
            getUsersPlaylist(0);
        });
    } else {
        getUsersPlaylist(0);
    }
}

function deleteUsersPlaylist(callback) {
    adapter.getStates('Playlists.*', function(err, state) {
        var keys = Object.keys(state);
        keys.forEach(function(key) {
            key = removeNameSpace(key);
            adapter.delObject(key);
        });
        callback();
    });
}

function persistPlaylist(parseJson, autoContinue) {
    parseJson.items.forEach(function(item) {
        var path = 'Playlists.' +
            item.name.replace(/\s+/g, '');
        adapter.setObjectNotExists(path + '.Play_this_List', {
            type: 'state',
            common: {
                name: 'button',
                type: 'boolean',
                role: 'button'
            },
            native: {}
        });
        adapter.setObjectNotExists(path + '.id', {
            type: 'state',
            common: {
                name: 'id',
                type: 'string',
                role: 'id',
                write: false
            },
            native: {}
        });
        adapter.setObjectNotExists(path + '.owner', {
            type: 'state',
            common: {
                name: 'owner',
                type: 'string',
                role: 'owner',
                write: false
            },
            native: {}
        });
        adapter.setObjectNotExists(path + '.name', {
            type: 'state',
            common: {
                name: 'Name',
                type: 'string',
                role: 'string',
                write: false
            },
            native: {}
        });
        adapter.setObjectNotExists(path + '.tracks_total', {
            type: 'state',
            common: {
                name: 'tracks_total',
                type: 'number',
                role: 'tracks_total',
                write: false
            },
            native: {}
        });
        adapter.setState(path + '.Play_this_List', {
            val: false,
            ack: true
        });
        adapter.setState(path + '.id', {
            val: item.id,
            ack: true
        });
        adapter.setState(path + '.owner', {
            val: item.owner.id,
            ack: true
        });
        adapter.setState(path + '.name', {
            val: item.name,
            ack: true
        });
        adapter.setState(path + '.tracks_total', {
            val: item.tracks.total,
            ack: true
        });
        getPlaylistTracks(item.owner.id,
            item.id, path, 0);
    });
    if (autoContinue && parseJson.items.length !== 0 && (parseJson['next'] !== null)) {
        getUsersPlaylist(parseJson.offset + parseJson.limit);
    }
}

function getUsersPlaylist(offset) {
    if (!isEmpty(application.userId)) {
        var query = {
            limit: 30,
            offset: offset
        };
        sendRequest('/v1/users/' + application.userId + '/playlists?' +
            querystring.stringify(query), 'GET', '',
            function(err, parsedJson) {
                if (!err) {
                    persistPlaylist(parsedJson, true);
                } else {
                    adapter.log.error('playlist error ' + err);
                }
            });
    } else {
        adapter.log.warn('no User_ID');
    }
}

function getSelectedDevice(deviceData) {
    if (deviceData.lastSelectDeviceId === '') {
        return deviceData.lastActiveDeviceId;
    } else {
        return deviceData.lastSelectDeviceId;
    }
}

function getPlaylistTracks(owner, id, path, offset, playListObject) {
    playListObject = playListObject && playListObject !== undefined ? playListObject : {
        StateString: '',
        ListString: '',
        Track_ID_String: '',
        songs: []
    };
    var regParam = owner + '/playlists/' + id + '/tracks';
    var query = {
        fields: 'items.track.name,items.track.id,items.track.artists.name,total,offset',
        limit: 100,
        offset: offset
    };
    sendRequest('/v1/users/' + regParam + '?' + querystring.stringify(query),
        'GET', '',
        function(err, data) {
            if (!err) {
                var i = offset;
                data.items.forEach(function(item) {
                    playListObject.StateString += i.toString() + ':' + item.track.name + '-' +
                        item
                        .track.artists[0].name + ';';
                    playListObject.ListString += item.track.name + '-' + item.track.artists[0].name +
                        ';';
                    playListObject.Track_ID_String += i.toString() + ':' + item.track.id + ';';
                    var a = {
                        id: item.track.id,
                        title: item.track.name,
                        artist: item.track.artists[0].name
                    };
                    playListObject.songs.push(a);
                    i++;
                });
                if (offset + 100 < data.total) {
                    getPlaylistTracks(owner, id, path, offset + 100, playListObject);
                } else {
                    adapter.setObject(path + '.Track_List', {
                        type: 'state',
                        common: {
                            name: 'Tracks',
                            type: 'string',
                            role: 'Tracks',
                            write: false,
                            states: playListObject.StateString,
                            Track_ID: playListObject.Track_ID_String
                        },
                        native: {}
                    });
                    adapter.setState(path + '.Track_List', {
                        val: playListObject.songs,
                        ack: true
                    });
                    adapter.setObjectNotExists(path + '.Track_List_String', {
                        type: 'state',
                        common: {
                            name: 'Tracks List String',
                            type: 'string',
                            role: 'Tracks List String',
                            write: false
                        },
                        native: {}
                    });
                    adapter.setState(path + '.Track_List_String', {
                        val: playListObject.ListString,
                        ack: true
                    });
                }
            } else {
                adapter.log.warn('error on load tracks: ' + err);
            }
        });
}

function removeNameSpace(id) {
    var re = new RegExp(adapter.namespace + '*\.', 'g');
    return id.replace(re, '');
}

function reloadDevices(data) {
    if (application.deleteDevices) {
        deleteDevices(function() {
            createDevices(data);
        });
    } else {
        createDevices(data);
    }
}

function deleteDevices(callback) {
    adapter.getStates('Devices.*', function(err, state) {
        var keys = Object.keys(state);
        keys.forEach(function(key) {
            key = removeNameSpace(key);
            if (key == 'Devices.Get_Devices') {
                return;
            }
            adapter.delObject(key);
        });
        callback();
    });
}

function createDevices(data) {
    data.devices.forEach(function(device) {
        for (var objName in device) {
            adapter.setObjectNotExists('Devices.' +
                device.name.replace(/\s+/g, '') + '.' +
                objName, {
                    type: 'state',
                    common: {
                        name: objName,
                        type: typeof device[objName],
                        role: objName,
                        write: false
                    },
                    native: {}
                });
            adapter.setObjectNotExists('Devices.' +
                device.name.replace(/\s+/g, '') + '.' +
                'Use_for_Playback', {
                    type: 'state',
                    common: {
                        name: 'Use_for_Playback',
                        type: 'boolean',
                        role: 'button'
                    },
                    native: {}
                });
            adapter.setState('Devices.' +
                device.name.replace(/\s+/g, '') + '.' +
                'Use_for_Playback', {
                    val: false,
                    ack: true
                });
            adapter.setState('Devices.' +
                device.name.replace(/\s+/g, '') + '.' +
                objName, {
                    val: device[objName],
                    ack: true
                });
        }
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

function requestAuthorization() {
    var state = generateRandomString(20);
    adapter.setState('Authorization.State', {
        val: state
    });
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
    adapter.setState('Authorization.Authorization_URL', {
        val: options.url
    });
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
    request(options, function(error, response, body) {
        saveToken(JSON.parse(body), function(err, tokenObj) {
            if (!err) {
                adapter.setState('Authorization.Authorization_URL', {
                    val: '',
                    ack: true
                });
                adapter.setState('Authorization.Authorization_Return_URI', {
                    val: '',
                    ack: true
                });
                adapter.setState('Authorization.Authorized', {
                    val: true,
                    ack: true
                });
                application.token = tokenObj.accessToken;
                application.refreshToken = tokenObj.refreshToken;
                start();
            } else {
                adapter.log.debug(err)
            }
        });
    });
}

function refreshToken(callback) {
    adapter.log.debug('Token is requested again');
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
        request(
            options,
            function(error, response, body) {
                // this request gets the new token
                if (response.statusCode == 200) {
                    adapter.log.debug('new token arrived');
                    adapter.log.debug(body);
                    var parsedJson = JSON.parse(body);
                    if (!parsedJson.hasOwnProperty('refresh_token')) {
                        parsedJson.refresh_token = application.refreshToken
                    }
                    adapter.log.debug(JSON.stringify(parsedJson))
                    saveToken(
                        parsedJson,
                        function(err, tokenObj) {
                            if (!err) {
                                application.token = tokenObj.accessToken;
                                callback(null);
                            } else {
                                adapter.log.debug(err);
                                callback(err, null);
                            }
                        });
                } else {
                    callback(response.statusCode);
                }
            });
    }
}

function saveToken(data, callback) {
    adapter.log.debug(data.hasOwnProperty('access_token'))
    if ('undefined' !== typeof data.access_token &&
        ('undefined' !== typeof data.refresh_token)) {
        var token = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            clientId: application.clientId,
            clientSecret: application.clientSecret
        };
        adapter.setState('Authorization.Token', {
            val: token,
            ack: true
        }, function() {
            callback(null, token);
        });
    } else {
        adapter.log.error(JSON.stringify(data));
        callback('no tokens found in server response', null)
    }
}

function on(str, obj) {
    var a = {
        name: str,
        func: obj
    };
    listener.push(a);
}

function increaseTime(duration_ms, progress_ms, startDate, count) {
    var now = Date.now();
    count--;
    progress_ms += now - startDate;
    adapter.setState('PlaybackInfo.progress_ms', {
        val: progress_ms,
        ack: false
    });
    adapter.setState('PlaybackInfo.progress', {
        val: convertToDigiClock(progress_ms),
        ack: false
    });
    if (count > 0 && progress_ms + 1000 < duration_ms) {
        scheduleInternalTimer(duration_ms, progress_ms, now, count);
    }
}

function scheduleInternalTimer(duration_ms, progress_ms, startDate, count) {
    clearTimeout(application.internalTimer);
    application.internalTimer = setTimeout(increaseTime, 1000, duration_ms, progress_ms, startDate, count);
}

function schedulePolling() {
    clearTimeout(application.pollingHandle);
    application.pollingHandle = setTimeout(pollApi, application.pollingDelaySeconds * 1000);
}

function pollApi() {
    clearTimeout(application.internalTimer);
    adapter.log.debug('call polling');
    sendRequest('/v1/me/player', 'GET', '', function(err, data) {
        if (!err) {
            createPlaybackInfo(data);
            schedulePolling();
        } else if (err == 202 || err == 401 || err == 502) {
            adapter.log.warn('Unexpected api response http ' + err + '; continue polling' +
                (err == 202 ?
                    '; You will see a 202 response the first time a user connects to the Spotify Connect API or when the device is temporarily unavailable' :
                    '')
            );
            // 202, 401 and 502 keep the polling running
            var dummyBody = {
                is_playing: false
            };
            // occurs when no player is open
            createPlaybackInfo(dummyBody);
            schedulePolling();
        } else {
            // other errors stop the polling
            adapter.log.error('spotify polling stopped with error ' + err);
        }
    });
}
on('Authorization.Authorization_Return_URI', function(obj) {
    if (!obj.state.ack) {
        adapter.getState('Authorization.State', function(err, state) {
            var returnUri = querystring.parse(obj.state.val.slice(obj.state.val
                .search('[?]') + 1, obj.state.val.length));
            if ('undefined' !== typeof returnUri.state) {
                returnUri.state = returnUri.state.replace(/#_=_$/g, '');
            }
            if (returnUri.state == state.val) {
                adapter.log.debug('getToken');
                application.code = returnUri.code;
                getToken();
            } else {
                adapter.log.error(
                    'invalid session. You need to open the actual Authorization.Authorization_URL'
                );
                adapter.setState('Authorization.Authorization_Return_URI', {
                    val: 'invalid session. You need to open the actual Authorization.Authorization_URL again',
                    ack: true
                });
            }
        });
    }
});
on('Authorization.Get_Authorization', function(obj) {
    if (obj.state.val) {
        adapter.log.debug('requestAuthorization');
        requestAuthorization();
        adapter.setState('Authorization.Authorized', {
            val: false,
            ack: true
        });
    }
});
on(/\.Use_for_Playback$/, function(obj) {
    if (obj.state != null && obj.state.val) {
        adapter.getState(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id', function(err, state) {
            deviceData.lastSelectDeviceId = state.val;
            var send = {
                device_ids: [deviceData.lastSelectDeviceId],
            };
            sendRequest('/v1/me/player', 'PUT', JSON.stringify(send), function(err,
                data) {});
        });
    }
});
on(/\.Track_List$/, function(obj) {
    if (obj.state != null && !obj.state.ack && obj.state.val != null && obj.state.val >= 0) {
        // Play a specific track from Playlist immediately
        var stateName = obj.common.Track_ID.split(';');
        var stateArr = [];
        for (var i = 0; i < stateName.length; i++) {
            var ele = stateName[i].split(':');
            stateArr[ele[0]] = ele[1];
        }
        if (stateArr[obj.state.val] !== '' &&
            (stateArr[obj.state.val] !== null)) {
            var send = {
                uris: ['spotify:track:' + stateArr[obj.state.val]],
                offset: {
                    position: 0
                }
            };
            sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send),
                function(err) {
                    if (!err) {
                        adapter.setState(obj.id, {
                            val: obj.state.val,
                            ack: true
                        })
                    }
                });
        }
    }
});
on(/\.Play_this_List$/,
    function(obj) {
        if (obj.state != null && obj.state.val) {
            // Play a specific playlist immediately
            adapter.getState(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.owner', function(err, state) {
                var owner = state;
                adapter.getState(obj.id.slice(0, obj.id.lastIndexOf('.')) + '.id', function(err,
                    state) {
                    var id = state;
                    var send = {
                        context_uri: 'spotify:user:' +
                            owner.val +
                            ':playlist:' +
                            id.val,
                        offset: {
                            position: 1
                        }
                    };
                    var query = {
                        device_id: getSelectedDevice(deviceData)
                    };
                    sendRequest('/v1/me/player/play?' +
                        querystring.stringify(query), 'PUT', JSON
                        .stringify(send),
                        function() {
                            sendRequest('/v1/me/player', 'GET', '',
                                function(err, data) {
                                    if (!err) {
                                        createPlaybackInfo(data);
                                    }
                                });
                        });
                });
            });
        }
    });
on('Player.Play', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: getSelectedDevice(deviceData)
        };
        adapter.log.debug(getSelectedDevice(deviceData))
        sendRequest('/v1/me/player/play?' + querystring.stringify(query),
            'PUT', '',
            function() {});
    }
});
on('Player.Pause', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: getSelectedDevice(deviceData)
        };
        sendRequest('/v1/me/player/pause?' + querystring.stringify(query),
            'PUT', '',
            function() {});
    }
});
on('Player.Skip_Plus', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: getSelectedDevice(deviceData)
        };
        sendRequest('/v1/me/player/next?' + querystring.stringify(query),
            'POST', '',
            function(err, data) {});
    }
});
on('Player.Skip_Minus', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: getSelectedDevice(deviceData)
        };
        sendRequest('/v1/me/player/previous?' + querystring.stringify(query),
            'POST', '',
            function() {});
    }
});
on('Player.Repeat_Track', function(obj) {
    if (obj.state.val) {
        sendRequest('/v1/me/player/repeat?state=track', 'PUT', '', function() {});
    }
});
on('Player.Repeat_Context', function(obj) {
    if (obj.state.val) {
        sendRequest('/v1/me/player/repeat?state=context', 'PUT', '',
            function() {});
    }
});
on('Player.Repeat_off', function(obj) {
    if (obj.state.val) {
        sendRequest('/v1/me/player/repeat?state=off', 'PUT', '', function() {});
    }
});
on('Player.Volume', function(obj) {
    if (!obj.state.ack) {
        sendRequest('/v1/me/player/volume?volume_percent=' + obj.state.val, 'PUT',
            '',
            function(err) {
                if (!err) {
                    adapter.setState('Player.Volume', {
                        val: '',
                        ack: true
                    });
                }
            });
    }
});
on('Player.Seek', function(obj) {
    if (!obj.state.ack) {
        sendRequest('/v1/me/player/seek?position_ms=' + obj.state.val * 1000,
            'PUT', '',
            function(err) {
                if (!err) {
                    adapter.setState('Player.Seek', {
                        val: '',
                        ack: true
                    });
                }
            });
    }
});
on('Player.Shuffle', function(obj) {
    if (!obj.state.ack) {
        sendRequest('/v1/me/player/shuffle?state=' + (obj.state.val === true ? 'true' : 'false'),
            'PUT', '',
            function(err) {
                if (!err) {
                    adapter.setState('Player.Shuffle', {
                        val: '',
                        ack: true
                    });
                }
            });
    }
});
on('Player.TrackId', function(obj) {
    if (!obj.state.ack) {
        var send = {
            uris: ['spotify:track:' + obj.state.val],
            offset: {
                position: 0
            }
        };
        sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function(err) {
            if (!err) {
                adapter.setState('Player.TrackId', {
                    val: '',
                    ack: true
                });
            }
        });
    }
});
on('Player.Playlist_ID', function(obj) {
    if (!obj.state.ack) {
        var send = {
            context_uri: 'spotify:user:' + application.userId + ':playlist:' +
                obj.state.val,
            offset: {
                position: 1
            }
        };
        sendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function(err) {
            if (!err) {
                adapter.setState('Player.Playlist_ID', {
                    val: '',
                    ack: true
                });
            }
        });
    }
});
on('Get_User_Playlists', function(obj) {
    reloadUsersPlaylist();
});
on('Devices.Get_Devices', function(obj) {
    sendRequest('/v1/me/player/devices', 'GET', '', function(err, data) {
        if (!err) {
            reloadDevices(data);
        }
    });
});
on('Get_Playback_Info', function(obj) {
    sendRequest('/v1/me/player', 'GET', '', function(err, data) {
        if (!err) {
            createPlaybackInfo(data);
        }
    });
});
on('Authorization.Authorized', function(obj) {
    if (obj.state.val === true) {
        schedulePolling();
    }
});
adapter.on('ready', function() {
    main();
});
adapter.on('stateChange', function(id, state) {
    var found = false;
    var shrikId = removeNameSpace(id);
    listener.forEach(function(value) {
        if ((value.name instanceof RegExp && value.name.test(shrikId)) || value.name ==
            shrikId) {
            found = true;
            value.func({
                id: shrikId,
                state: state
            });
        }
    });
});
adapter.on('unload', function(callback) {
    try {
        adapter.setState('Authorization.Authorization_URL', {
            val: '',
            ack: true
        });
        adapter.setState('Authorization.Authorization_Return_URI', {
            val: '',
            ack: true
        });
        adapter.setState('Player.TrackId', {
            val: '',
            ack: true
        });
        adapter.setState('Player.Playlist_ID', {
            val: '',
            ack: true
        });
        adapter.setState('Authorization.User_ID', {
            val: '',
            ack: true
        });
        adapter.setState('Authorization.Authorized', {
            val: false,
            ack: true
        });
        if ('undefined' !== typeof application.pollingHandle) {
            clearTimeout(application.pollingHandle);
            clearTimeout(application.internalTimer);
        }
        callback();
    } catch (e) {
        callback();
    }
});