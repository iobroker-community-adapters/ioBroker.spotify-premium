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
    code: ''
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
    readTokenStates(function(err, Token) {
        if (!err) {
            application.token = Token.AccessToken;
            application.refreshToken = Token.RefreshToken;
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
            var token = state.val;
            var atf = "undefined" !== typeof token.AccessToken &&
                (token.AccessToken !== '');
            var rtf = "undefined" !== typeof token.RefreshToken &&
                (token.RefreshToken !== '');
            if (atf && rtf) {
                adapter.log.debug('spotify token readed');
                return callback(null, token);
            } else {
                return callback('no spotify token', null);
            }
        } else {
            adapter.setState('Authorization.Authorized', {
                val: false,
                ack: true
            });
            adapter.log.warn('no Token set');
        }
    });
}

function sendRequest(Endpoint, Method, Send_Body, callback) {
    var options = {
        url: application.baseUrl + Endpoint,
        method: Method,
        headers: {
            Authorization: 'Bearer ' + application.token
        },
        form: Send_Body
    };
    adapter.log.debug(options.form);
    adapter.log.debug('Spotify API Call...' + Endpoint);
    var callStack = new Error().stack;
    request(
        options,
        function(error, response, body) {
            if (!error) {
                switch (response.statusCode) {
                    case 200:
                        // OK
                        return callback(null, JSON.parse(body));
                    case 202:
                        // Accepted, processing has not been completed.
                        return callback(response.statusCode, null);
                    case 204:
                        // OK, No Content
                        return callback(null, null);
                    case 400:
                        // Bad Request, message body will contain more
                        // information
                        // case 429:
                        // Too Many Requests
                    case 500:
                        // Server Error
                    case 503:
                        // Service Unavailable
                    case 404:
                        // Not Found
                    case 502:
                        // Bad Gateway
                        return callback(response.statusCode, null);
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
                                    sendRequest(Endpoint, Method, Send_Body, function(err, data) {
                                    	// this Request get the data which requested with the old token
                                        if (!err) {
                                            adapter.log.debug('data with new token');
                                            return callback(null, data);
                                        } else if (err == 202) {
                                            adapter.log.debug(err +
                                                ' Request accepted but no data, try again'
                                            );
                                            return callback(err, null);
                                        } else {
                                            adapter.log.error(
                                                'Error on request data again. ' +
                                                err);
                                            return callback(err, null);
                                        }
                                    });
                                } else {
                                	adapter.log.error(err);
                                    return callback(err, null);
                                }
                            });
                        } else {
                            // wenn anderer Fehler mit Code 401
                            adapter.setState('Authorization.Authorized', {
                                val: false,
                                ack: true
                            });
                            adapter.log.error(JSON.parse(body).error.message);
                            return callback(response.statusCode, null);
                        }
                        break;
                    default:
                        adapter.log
                            .warn('HTTP Request Error not handled, please debug');
                    	adapter.log.warn(callStack);
                        adapter.log.warn(new Error().stack);
                        return callback(response.statusCode, null);
                }
            } else {
                adapter.log.error('erron in Request');
                return callback(0, null);
            }
        });
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        adapter.log.warn('no playback content')
        return;
    }
    if (data.hasOwnProperty('device')) {
        deviceData.lastActiveDeviceId = data.device.id;
        adapter.setState('PlaybackInfo.Device.id', {
            val: data.device.id,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.is_active', {
            val: data.device.is_active,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.is_restricted', {
            val: data.device.is_restricted,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.name', {
            val: data.device.name,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.type', {
            val: data.device.type,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.volume_percent', {
            val: data.device.volume_percent,
            ack: true
        });
        adapter.getStates('Devices.*.is_active', function(err, state) {
            var keys = Object.keys(state);
            keys.forEach(function(key) {
                key = removeNameSpace(key);
                if (key !== 'Devices.' + data.device.name.replace(/\s+/g, '') + '.is_active' && key.endsWith(
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
                id: data.device.id,
                is_active: data.device.is_active,
                is_restricted: data.device.is_restricted,
                name: data.device.name,
                type: data.device.type,
                volume_percent: data.device.volume_percent
            }]
        });
    } else {
        adapter.setState('PlaybackInfo.Device.id', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.is_active', {
            val: false,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.is_restricted', {
            val: false,
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.name', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.type', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.Device.volume_percent', {
            val: 100,
            ack: true
        });
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
    if (data.hasOwnProperty('is_playing')) {
        adapter.setState('PlaybackInfo.is_playing', {
            val: data.is_playing,
            ack: true
        });
    }
    if (data.hasOwnProperty('item')) {
        adapter.setState('PlaybackInfo.Track_Id', {
            val: data.item.id,
            ack: true
        });
        adapter.setState('PlaybackInfo.Artist_Name', {
            val: data.item.artists[0].name,
            ack: true
        });
        adapter.setState('PlaybackInfo.Album', {
            val: data.item.album.name,
            ack: true
        });
        adapter.setState('PlaybackInfo.image_url', {
            val: data.item.album.images[0].url,
            ack: true
        });
        adapter.setState('PlaybackInfo.Track_Name', {
            val: data.item.name,
            ack: true
        });
        adapter.setState('PlaybackInfo.duration_ms', {
            val: data.item.duration_ms,
            ack: true
        });
        adapter.setState('PlaybackInfo.duration', {
            val: convertToDigiClock(data.item.duration_ms),
            ack: true
        });
    } else {
        adapter.setState('PlaybackInfo.Track_Id', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.Artist_Name', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.Album', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.image_url', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.Track_Name', {
            val: '',
            ack: true
        });
        adapter.setState('PlaybackInfo.duration_ms', {
            val: 0,
            ack: true
        });
        adapter.setState('PlaybackInfo.duration', {
            val: convertToDigiClock(0),
            ack: true
        });
    }
    if (data.hasOwnProperty('context') && data.context !== null) {
        adapter.setState('PlaybackInfo.Type', {
            val: data.context.type,
            ack: true
        });
        if (data.context.type == 'playlist') {
            var indexOfUser = data.context.uri.indexOf("user:") + 5;
            var endIndexOfUser = data.context.uri.indexOf(":",
                indexOfUser);
            var indexOfPlaylistId = data.context.uri
                .indexOf("playlist:") + 9;
            var query = {
                fields: 'name,id,owner.id,tracks.total',
            };
            sendRequest('/v1/users/' +
                data.context.uri.substring(indexOfUser,
                    endIndexOfUser) + '/playlists/' +
                data.context.uri.slice(indexOfPlaylistId) + '?' +
                querystring.stringify(query), 'GET', '',
                function(err, parseJson) {
                    if (!err && parseJson.hasOwnProperty('name')) {
                        adapter.setState('PlaybackInfo.Playlist', {
                            val: parseJson.name,
                            ack: true
                        });
                        adapter.getState('Playlists.' + parseJson.name.replace(/\s+/g, '') + '.name', function(err, state) {
                            if (state === null) {
                                persistPlaylist({
                                    items: [parseJson]
                                });
                            }
                        });
                    } else {
                        adapter.log.warn(err);
                    }
                });
        } else {
            adapter.setState('PlaybackInfo.Playlist', {
                val: '',
                ack: true
            });
        }
    } else {
        if (data.hasOwnProperty('item')) {
            adapter.setState('PlaybackInfo.Type', {
                val: data.item.type,
                ack: true
            });
        } else {
            adapter.setState('PlaybackInfo.Type', {
                val: '',
                ack: true
            });
        }
        adapter.setState('PlaybackInfo.Playlist', {
            val: '',
            ack: true
        });
    }
    if (data.hasOwnProperty('timestamp')) {
        adapter.setState('PlaybackInfo.timestamp', {
            val: data.timestamp,
            ack: true
        });
    } else {
        adapter.setState('PlaybackInfo.timestamp', {
            val: 0,
            ack: true
        });
    }
    if (data.hasOwnProperty('progress_ms')) {
        adapter.setState('PlaybackInfo.progress_ms', {
            val: data.progress_ms,
            ack: true
        });
        adapter.setState('PlaybackInfo.progress', {
            val: convertToDigiClock(data.progress_ms),
            ack: true
        });
    } else {
        adapter.setState('PlaybackInfo.progress_ms', {
            val: 0,
            ack: true
        });
        adapter.setState('PlaybackInfo.progress', {
            val: convertToDigiClock(0),
            ack: true
        });
    }
    if (data.hasOwnProperty('shuffle_state')) {
        adapter.setState('PlaybackInfo.shuffle', {
            val: data.shuffle_state,
            ack: true
        });
    } else {
        adapter.setState('PlaybackInfo.shuffle', {
            val: false,
            ack: true
        });
    }
    if (data.hasOwnProperty('repeat_state')) {
        adapter.setState('PlaybackInfo.repeat', {
            val: data.repeat_state,
            ack: true
        });
    } else {
        adapter.setState('PlaybackInfo.repeat', {
            val: false,
            ack: true
        });
    }
}

function convertToDigiClock(ms) {
	// milliseconds to digital time, e.g. 3:59=238759
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
    if (deviceData.lastSelectDeviceId === "") {
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
        saveToken(JSON.parse(body), function(err, Token) {
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
                application.token = Token.AccessToken;
                application.refreshToken = Token.RefreshToken;
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
                        function(err, Token) {
                            if (!err) {
                                application.token = Token.AccessToken;
                                return callback(null);
                            } else {
                                adapter.log.debug(err);
                                return callback(err, null);
                            }
                        });
                } else {
                    return callback(response.statusCode);
                }
            });
    }
}

