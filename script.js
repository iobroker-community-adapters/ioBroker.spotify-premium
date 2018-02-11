/*Version 0.5.0
letzte änderung 26.01.2018 16:48

Read Me !!!!!!!
wie bekomme ich dieses Skript zum laufen ? 

1.Registriere dich auch https://developer.spotify.com
2.Erstelle einen Application, du erhällst einen Client ID und eine Client Secret
3.trage in den App Settings deiner Application bei Redirect URIs 'http://localhost' ein
4.trage hier in diesem Skript deine Cliend ID und Client Secret ein
5.Starte dieses Skript
6.wechsle zum Tap Objekte und klicke unter 'javascript.0.Spotify.Authorization.Authorized' auf den Button Get_Authorization
7.Kopiere die unter 'javascript.0.Spotify.Authorization.Authorization_URL' angezeigte URL in einen  Webbrowser und rufe sie auf.
8.Der Browser wird die Verbindung ablehnen und in der Adresszeile eine URL zurückgeben
9.kopiere jetzt wider diese URL und füge sie im State 'javascript.0.Spotify.Authorization.Authorization_Return_URI' ein

*/
createState('javascript.0.Spotify.Player.Play', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Pause', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Skip_Plus', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Skip_Minus', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Repeat_Track', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Repeat_Context', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Repeat_off', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Player.Volume', 0, {
    type: "number",
    role: "Volume %"
});
createState('javascript.0.Spotify.Player.TrackId', '', {
    type: "string",
    role: "Track Id to Play"
});
createState('javascript.0.Spotify.Player.Playlist_ID', '', {
    type: "string",
    role: "Playlist Id to Play"
});
createState('javascript.0.Spotify.Player.Seek', 0, {
    type: "number",
    role: "Seek To Position (s)"
});
createState('javascript.0.Spotify.Player.Shuffle', false, {
    type: "boolean",
    role: "Shuffle"
});
createState('javascript.0.Spotify.Devices.Get_Devices', false, {
    type: "boolean",
    role: "button"
});
//createState('javascript.0.Spotify.Authorization.Login', false,{type: "boolean", role: "button"});
createState('javascript.0.Spotify.Authorization.Get_Authorization', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.Authorization.Authorization_URL', '', {
    type: "string",
    role: "Authorization_URL",
    write: false
});
createState('javascript.0.Spotify.Authorization.Authorization_Return_URI', '', {
    type: "string",
    role: "Authorization_Return_URI"
});
createState('javascript.0.Spotify.Authorization.User_ID', '', {
    type: "string",
    role: "User ID",
    write: false
});
createState('javascript.0.Spotify.Authorization.Authorized', false, {
    type: "boolean",
    role: "Authorized",
    write: false
});
createState('javascript.0.Spotify.Get_User_Playlists', false, {
    type: "boolean",
    role: "button"
});
createState('javascript.0.Spotify.PlaybackInfo.Track_Id', '', {
    type: "string",
    role: "Track Id",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Artist_Name', '', {
    type: "string",
    role: "Artist Name",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Type', '', {
    type: "string",
    role: "Type",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Album', '', {
    type: "string",
    role: "Album",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.timestamp', 0, {
    type: "number",
    role: "Timestamp",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.progress_ms', 0, {
    type: "number",
    role: "progress_ms",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.progress', 0, {
    type: "string",
    role: "progress",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.is_playing', false, {
    type: "boolean",
    role: "is_playing",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.image_url', '', {
    type: "string",
    role: "Image URL",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Track_Name', '', {
    type: "string",
    role: "Track_Name",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.duration_ms', 0, {
    type: "number",
    role: "Duration ms",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.duration', 0, {
    type: "string",
    role: "duration",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Device.id', '', {
    type: "string",
    role: "id",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Device.is_active', false, {
    type: "boolean",
    role: "is active",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Device.is_restricted', false, {
    type: "boolean",
    role: "is restricted",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Device.name', '', {
    type: "string",
    role: "Name",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Device.type', '', {
    type: "string",
    role: "Type",
    write: false
});
createState('javascript.0.Spotify.PlaybackInfo.Device.volume_percent', 0, {
    type: "number",
    role: "volume_percent",
    write: false
});
var request = require('request');
var querystring = require('querystring');
var fs = require('fs');
var Application = {
    User_ID: '', //Nichts eintragen !!
    BaseURL: 'https://api.spotify.com',
    Client_ID: 'HIER DEINE CLIENT ID',
    Client_Secret: 'HIER DEIN CLIENT SECRET',
    redirect_uri: 'http://localhost', // in älteren Versionen wird 'https://example.com/callback/' verwendet, 'http://localhost' ist eine Sichere Variante
    Token: '', //Nichts eintragen !!
    refresh_token: '', //Nichts eintragen !!
    code: '', //Nichts eintragen !!
    State: '' //Nichts eintragen !!
};
var Device_Data = {
    last_active_device_id: '',
    last_select_device_id: '',
};
//############### Initial ##########
ReadTokenFiles(function(err, Token) { //23.01.2018 Funktion überarbeitet 
    if (!err) {
        Application.Token = Token.AccessToken;
        Application.refresh_token = Token.RefreshToken;
        SendRequest('/v1/me', 'GET', '', function(err, data) {
            if (!err) {
                GetUserInformation(data);
                setState('javascript.0.Spotify.Authorization.Authorized', val = true, akt =
                    true);
                SendRequest('/v1/me/player/devices', 'GET', '', function(err, data) {
                    if (!err) {
                        CreateDevices(data)
                    }
                });
            } else {
                setState('javascript.0.Spotify.Authorization.Authorized', val = false, akt =
                    true);
                console.error('SendRequest in ReadTokenFiles ' + err);
            }
        });
    } else {
        setState('javascript.0.Spotify.Authorization.Authorized', val = false, akt = true);
        console.warn(err);
    }
});
//#################################
function ReadTokenFiles(callback) {
    var TokenFilePath = 'Spotify.token';
    fs.readFile(TokenFilePath, 'utf8', function(err, data) {
        if (!err) { //wenn keine Fehler
            var Token = JSON.parse(data);
            var ATF = "undefined" !== typeof Token.AccessToken && (Token.AccessToken !== '');
            var RTF = "undefined" !== typeof Token.RefreshToken && (Token.RefreshToken !== '');
            if (ATF && RTF) {
                console.log('Spotify Token aus Datei gelesen !');
                return callback(null, Token);
            } else {
                return callback('Keine Token in Datei gefunden !', null)
            }
        } else {
            return callback('keine Token-Datei gefunden !, wird erstellt nach Autorisierung  ', null)
        }
    });
} // End of Function ReadTokenFiles 
//###################################################################################### FUNCTION SEND REQUEST ###################################################################################
function SendRequest(Endpoint, Method, Send_Body, callback) {
    var options = {
        url: Application.BaseURL + Endpoint,
        method: Method,
        headers: {
            Authorization: 'Bearer ' + Application.Token
        },
        form: Send_Body
    };
    //console.log(options.form);
    //console.log('Spotify API Call...'+ Endpoint);
    request(options, function(error, response, body) {
        if (!error) {
            switch (response.statusCode) {
                case 200: // OK
                    return callback(null, JSON.parse(body));
                case 202: //Accepted, processing has not been completed.
                    return callback(response.statusCode, null);
                case 204: // OK, No Content
                    return callback(null, null);
                case 400: //Bad Request, message body will contain more information
                case 500: //Server Error
                case 503: //Service Unavailable
                case 404: //Not Found
                case 502: //Bad Gateway
                    return callback(response.statusCode, null);
                case 401: //Unauthorized 
                    if (JSON.parse(body).error.message == 'The access token expired') {
                        console.log('Access Token Abgelaufen!!');
                        Refresh_Token(Endpoint, Method, Send_Body, function(err, NewData) { //Daten des Akuellen Request werden Refresh_Token übergeben
                            if (!err) {
                                return callback(null, NewData); //Daten mit neuen Token
                            }
                        });
                    } else { //wenn anderer Fehler mit Code 401
                        setState('javascript.0.Spotify.Authorization.Authorized', val = false, akt =
                            true); // neu 05.01.2018
                        console.error(JSON.parse(body).error.message);
                        return callback(response.statusCode, null);
                    }
                    break;
                default:
                    console.warn('HTTP Request Fehler wird nicht behandelt, bitte Debuggen !!');
                    return callback(response.statusCode, null);
            }
        } else {
            console.error('erron in Request');
            return callback(0, null);
        }
    }); //end Request
} //End of Function SendRequest
//###################################################################################### END OF FUNCTION SEND REQUEST ###################################################################################
function CreatePlaybackInfo(P_Body) {
    setState('javascript.0.Spotify.PlaybackInfo.is_playing', val = P_Body.is_playing, akt = true);
    if ("undefined" !== typeof P_Body.device) {
        Device_Data.last_active_device_id = P_Body.device.id;
        setState('javascript.0.Spotify.PlaybackInfo.Device.id', val = P_Body.device.id, akt = true);
    }
    if (P_Body.is_playing === true) {
        setState('javascript.0.Spotify.PlaybackInfo.Track_Id', val = P_Body.item.id, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.Artist_Name', val = P_Body.item.artists[0].name, akt =
            true);
        setState('javascript.0.Spotify.PlaybackInfo.Type', val = P_Body.item.type, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.Album', val = P_Body.item.album.name, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.timestamp', val = P_Body.timestamp, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.progress_ms', val = P_Body.progress_ms, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.image_url', val = P_Body.item.album.images[0].url, akt =
            true);
        setState('javascript.0.Spotify.PlaybackInfo.Track_Name', val = P_Body.item.name, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.duration_ms', val = P_Body.item.duration_ms, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.duration', val = DigiClock(P_Body.item.duration_ms), akt =
            true);
        setState('javascript.0.Spotify.PlaybackInfo.progress', val = DigiClock(P_Body.progress_ms), akt =
            true);
        setState('javascript.0.Spotify.PlaybackInfo.Device.is_active', val = P_Body.device.is_active, akt =
            true);
        setState('javascript.0.Spotify.PlaybackInfo.Device.is_restricted', val = P_Body.device.is_restricted,
            akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.Device.name', val = P_Body.device.name, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.Device.type', val = P_Body.device.type, akt = true);
        setState('javascript.0.Spotify.PlaybackInfo.Device.volume_percent', val = P_Body.device.volume_percent,
            akt = true);
    }
} //End of Function CreatePlaybackInfo
function DigiClock(ms) {
    //Milisekunden zu Digitaluhr, Beispiel 3:59=238759
    var Min = Math.floor(ms / 60000);
    var Sec = Math.floor(((ms % 360000) % 60000) / 1000);
    if (Min < 10) {
        Min = '0' + Min
    }
    if (Sec < 10) {
        Sec = '0' + Sec
    }
    return Min + ':' + Sec;
} //End Function DigiClock
function GetUserInformation(P_Body) {
    Application.User_ID = P_Body.id;
    setState('javascript.0.Spotify.Authorization.User_ID', val = P_Body.id, akt = true);
} //End of Function GetUserInformation
function GetUsersPlaylist(offset) {
    if (Application.User_ID !== '') {
        var query = {
            limit: 10,
            offset: offset
        };
        SendRequest('/v1/users/' + Application.User_ID + '/playlists?' + querystring.stringify(query), 'GET',
            '',
            function(err, P_Body) {
                if (!err) {
                    for (i = 0; i < P_Body.items.length; i++) {
                        var Pfad = 'javascript.0.Spotify.Playlists.' + P_Body.items[i].name.replace(
                            /\s+/g, '');
                        if (getObject(Pfad + '.id') === null) { //verursacht Warnung 
                            createState(Pfad + '.Play_this_List', false, {
                                type: 'boolean',
                                role: 'button'
                            });
                            createState(Pfad + '.id', P_Body.items[i].id, {
                                type: 'string',
                                role: 'id',
                                write: false
                            });
                            createState(Pfad + '.owner', P_Body.items[i].owner.id, {
                                type: 'string',
                                role: 'owner',
                                write: false
                            });
                            createState(Pfad + '.name', P_Body.items[i].name, {
                                type: 'string',
                                role: 'Name',
                                write: false
                            });
                            createState(Pfad + '.tracks_total', P_Body.items[i].tracks.total, {
                                type: 'number',
                                role: 'tracks_total',
                                write: false
                            });
                        } else {
                            setState(Pfad + '.id', P_Body.items[i].id, akt = true);
                            setState(Pfad + '.owner', P_Body.items[i].owner.id, akt = true);
                            setState(Pfad + '.name', P_Body.items[i].name, akt = true);
                            setState(Pfad + '.tracks_total', P_Body.items[i].tracks.total, akt = true);
                        }
                        Get_Playlist_Tracks(P_Body.items[i].owner.id, P_Body.items[i].id, Pfad);
                    }
                    if (P_Body.items.length !== 0 && (P_Body['next'] !== null)) {
                        GetUsersPlaylist(P_Body.offset + P_Body.limit)
                    }
                } //if !err
            });
    }
} // End of Function GetUsersPlaylist
function Device_Handel(Device_Data) {
    if (Device_Data.last_select_device_id === "") {
        return Device_Data.last_active_device_id;
    } else {
        return Device_Data.last_select_device_id;
    }
}

