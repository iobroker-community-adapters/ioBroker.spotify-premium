/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
'use strict';
var utils = require(__dirname + '/lib/utils');
var request = require('request');
var querystring = require('querystring');
var adapter = new utils.Adapter('spotify-premium');
var Application = {
    User_ID: '',
    BaseURL: 'https://api.spotify.com',
    Client_ID: '',
    Client_Secret: '',
    // older versions uses 'https://example.com/callback/', use
    // 'http://localhost' instead for safety reasons
    redirect_uri: 'http://localhost',
    Token: '',
    refresh_token: '',
    code: ''
};
var Device_Data = {
    last_active_device_id: '',
    last_select_device_id: ''
};

function isEmpty(str) {
    return (!str || 0 === str.length);
}

function main() {
    Application.Client_ID = adapter.config.client_id;
    Application.Client_Secret = adapter.config.client_secret;
    if (isEmpty(Application.Client_ID)) {
        adapter.log.error('Client_ID is not filled');
        return;
    }
    if (isEmpty(Application.Client_Secret)) {
        adapter.log.error('Client_Secret is not filled');
        return;
    }
    adapter.subscribeStates('*');
    start();
}

function start() {
    ReadTokenFiles(function(err, Token) {
        if (!err) {
            Application.Token = Token.AccessToken;
            Application.refresh_token = Token.RefreshToken;
            SendRequest('/v1/me', 'GET', '', function(err, data) {
                if (!err) {
                    GetUserInformation(data);
                    adapter.setState('Authorization.Authorized', {
                        val: true,
                        ack: true
                    });
                    SendRequest('/v1/me/player/devices', 'GET', '', function(err,
                        data) {
                        if (!err) {
                            CreateDevices(data)
                        }
                    });
                } else {
                    adapter.setState('Authorization.Authorized', {
                        val: false,
                        ack: true
                    });
                    adapter.log.error('SendRequest in ReadTokenFiles ' + err);
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

function ReadTokenFiles(callback) {
    adapter.getState('Authorization.Token', function(err, state) {
        if (state !== null) {
            var Token = state.val;
            var ATF = "undefined" !== typeof Token.AccessToken &&
                (Token.AccessToken !== '');
            var RTF = "undefined" !== typeof Token.RefreshToken &&
                (Token.RefreshToken !== '');
            if (ATF && RTF) {
                adapter.log
                    .debug('Spotify Token aus Datei gelesen !');
                return callback(null, Token);
            } else {
                return callback('Keine Token in Datei gefunden !', null);
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

function SendRequest(Endpoint, Method, Send_Body, callback) {
    var options = {
        url: Application.BaseURL + Endpoint,
        method: Method,
        headers: {
            Authorization: 'Bearer ' + Application.Token
        },
        form: Send_Body
    };
    adapter.log.debug(options.form);
    adapter.log.debug('Spotify API Call...' + Endpoint);
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
                            adapter.log.debug('Access Token Abgelaufen!!');
                            adapter.setState('Authorization.Authorized', {
                                val: false,
                                ack: true
                            });
                            Refresh_Token(function(err) {
                                if (!err) {
                                    adapter.setState('Authorization.Authorized', {
                                        val: true,
                                        ack: true
                                    });
                                    SendRequest(Endpoint, Method, Send_Body, function(err, data) {
                                        // dieser Request holt die Daten die zuvor mit altem Token gefordert wurden
                                        if (!err) {
                                            adapter.log.debug('Daten mit neuem Token');
                                            return callback(null, data);
                                        } else if (err == 202) {
                                            adapter.log.debug(err +
                                                ' Anfrage akzeptiert, keine Daten in Antwort, versuch es nochmal ;-)'
                                            );
                                            return callback(err, null);
                                        } else {
                                            console.error(
                                                'FEHLER BEIM ERNEUTEN DATEN ANFORDERN ! ' +
                                                err);
                                            return callback(err, null);
                                        }
                                    });
                                } else {
                                    console.error(err);
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
                            .warn('HTTP Request Fehler wird nicht behandelt, bitte Debuggen !!');
                        return callback(response.statusCode, null);
                }
            } else {
                adapter.log.error('erron in Request');
                return callback(0, null);
            }
        });
}

function CreatePlaybackInfo(P_Body) {
    adapter.log.debug(JSON.stringify(P_Body));
    if (P_Body.hasOwnProperty('device')) {
        Device_Data.last_active_device_id = P_Body.device.id;
        adapter.setState('PlaybackInfo.Device.id', {
            val: P_Body.device.id,
            ack: true
        });
    }
    if (P_Body.hasOwnProperty('is_playing')) {
        adapter.setState('PlaybackInfo.is_playing', {
            val: P_Body.is_playing,
            ack: true
        });
        if (P_Body.is_playing === true) {
            adapter.setState('PlaybackInfo.Track_Id', {
                val: P_Body.item.id,
                ack: true
            });
            adapter.setState('PlaybackInfo.Artist_Name', {
                val: P_Body.item.artists[0].name,
                ack: true
            });
            if (P_Body.context !== null) {
                adapter.setState('PlaybackInfo.Type', {
                    val: P_Body.context.type,
                    ack: true
                });
                if (P_Body.context.type == 'playlist') {
                    var IndexOfUser = P_Body.context.uri.indexOf("user:") + 5;
                    var EndIndexOfUser = P_Body.context.uri.indexOf(":",
                        IndexOfUser);
                    var IndexOfPlaylistID = P_Body.context.uri
                        .indexOf("playlist:") + 9;
                    var query = {
                        fields: 'name',
                    };
                    SendRequest('/v1/users/' +
                        P_Body.context.uri.substring(IndexOfUser,
                            EndIndexOfUser) + '/playlists/' +
                        P_Body.context.uri.slice(IndexOfPlaylistID) + '?' +
                        querystring.stringify(query), 'GET', '',
                        function(err, P_Body) {
                            if (!err && P_Body.hasOwnProperty('name')) {
                                adapter.setState('PlaybackInfo.Playlist', {
                                    val: P_Body.name,
                                    ack: true
                                });
                                adapter.log.debug(JSON.stringify(P_Body));
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
                adapter.setState('PlaybackInfo.Type', {
                    val: P_Body.item.type,
                    ack: true
                });
                adapter.setState('PlaybackInfo.Playlist', {
                    val: '',
                    ack: true
                });
            }
            adapter.setState('PlaybackInfo.Album', {
                val: P_Body.item.album.name,
                ack: true
            });
            adapter.setState('PlaybackInfo.timestamp', {
                val: P_Body.timestamp,
                ack: true
            });
            adapter.setState('PlaybackInfo.progress_ms', {
                val: P_Body.progress_ms,
                ack: true
            });
            adapter.setState('PlaybackInfo.image_url', {
                val: P_Body.item.album.images[0].url,
                ack: true
            });
            adapter.setState('PlaybackInfo.Track_Name', {
                val: P_Body.item.name,
                ack: true
            });
            adapter.setState('PlaybackInfo.duration_ms', {
                val: P_Body.item.duration_ms,
                ack: true
            });
            adapter.setState('PlaybackInfo.duration', {
                val: DigiClock(P_Body.item.duration_ms),
                ack: true
            });
            adapter.setState('PlaybackInfo.progress', {
                val: DigiClock(P_Body.progress_ms),
                ack: true
            });
            adapter.setState('PlaybackInfo.Device.is_active', {
                val: P_Body.device.is_active,
                ack: true
            });
            adapter.setState('PlaybackInfo.Device.is_restricted', {
                val: P_Body.device.is_restricted,
                ack: true
            });
            adapter.setState('PlaybackInfo.Device.name', {
                val: P_Body.device.name,
                ack: true
            });
            adapter.setState('PlaybackInfo.Device.type', {
                val: P_Body.device.type,
                ack: true
            });
            adapter.setState('PlaybackInfo.Device.volume_percent', {
                val: P_Body.device.volume_percent,
                ack: true
            });
        }
    }
}

function DigiClock(ms) {
    // Millisekunden zu Digitaluhr, Beispiel 3:59=238759
    var Min = Math.floor(ms / 60000);
    var Sec = Math.floor(((ms % 360000) % 60000) / 1000);
    if (Min < 10) {
        Min = '0' + Min;
    }
    if (Sec < 10) {
        Sec = '0' + Sec;
    }
    return Min + ':' + Sec;
}

function GetUserInformation(P_Body) {
    Application.User_ID = P_Body.id;
    adapter.setState('Authorization.User_ID', {
        val: P_Body.id,
        ack: true
    });
}

function GetUsersPlaylist(offset) {
    var PlaylistString;
    if (!isEmpty(Application.User_ID)) {
        var query = {
            limit: 30,
            offset: offset
        };
        SendRequest('/v1/users/' + Application.User_ID + '/playlists?' +
            querystring.stringify(query), 'GET', '',
            function(err, P_Body) {
                if (!err) {
                    P_Body.items.forEach(function(item) {
                        var Pfad = 'Playlists.' +
                            item.name.replace(/\s+/g, '');
                        PlaylistString = item.name + ';' +
                            PlaylistString;
                        adapter.setObjectNotExists(Pfad + '.Play_this_List', {
                            type: 'state',
                            common: {
                                name: 'button',
                                type: 'boolean',
                                role: 'button'
                            },
                            native: {}
                        });
                        adapter.setObjectNotExists(Pfad + '.id', {
                            type: 'state',
                            common: {
                                name: 'id',
                                type: 'string',
                                role: 'id',
                                write: false
                            },
                            native: {}
                        });
                        adapter.setObjectNotExists(Pfad + '.owner', {
                            type: 'state',
                            common: {
                                name: 'owner',
                                type: 'string',
                                role: 'owner',
                                write: false
                            },
                            native: {}
                        });
                        adapter.setObjectNotExists(Pfad + '.name', {
                            type: 'state',
                            common: {
                                name: 'Name',
                                type: 'string',
                                role: 'string',
                                write: false
                            },
                            native: {}
                        });
                        adapter.setObjectNotExists(Pfad + '.tracks_total', {
                            type: 'state',
                            common: {
                                name: 'tracks_total',
                                type: 'number',
                                role: 'tracks_total',
                                write: false
                            },
                            native: {}
                        });
                        adapter.setState(Pfad + '.Play_this_List', {
                            val: false,
                            ack: true
                        });
                        adapter.setState(Pfad + '.id', {
                            val: item.id,
                            ack: true
                        });
                        adapter.setState(Pfad + '.owner', {
                            val: item.owner.id,
                            ack: true
                        });
                        adapter.setState(Pfad + '.name', {
                            val: item.name,
                            ack: true
                        });
                        adapter.setState(Pfad + '.tracks_total', {
                            val: item.tracks.total,
                            ack: true
                        });
                        Get_Playlist_Tracks(item.owner.id,
                            item.id, Pfad);
                    });
                    if (P_Body.items.length !== 0 &&
                        (P_Body['next'] !== null)) {
                        GetUsersPlaylist(P_Body.offset + P_Body.limit)
                    }
                    // adapter.setState('Playlist_Names', { val:
                    // PlaylistString});
                } else {
                    adapter.log.error('playlist error ' + playlists);
                }
            });
    } else {
        adapter.log.error('no User_ID');
    }
}

function Device_Handel(Device_Data) {
    if (Device_Data.last_select_device_id === "") {
        return Device_Data.last_active_device_id;
    } else {
        return Device_Data.last_select_device_id;
    }
}

function Get_Playlist_Tracks(owner, id, Pfad) {
    var reg_param = owner + '/playlists/' + id + '/tracks';
    var query = {
        fields: 'items.track.name,items.track.id,items.track.artists.name,total,offset',
        limit: 100,
        offset: 0
    };
    SendRequest('/v1/users/' + reg_param + '?' + querystring.stringify(query),
        'GET', '',
        function(err, data) {
            if (!err) {
                var StateString = '';
                var ListString = '';
                var Track_ID_String = '';
                var songs = [];
                var i = 0;
                data.items.forEach(function(item) {
                    StateString = StateString + i.toString() + ':' + item.track.name + '-' + item
                        .track.artists[0].name + ';';
                    ListString = ListString + item.track.name + '-' + item.track.artists[0].name +
                        ';';
                    Track_ID_String = Track_ID_String + i.toString() + ':' + item.track.id + ';';
                    var a = {
                        id: item.track.id,
                        title: item.track.name,
                        artist: item.track.artists[0].name
                    };
                    songs.push(a);
                    i++;
                });
                adapter.setObject(Pfad + '.Track_List', {
                    type: 'state',
                    common: {
                        name: 'Tracks',
                        type: 'string',
                        role: 'Tracks',
                        states: StateString,
                        Track_ID: Track_ID_String
                    },
                    native: {}
                });
                adapter.setState(Pfad + '.Track_List', {
                    val: songs,
                    ack: true
                });
                adapter.setObject(Pfad + '.Track_List_String', {
                    type: 'state',
                    common: {
                        name: 'Tracks List String',
                        type: 'string',
                        role: 'Tracks List String'
                    },
                    native: {}
                });
                adapter.setState(Pfad + '.Track_List_String', {
                    val: ListString,
                    ack: true
                });
            }
        });
}

function CreateDevices(P_Body) {
    adapter.log.info(JSON.stringify(P_Body));
    P_Body.devices.forEach(function(device) {
        for (var ObjName in device) {
            adapter.setObjectNotExists('Devices.' +
                device.name.replace(/\s+/g, '') + '.' +
                ObjName, {
                    type: 'state',
                    common: {
                        name: ObjName,
                        type: typeof device[ObjName],
                        role: ObjName
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
                ObjName, {
                    val: device[ObjName],
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

function request_authorization() {
    var state = generateRandomString(20);
    adapter.setState('Authorization.State', {
        val: state
    });
    var query = {
        client_id: Application.Client_ID,
        response_type: 'code',
        redirect_uri: Application.redirect_uri,
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

function GetToken() {
    var options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' +
                Buffer.from(
                    Application.Client_ID + ':' +
                    Application.Client_Secret).toString(
                    'base64')
        },
        form: {
            grant_type: 'authorization_code',
            code: Application.code,
            redirect_uri: Application.redirect_uri
        }
    };
    request(options, function(error, response, body) {
        SaveToken(JSON.parse(body), function(err, Token) {
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
                Application.Token = Token.AccessToken;
                Application.refresh_token = Token.RefreshToken;
                start();
            } else {
                adapter.log.debug(err)
            }
        });
    });
}

function Refresh_Token(Endpoint, Method, Send_Body, callback) {
    adapter.log.debug('Token wird erneut angefordert !');
    var options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' +
                Buffer.from(
                    Application.Client_ID + ':' +
                    Application.Client_Secret).toString(
                    'base64')
        },
        form: {
            grant_type: 'refresh_token',
            refresh_token: Application.refresh_token
        }
    };
    if (Application.refresh_token !== '') {
        request(
            options,
            function(error, response, body) {
                // dieser Request holt den neuen Token
                if (response.statusCode == 200) {
                    adapter.log.debug('neuer Token eingetroffen');
                    adapter.log.debug(body);
                    var P_Body = JSON.parse(body);
                    if (!P_Body.hasOwnProperty('refresh_token')) {
                        P_Body.refresh_token = Application.refresh_token
                    }
                    adapter.log.debug(JSON.stringify(P_Body))
                    SaveToken(
                        P_Body,
                        function(err, Token) {
                            if (!err) {
                                Application.Token = Token.AccessToken;
                                return callback(null);
                                // Application.refresh_token=Token.refresh_token;
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

function SaveToken(P_Body, callback) {
    adapter.log.debug(P_Body.hasOwnProperty('access_token'))
    if ("undefined" !== typeof P_Body.access_token &&
        ("undefined" !== typeof P_Body.refresh_token)) {
        var Token = {
            AccessToken: P_Body.access_token,
            RefreshToken: P_Body.refresh_token
        };
        adapter.setState('Authorization.Token', {
            val: Token,
            ack: true
        }, function() {
            callback(null, Token);
        });
    } else {
        adapter.log.error(JSON.stringify(P_Body));
        return callback('keine Token in Serverantwort gefunden ! ', null)
    }
}
var listener = [];

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
            var return_uri = querystring.parse(obj.state.val.slice(obj.state.val
                .search('[?]') + 1, obj.state.val.length));
            if (return_uri.state == state.val) {
                adapter.log.debug('GetToken');
                Application.code = return_uri.code;
                GetToken();
            } else {
                adapter.log.error(
                    'invalid session. You need to open the actual Authorization.Authorization_URL'
                );
            }
        });
    } else {
        adapter.log.debug('ack: ' + obj.state.ack);
    }
});
on('Authorization.Get_Authorization', function(obj) {
    if (obj.state.val) {
        adapter.log.debug('request_authorization');
        request_authorization();
        adapter.setState('Authorization.Authorized', {
            val: false,
            ack: true
        });
    }
});
on(/\.Use_for_Playback$/, function(obj) {
    if (obj.state != null && obj.state.val) {
        adapter.getState(obj.id.slice(0, obj.id.lastIndexOf(".")) + '.id', function(err, state) {
            Device_Data.last_select_device_id = state.val;
            var send = {
                device_ids: [Device_Data.last_select_device_id],
                // Divice IDs als Array! play:false
                // True = Wiedergabe
                // startet sofort auf diesem Gerät, FALSE = Wiedergabe
                // anhängig von Playback State
            };
            SendRequest('/v1/me/player', 'PUT', JSON.stringify(send), function(err,
                data) {
                // if(!err){Device_Data.last_select_device_id=getState(obj.id.slice(0,obj.id.lastIndexOf("."))+'.id').val}
            });
        });
    }
});
on(/\.Track_List$/, function(obj) {
    if (obj.state != null && !obj.state.ack && obj.state.val != null && obj.state.val >= 0) {
        // eine bestimmten Track aus Playliste sofort abspielen
        var StateName = obj.common.Track_ID.split(';');
        var StateArr = [];
        for (var i = 0; i < StateName.length; i++) {
            var ele = StateName[i].split(':');
            StateArr[ele[0]] = ele[1];
        }
        if (StateArr[obj.state.val] !== '' &&
            (StateArr[obj.state.val] !== null)) {
            var send = {
                uris: ['spotify:track:' + StateArr[obj.state.val]],
                offset: {
                    position: 0
                }
            };
            SendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send),
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
            // eine bestimmte Playlist sofort abspielen
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
                        device_id: Device_Handel(Device_Data)
                    };
                    SendRequest('/v1/me/player/play?' +
                        querystring.stringify(query), 'PUT', JSON
                        .stringify(send),
                        function() {
                            SendRequest('/v1/me/player', 'GET', '',
                                function(err, data) {
                                    if (!err) {
                                        CreatePlaybackInfo(data)
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
            device_id: Device_Handel(Device_Data)
        };
        adapter.log.debug(Device_Handel(Device_Data))
        SendRequest('/v1/me/player/play?' + querystring.stringify(query),
            'PUT', '',
            function() {});
    }
});
on('Player.Pause', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: Device_Handel(Device_Data)
        };
        SendRequest('/v1/me/player/pause?' + querystring.stringify(query),
            'PUT', '',
            function() {});
    }
});
on('Player.Skip_Plus', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: Device_Handel(Device_Data)
        };
        SendRequest('/v1/me/player/next?' + querystring.stringify(query),
            'POST', '',
            function(err, data) {});
    }
});
on('Player.Skip_Minus', function(obj) {
    if (obj.state.val) {
        var query = {
            device_id: Device_Handel(Device_Data)
        };
        SendRequest('/v1/me/player/previous?' + querystring.stringify(query),
            'POST', '',
            function() {});
    }
});
on('Player.Repeat_Track', function(obj) {
    if (obj.state.val) {
        SendRequest('/v1/me/player/repeat?state=track', 'PUT', '', function() {});
    }
});
on('Player.Repeat_Context', function(obj) {
    if (obj.state.val) {
        SendRequest('/v1/me/player/repeat?state=context', 'PUT', '',
            function() {});
    }
});
on('Player.Repeat_off', function(obj) {
    if (obj.state.val) {
        SendRequest('/v1/me/player/repeat?state=off', 'PUT', '', function() {});
    }
});
on('Player.Volume', function(obj) {
    SendRequest('/v1/me/player/volume?volume_percent=' + obj.state.val, 'PUT',
        '',
        function(err) {
            if (!err) {
                // adapter.setState('Player.Volume', {ack: true});
            }
        });
});
on('Player.Seek', function(obj) {
    SendRequest('/v1/me/player/seek?position_ms=' + obj.state.val * 1000,
        'PUT', '',
        function() {});
});
on('Player.Shuffle', function(obj) {
    if (obj.state.val === true) {
        SendRequest('/v1/me/player/shuffle?state=true', 'PUT', '', function() {})
    } else {
        SendRequest('/v1/me/player/shuffle?state=false', 'PUT', '', function() {})
    }
});
on('Player.TrackId', function(obj) {
    var send = {
        uris: ['spotify:track:' + obj.state.val],
        offset: {
            position: 0
        }
    };
    SendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function() {});
});
on('Player.Playlist_ID', function(obj) {
    var send = {
        context_uri: 'spotify:user:' + Application.User_ID + ':playlist:' +
            obj.state.val,
        offset: {
            position: 1
        }
    };
    SendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function() {});
});
on('Get_User_Playlists', function(obj) {
    GetUsersPlaylist(0)
});
on('Devices.Get_Devices', function(obj) {
    SendRequest('/v1/me/player/devices', 'GET', '', function(err, data) {
        if (!err) {
            CreateDevices(data)
        }
    });
});
on('Get_Playback_Info', function(obj) {
    SendRequest('/v1/me/player', 'GET', '', function(err, data) {
        if (!err) {
            CreatePlaybackInfo(data)
        }
    });
});
on('Authorization.Authorized', function(obj) {
    if (obj.state.val === true) {
        Application.Intervall = setInterval(function() {
            SendRequest('/v1/me/player', 'GET', '', function(err, data) {
                if (!err) {
                    adapter.log.debug('Intervall ' + err)
                    CreatePlaybackInfo(data)
                } else if (err == 202 || err == 502 || err == 401) { //202, 401 und 502 lassen den Interval  weiter laufen
                    var DummyBody = {
                        is_playing: false
                    };
                    // tritt ein wenn kein Player geöffnet ist
                    CreatePlaybackInfo(DummyBody)
                } else {
                    // andere Fehler stoppen den Intervall
                    clearInterval(Application.Intervall);
                    adapter.log.warn('Spotify Intervall gestoppt !');
                }
                // ein 502 Bad Gateway würde den intervall stoppen !! ändern
                // ????
            });
        }, 5000);
    } else {
        if ("undefined" !== typeof ApplicationIntervall) {
            clearInterval(Application.Intervall)
        }
    }
});
// on('Authorization.Login', function (obj){});
adapter.on('ready', function() {
    main();
});
adapter.on('stateChange', function(id, state) {
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    var found = false;
    var re = new RegExp(adapter.namespace + '*\.', 'g');
    var shrikId = id.replace(re, '');
    listener.forEach(function(value) {
        if ((value.name instanceof RegExp && value.name.test(shrikId)) || value.name ==
            shrikId) {
            found = true;
            value.func({
                id: shrikId,
                state: state
            });
            adapter.log.debug('call listener ' + value.name);
        }
    });
    if (!found) {
        adapter.log.debug('no listener for ' + shrikId + ' found');
    }
});
adapter.on('unload', function(callback) {
    try {
        adapter.log.debug('cleaned everything up...');
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
        if ("undefined" !== typeof Application.Intervall) {
            clearInterval(Application.Intervall)
        }
        callback();
    } catch (e) {
        callback();
    }
});