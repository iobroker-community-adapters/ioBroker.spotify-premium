# Older changes
## 1.4.0 (2024-04-02)
* (mcm1957) Adapter requires node.js 18 and js-controller >= 5 now
* (N1tR0) A problem has been fixed that did not correctly update the progress of playing media [#339]
* (mcm1957) Dependencies have been updated0

## 1.3.1 (2023-10-31)
-   (aruttkamp) A problem has been fixed which cause 'Error 400' with playUri errors [#259]

## 1.3.0 (2023-10-31)
-   (aruttkamp) A problem has been fixed which cause 'too many requests' errors [#241, #245]
-   (mcm1957) Adapter requires nodejs 16 now
-   (mcm1957) Testing has been changed to support node 16, 18 and 20
-   (mcm1957) Dependencies have been updated

## 1.2.2 (2022-06-17)
* (Apollon77) Fix potential crash cases reported by Sentry
* (Apollon77) Optimize adapter stop behaviour

## 1.2.1 (2022-05-12)
* (Apollon77) Prevent js-controller warnings

## 1.2.0 (2022-05-11)
* (duczz) Fix tracklist request issues
* (Apollon77) Fix several potential crash cases and object warnings
* (Apollon77) Add Sentry for crash reporting

## 1.1.9 (2021-11-21)
* (bluefox) Tried to catch 403 error

## 1.1.8 (2021-11-18)
* (ohle64) Fixed the shuffle behaviour 
* (bluefox) Allowed to set the default shuffle value
* (bluefox) The type of trackNo corrected

## 1.1.4 (2021-11-17)
* (bluefox) Fix errors

## 1.1.3 (2021-07-22)
* (bluefox) Improved authorization process

## 1.1.1 (2021-07-22)
* (bluefox) removed warnings for js-controller 3.x

## 1.1.0 (in dev)
* IMPORTANT: js-controller 2.0.0 is now required at least
* (twonky) added control widgets
* (twonky) added compact mode
* (Apollon77) Core Files/Testing Update and introduce adapter-core
* (twonky) added state `player.playUri` to support user defined input
* (Apollon77) Fix js-controller 3.3 warnings
* (Xyolyp) Listen on `player.volume` instead of player.device.volume as the latter is readonly
* (bellerG) fix player.playUri

## 1.0.0 (2018.12.18)
* (twonky) `playbackInfo` and `player` merged together to `player`
* (twonky) `player.volume` moved to `player.device.volume`
* (twonky) The `duration` format of `player.playlist.trackListArray` and `playlists.[playListName].trackListArray` was changed from milliseconds to time (MM:SS) and a new one was created for this `durationMs`.
* (twonky) The `album` of `player.playlist.trackListArray` and `playlists.[playListName].trackListArray` was changed to `artistName` and `artistArray`.
* (twonky) Several data was added to `player.playlist.trackListArray` and `playlists.[playListName].trackListArray`: `album`, `addedAt`, `addedBy`, `discNumber`, `episode`, `explicit` and `popularity`
* (twonky) change `player.playlist.trackNo` to start with 1 (0-based before)
* (twonky) performance optimization (states/objects are only set on change)
* (twonky) html lists added: `html.devices`, `html.playlists` and `html.tracks`
* (twonky) new icons

## 0.3.1 (2018.06.20)
* (twonky) Fix: state playlists.playlistList doesn't refresh after the playlist changed via app

## 0.3.0 (2018.05.31)
* (twonky) Change playlist and device state names from name to id
* (twonky) New states for device selection: `devices.deviceList`, `devices.deviceListIds`, `devices.deviceListString`, `devices.availableDeviceListIds`, `devices.availableDeviceListString`
* (twonky) New states for playlist selection: `playlists.playlistList`, `playlists.playlistListIds`, `playlists.playlistListString`, `playlists.yourPlaylistListIds`, `playlists.yourPlaylistListString`
* (twonky) Add option to avoid shuffle state reset on some devices after starting a playlist

## 0.2.5 (2018.05.24)
* (twonky) Fix: `playlists.YourPlaylistName.playThisList` starts always with second track

## 0.2.4 (2018.05.17)
* (twonky) remove special character ("'*) from device and playlist state names

## 0.2.3 (2018.05.17)
* (twonky) remove special character (,?[]) from device and playlist state names

## 0.2.2 (2018.05.16)
* (twonky) `playbackInfo.playlist.track*` States are only reset when changed; stop flickering of tracks SelectList (example "Choose track of current playlist")

## 0.2.1 (2018.05.14)
* (twonky) change state `player.shuffle` to string with possible values "on" and "off"

## 0.2.0 (2018.05.13)
* (twonky) removed support for deprecated state `PlaybackInfo.image_url`
* (twonky) all states improved and proper descriptions added

## 0.1.3 (2018.04.28)
* (twonky) fix spotify api change

## 0.1.2 (2018.04.10)
* (twonky) automatic updating of devices and playlists (configurable in the adapter)
* (twonky) new state `Devices.DEVICE.is_available` indicates if a device is available
* (twonky) shows warning message http 202 only as debug and only one time
* (twonky) the States `Player.Shuffle`,` Player.Playlist_ID`, `Player.TrackId` and` Player.Volume` also show the current value
* (twonky) new states `Playlists.PLAYLISTNAME.image_url`,` PlaybackInfo.Playlist_image_url`, `PlaybackInfo.Album_image_url`
* (twonky) marks the state `PlaybackInfo.image_url` as deprecated. Will not be included in a new installation and will not be updated in future versions
* (twonky) changing the State `Playlists.PLAYLISTNAME.Track_ID` now works like in Lucky's script

## 0.1.1 (2018.03.03)
* (twonky) fix several small issues

## 0.1.0 (2018.02.23)
* (twonky) rework api polling mechanism

## 0.0.9 (2018.02.21)
* (twonky) new state `PlaybackInfo.repeat` with possible values: off, context, track
* (twonky) new state `PlaybackInfo.shuffle` with possible values: true, false
* (twonky) states for the playing device will also updated in 5s intervals
* (twonky) states in `PlaybackInfo` are now updated also if no device is active playing
* (twonky) states in `PlaybackInfo` are now cleared if no device is available
* (twonky) loading new playlists if playing the first time

## 0.0.8 (2018.02.20)
* (twonky) new adapter option to delete no longer existing devices and playlists
* (twonky) load complete playlists (limitation of 100 first tracks was removed)

## 0.0.7 (2018.02.16)
* (twonky) fix: auto refresh token

## 0.0.6 (2018.02.16)
* (twonky) fix: playlist loading

## 0.0.5 (2018.02.16)
* (twonky) fix: fatal error if no open player

## 0.0.4 (2018.02.16)
* (twonky) check configuration
* (twonky) fix: adapter configuration in admin2
* (twonky) fix: restart after authorization need

## 0.0.3 (2018.02.15)
* (wendy2702) improved manual

## 0.0.2 (2018.02.11)
* (twonky) merge original script v0.5.3 by [Lucky](http://forum.iobroker.net/viewtopic.php?f=21&t=8173)

## 0.0.1 (2018.02.07)
* (twonky) initial adapter, original script v0.5.1 by [Lucky](http://forum.iobroker.net/viewtopic.php?f=21&t=8173)