function saveToken(data, callback) {
    adapter.log.debug(data.hasOwnProperty('access_token'))
    if ("undefined" !== typeof data.access_token &&
        ("undefined" !== typeof data.refresh_token)) {
        var token = {
            AccessToken: data.access_token,
            RefreshToken: data.refresh_token
        };
        adapter.setState('Authorization.Token', {
            val: token,
            ack: true
        }, function() {
            callback(null, token);
        });
    } else {
        adapter.log.error(JSON.stringify(data));
        return callback('no tokens found in server response', null)
    }
}

function on(str, obj) {
    var a = {
        name: str,
        func: obj
    };
    listener.push(a);
}
on('Authorization.Authorization_Return_URI', function(obj) {
    if (!obj.state.ack) {
        adapter.getState('Authorization.State', function(err, state) {
            var returnUri = querystring.parse(obj.state.val.slice(obj.state.val
                .search('[?]') + 1, obj.state.val.length));
            returnUri.state = returnUri.state.replace(/#_=_$/g, '');
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
        adapter.getState(obj.id.slice(0, obj.id.lastIndexOf(".")) + '.id', function(err, state) {
            deviceData.lastSelectDeviceId = state.val;
            var send = {
                device_ids: [deviceData.lastSelectDeviceId],
            };
            sendRequest('/v1/me/player', 'PUT', JSON.stringify(send), function(err,
                data) {
            });
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
            adapter.getState(obj.id.slice(0, obj.id.lastIndexOf(".")) + '.owner', function(err, state) {
                var owner = state;
                adapter.getState(obj.id.slice(0, obj.id.lastIndexOf(".")) + '.id', function(err,
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
                        val: null,
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
                        val: null,
                        ack: true
                    });
                }
            });
    }
});
on('Player.Shuffle', function(obj) {
    if (obj.state.val === true) {
        sendRequest('/v1/me/player/shuffle?state=true', 'PUT', '', function() {})
    } else {
        sendRequest('/v1/me/player/shuffle?state=false', 'PUT', '', function() {})
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
                    val: null,
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
                    val: null,
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
        application.Intervall = setInterval(function() {
            sendRequest('/v1/me/player', 'GET', '', function(err, data) {
                if (!err) {
                    adapter.log.debug('Intervall');
                    createPlaybackInfo(data);
                } else if (err == 202 || err == 401 || err == 502) {
                    // 202, 401 and 502 keep the interval running
                    var dummyBody = {
                        is_playing: false
                    };
                    // occurs when no player is open
                    createPlaybackInfo(dummyBody);
                } else {
                    // other errors stop the interval
                    clearInterval(application.Intervall);
                    adapter.log.warn('Spotify interval stopped! -> ' + err);
                }
            });
        }, 5000);
    } else {
        if ("undefined" !== typeof application.Intervall) {
            clearInterval(application.Intervall)
        }
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
        if ("undefined" !== typeof application.Intervall) {
            clearInterval(application.Intervall)
        }
        callback();
    } catch (e) {
        callback();
    }
});