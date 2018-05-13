<img src="admin/spotify-premium.png" width="130" alt="Logo">

# ioBroker.spotify-premium

[![NPM version](https://img.shields.io/npm/v/iobroker.spotify-premium.svg)](https://www.npmjs.com/package/iobroker.spotify-premium)
[![Downloads](https://img.shields.io/npm/dm/iobroker.spotify-premium.svg)](https://www.npmjs.com/package/iobroker.spotify-premium)
[![Tests](http://img.shields.io/travis/twonky4/ioBroker.spotify-premium/master.svg)](https://travis-ci.org/twonky4/ioBroker.spotify-premium)

[![NPM](https://nodei.co/npm/iobroker.spotify-premium.png?downloads=true)](https://nodei.co/npm/iobroker.spotify-premium/)

=================

Adapter to access spotify playback controls. Because of the spotify API a premium account is necessary.

Connection to [Spotify Premium API](https://www.spotify.com/).

## Documentation
See also the [Spotify Developer API Documentation](https://developer.spotify.com/).
### Setup / Authorization
1. Sign in on https://developer.spotify.com
2. Create an application, you get a Client ID and a Client Secret
3. set the redirect URIs to `http://localhost` in your app settings at your created spotify application
4. put the Cliend ID and Client Secret in the fields down below
5. start the instance
6. switch to objects tab and push the button getAuthorization at `spotify-premium.X.authorization`
7. copy the appearing URL from `spotify-premium.X.authorization.authorizationUrl` to your webbrowser and call it
8. You maybe need to sign in to spotify and grant access
9. the browser will redirected to an invalid URL. If the error `invalid redirect uri` occurs please verify step 3
10. copy that url and put it to `spotify-premium.X.authorization.authorizationReturnUri`
11. the value in `spotify-premium.X.authorization.authorized` turns to true if everything was successful

### States
All states are descripted in admin.

In general there are a split between control and read-only states.
* `spotify-premium.X.playbackInfo.*` - Read only information of playback
* `spotify-premium.X.player.*` - Commands to control playback

### VIS usage
_...to be done..._

## Changelog

### 0.2.0 (2018.04.10)
* (twonky) removed support for deprecated state `PlaybackInfo.image_url`
* (twonky) all states improved and proper descriptions added

### 0.1.3 (2018.04.28)
* (twonky) fix spotify api change

### 0.1.2 (2018.04.10)
* (twonky) automatic updating of devices and playlists (configurable in the adapter)
* (twonky) new state `Devices.DEVICE.is_available` indicates if a device is available
* (twonky) shows warning message http 202 only as debug and only one time
* (twonky) the States `Player.Shuffle`,` Player.Playlist_ID`, `Player.TrackId` and` Player.Volume` also show the current value
* (twonky) new states `Playlists.PLAYLISTNAME.image_url`,` PlaybackInfo.Playlist_image_url`, `PlaybackInfo.Album_image_url`
* (twonky) marks the state `PlaybackInfo.image_url` as deprecated. Will not be included in a new installation and will not be updated in future versions
* (twonky) changing the State `Playlists.PLAYLISTNAME.Track_ID` now works like in Lucky's script

### 0.1.1 (2018.03.03)
* (twonky) fix several small issues

### 0.1.0 (2018.02.23)
* (twonky) rework api polling mechanism

### 0.0.9 (2018.02.21)
* (twonky) new state `PlaybackInfo.repeat` with possible values: off, context, track
* (twonky) new state `PlaybackInfo.shuffle` with possible values: true, false
* (twonky) states for the playing device will also updated in 5s intervals
* (twonky) states in `PlaybackInfo` are now updated also if no device is active playing
* (twonky) states in `PlaybackInfo` are now cleared if no device is available
* (twonky) loading new playlists if playing the first time

### 0.0.8 (2018.02.20)
* (twonky) new adapter option to delete no longer existing devices and playlists
* (twonky) load complete playlists (limitation of 100 first tracks was removed)

### 0.0.7 (2018.02.16)
* (twonky) fix: auto refresh token

### 0.0.6 (2018.02.16)
* (twonky) fix: playlist loading

### 0.0.5 (2018.02.16)
* (twonky) fix: fatal error if no open player

### 0.0.4 (2018.02.16)
* (twonky) check configuration
* (twonky) fix: adapter configuration in admin2
* (twonky) fix: restart after authorization need

### 0.0.3 (2018.02.15)
* (wendy2702) improved manual

### 0.0.2 (2018.02.11)
* (twonky) merge original script v0.5.3 by [Lucky](http://forum.iobroker.net/viewtopic.php?f=21&t=8173)

### 0.0.1 (2018.02.07)
* (twonky) initial adapter, original script v0.5.1 by [Lucky](http://forum.iobroker.net/viewtopic.php?f=21&t=8173)

## License
The MIT License (MIT)

Copyright (c) 2018 Alexander Kose <twonky4@gmx.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