function Get_Playlist_Tracks(owner, id, Pfad) { //NEU
    var reg_param = owner + '/playlists/' + id + '/tracks';
    var query = {
        fields: 'items.track.name,items.track.id,items.track.artists.name,total,offset',
        limit: 100,
        offset: 0
    };
    SendRequest('/v1/users/' + reg_param + '?' + querystring.stringify(query), 'GET', '', function(err, data) {
        if (!err) {
            var StateString = '';
            var Track_ID_String = '';
            for (i = 0; i < data.items.length; i++) {
                StateString = StateString + i.toString() + ':' + data.items[i].track.name + '-' +
                    data.items[i].track.artists[0].name + ';';
                Track_ID_String = Track_ID_String + i.toString() + ':' + data.items[i].track.id + ';';
            }
            createState(Pfad + '.Track_List', -1, {
                type: "number",
                role: "Tracks",
                states: StateString,
                Track_ID: Track_ID_String
            });
        }
    });
} //End of Function Get_Playlist_Tracks
function CreateDevices(P_Body) {
    for (i = 0; i < P_Body.devices.length; i++) {
        for (var ObjName in P_Body.devices[i]) {
            if (!getObject('javascript.0.Spotify.Devices.' + P_Body.devices[i].name.replace(/\s+/g, '') + '.' +
                    ObjName)) {
                createState('javascript.0.Spotify.Devices.' + P_Body.devices[i].name.replace(/\s+/g, '') +
                    '.' + ObjName, P_Body.devices[i][ObjName], {
                        type: typeof P_Body.devices[i][ObjName],
                        role: ObjName
                    });
                createState('javascript.0.Spotify.Devices.' + P_Body.devices[i].name.replace(/\s+/g, '') +
                    '.' + 'Use_for_Playback', false, {
                        type: 'boolean',
                        role: 'button'
                    });
            } else {
                setState('javascript.0.Spotify.Devices.' + P_Body.devices[i].name.replace(/\s+/g, '') + '.' +
                    ObjName, P_Body.devices[i][ObjName], akt = true)
            }
        }
    }
} //End of Function CreateDevices 
function generateRandomString(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function request_authorization() {
    Application.State = generateRandomString(20);
    var query = {
        client_id: Application.Client_ID,
        response_type: 'code',
        redirect_uri: Application.redirect_uri,
        state: Application.State,
        scope: 'user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-read-private'
    };
    var options = {
        url: 'https://accounts.spotify.com/de/authorize/?' + querystring.stringify(query),
        method: 'GET',
        followAllRedirects: true,
    };
    setState('javascript.0.Spotify.Authorization.Authorization_URL', val = options.url);
    var debug = false;
    if (debug) {
        request(options, function(error, response, body, formData) {
            // console.log(options.url);
            console.log('STATUS_CODE ' + response.statusCode);
            //console.log('RESPONSE*************'+JSON.stringify(response));
            //console.log('BODY*****'+body);
            //console.log('ERROR'+error);
            //console.log('FORM'+request.form);
            //console.log('HEADERS   *****'+JSON.stringify(response.headers));
            //console.log('HTML   *****'+JSON.stringify(response.html));
        });
    }
} // End of Function request_authorization
function GetToken() {
    var options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + Buffer.from(Application.Client_ID + ':' + Application.Client_Secret)
                .toString('base64')
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
                setState('javascript.0.Spotify.Authorization.Authorization_URL', val = '',
                    akt = true);
                setState('javascript.0.Spotify.Authorization.Authorization_Return_URI', val =
                    '', akt = true);
                setState('javascript.0.Spotify.Authorization.Authorized', val = true, akt =
                    true);
                Application.Token = Token.AccessToken;
                Application.refresh_token = Token.RefreshToken;
            } else {
                console.log(err)
            }
        });
    });
} //End of Function GetToken
function Refresh_Token(Endpoint, Method, Send_Body, callback) {
    console.log('Token wird erneut angefordert ! ');
    var options = {
        url: 'https://accounts.spotify.com/api/token',
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + Buffer.from(Application.Client_ID + ':' + Application.Client_Secret)
                .toString('base64')
        },
        form: {
            grant_type: 'refresh_token',
            refresh_token: Application.refresh_token
        }
    };
    if (Application.refresh_token !== '') {
        request(options, function(error, response, body) { // dieser Request holt den neuen Token
            if (response.statusCode == 200) {
                console.log('neuer Token eingetroffen');
                //console.log(body);
                var P_Body = JSON.parse(body);
                if (!P_Body.hasOwnProperty('refresh_token')) {
                    P_Body.refresh_token = Application.refresh_token
                }
                //console.log(JSON.stringify(P_Body))
                SaveToken(P_Body, function(err, Token) {
                    if (!err) {
                        Application.Token = Token.AccessToken;
                        //Application.refresh_token=Token.refresh_token;
                        SendRequest(Endpoint, Method, Send_Body, function(err, data) { // dieser Request holt die Daten die zuvor mit altem Token gefordert wurden
                            if (!err) {
                                console.log('Daten mit neuem Token');
                                return callback(null, data);
                            } else {
                                console.error(
                                    'FEHLER BEIM ERNEUTEN DATEN ANFORDERN !');
                                console.error('Fehler ' + err +
                                    ' Function Refresh_Token');
                                return callback(err, null);
                            }
                        });
                    } else {
                        console.log(err);
                        return callback(err, null);
                    }
                });
            }
        });
    } // end if   
} //End of Function Refresh_Token
function SaveToken(P_Body, callback) {
    //var ParsedBody=JSON.parse(Body);
    //console.log(ParsedBody.hasOwnProperty('access_token'))
    if ("undefined" !== typeof P_Body.access_token && ("undefined" !== typeof P_Body.refresh_token)) {
        var Token = {
            AccessToken: P_Body.access_token,
            RefreshToken: P_Body.refresh_token
        };
        fs.writeFile('Spotify.token', JSON.stringify(Token), 'utf8', function(err) {
            if (!err) {
                console.log('Token Saved!');
                return callback(null, Token);
            } else {
                return callback('Fehler beim Token Speichern', null)
            }
        });
    } else {
        return callback('keine Token in Serverantwort gefunden ! ', null)
    }
} //End of Function SaveToken
on({
    id: 'javascript.0.Spotify.Authorization.Authorization_Return_URI',
    change: "any"
}, function(obj) {
    if (!obj.state.ack) {
        var return_uri = querystring.parse(obj.state.val.slice(obj.state.val.search('[?]') + 1, obj.state
            .val.length));
        if (return_uri.state == Application.State) {
            Application.code = return_uri.code;
            GetToken();
        }
    }
});
on({
    id: 'javascript.0.Spotify.Authorization.Get_Authorization',
    val: true
}, function(obj) {
    request_authorization();
    setState('javascript.0.Spotify.Authorization.Authorized', val = false, akt = true);
});
on({
    id: /\.Use_for_Playback$/,
    val: true
}, function(obj) {
    Device_Data.last_select_device_id = getState(obj.id.slice(0, obj.id.lastIndexOf(".")) + '.id').val;
    var send = {
        device_ids: [Device_Data.last_select_device_id], //Divice IDs als Array !
        //play:false  //True = Wiedergabe startet sofort auf diesem Gerät, FALSE = Wiedergabe anhängig von Playback State
    };
    SendRequest('/v1/me/player', 'PUT', JSON.stringify(send), function(err, data) {});
});
on({
    id: /\.Track_List$/,
    valGe: 0,
    valNe: null,
    ack: false
}, function(obj) { //eine bestimmten Track aus Playliste  sofort abspielen
    var StateName = obj.common.Track_ID.split(';');
    var StateArr = [];
    for (var i = 0; i < StateName.length; i++) {
        var ele = StateName[i].split(':');
        StateArr[ele[0]] = ele[1];
    }
    if (StateArr[obj.state.val] !== '' && (StateArr[obj.state.val] !== null)) {
        var send = {
            uris: ['spotify:track:' + StateArr[obj.state.val]],
            offset: {
                position: 0
            }
        };
        SendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function(err) {
            if (!err) {
                setState(obj.id, obj.state.val, ack = true)
            }
        });
    }
});
on({
    id: /\.Play_this_List$/,
    val: true
}, function(obj) { //eine bestimmte Playlist sofort abspielen
    var send = {
        context_uri: 'spotify:user:' + getState(obj.id.slice(0, obj.id.lastIndexOf(".")) +
            '.owner').val + ':playlist:' + getState(obj.id.slice(0, obj.id.lastIndexOf(".")) +
            '.id').val,
        offset: {
            position: 1
        }
    };
    var query = {
        device_id: Device_Handel(Device_Data)
    };
    SendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT', JSON.stringify(send),
        function() {
            SendRequest('/v1/me/player', 'GET', '', function(err, data) {
                if (!err) {
                    CreatePlaybackInfo(data)
                }
            });
        });
});
on({
    id: 'javascript.0.Spotify.Player.Play',
    val: true
}, function(obj) {
    var query = {
        device_id: Device_Handel(Device_Data)
    };
    SendRequest('/v1/me/player/play?' + querystring.stringify(query), 'PUT', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Pause',
    val: true
}, function(obj) {
    var query = {
        device_id: Device_Handel(Device_Data)
    };
    SendRequest('/v1/me/player/pause?' + querystring.stringify(query), 'PUT', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Skip_Plus',
    val: true
}, function(obj) {
    var query = {
        device_id: Device_Handel(Device_Data)
    };
    SendRequest('/v1/me/player/next?' + querystring.stringify(query), 'POST', '', function(err, data) {});
});
on({
    id: 'javascript.0.Spotify.Player.Skip_Minus',
    val: true
}, function(obj) {
    var query = {
        device_id: Device_Handel(Device_Data)
    };
    SendRequest('/v1/me/player/previous?' + querystring.stringify(query), 'POST', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Repeat_Track',
    val: true
}, function(obj) {
    SendRequest('/v1/me/player/repeat?state=track', 'PUT', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Repeat_Context',
    val: true
}, function(obj) {
    SendRequest('/v1/me/player/repeat?state=context', 'PUT', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Repeat_off',
    val: true
}, function(obj) {
    SendRequest('/v1/me/player/repeat?state=off', 'PUT', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Volume'
}, function(obj) {
    SendRequest('/v1/me/player/volume?volume_percent=' + obj.state.val, 'PUT', '', function(err) {
        if (!err) {
            // setState('javascript.0.Spotify.Player.Volume', true/*ack*/);
        }
    });
});
on({
    id: 'javascript.0.Spotify.Player.Seek'
}, function(obj) {
    SendRequest('/v1/me/player/seek?position_ms=' + obj.state.val * 1000, 'PUT', '', function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Shuffle'
}, function(obj) {
    if (obj.state.val === true) {
        SendRequest('/v1/me/player/shuffle?state=true', 'PUT', '', function() {})
    } else {
        SendRequest('/v1/me/player/shuffle?state=false', 'PUT', '', function() {})
    }
});
on({
    id: 'javascript.0.Spotify.Player.TrackId'
}, function(obj) {
    var send = {
        uris: ['spotify:track:' + obj.state.val],
        offset: {
            position: 0
        }
    };
    SendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function() {});
});
on({
    id: 'javascript.0.Spotify.Player.Playlist_ID'
}, function(obj) {
    var send = {
        context_uri: 'spotify:user:' + Application.User_ID + ':playlist:' + obj.state.val,
        offset: {
            position: 1
        }
    };
    SendRequest('/v1/me/player/play', 'PUT', JSON.stringify(send), function() {});
});
on({
    id: 'javascript.0.Spotify.Get_User_Playlists'
}, function(obj) {
    GetUsersPlaylist(0)
});
on({
    id: 'javascript.0.Spotify.Devices.Get_Devices'
}, function(obj) {
    SendRequest('/v1/me/player/devices', 'GET', '', function(err, data) {
        if (!err) {
            CreateDevices(data)
        }
    });
});
on({
    id: 'javascript.0.Spotify.Get_Playback_Info'
}, function(obj) {
    SendRequest('/v1/me/player', 'GET', '', function(err, data) {
        if (!err) {
            CreatePlaybackInfo(data)
        }
    });
});
on({
    id: 'javascript.0.Spotify.Authorization.Authorized'
}, function(obj) {
    if (obj.state.val === true) {
        Intervall = setInterval(function() {
            SendRequest('/v1/me/player', 'GET', '', function(err, data) {
                if (!err) {
                    CreatePlaybackInfo(data)
                } else if (err == 202 || (err == 502)) {
                    DummyBody = {
                        is_playing: false
                    }; //tritt ein wenn kein Player geöffnet ist
                    CreatePlaybackInfo(DummyBody)
                } else {
                    clearInterval(Intervall);
                    console.warn('Spotify Intervall gestoppt !');
                } // ein 502 Bad Gateway würde den intervall stoppen !! ändern ????
            });
        }, 5000);
    } else {
        if ("undefined" !== typeof Intervall) {
            clearInterval(Intervall)
        }
    }
});
on({
    id: 'javascript.0.Spotify.Authorization.Login'
}, function(obj) {});
onStop(function() {
    setState('javascript.0.Spotify.Authorization.Authorization_URL', val = '', akt = true);
    setState('javascript.0.Spotify.Authorization.Authorization_Return_URI', val = '', akt = true);
    setState('javascript.0.Spotify.Player.TrackId', val = '', akt = true);
    setState('javascript.0.Spotify.Player.Playlist_ID', val = '', akt = true);
    setState('javascript.0.Spotify.Authorization.User_ID', val = '', akt = true);
    setState('javascript.0.Spotify.Authorization.Authorized', val = false, akt = true);
    if ("undefined" !== typeof Intervall) {
        clearInterval(Intervall)
    }
}, 1000 /*ms*/ );