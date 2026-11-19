"use strict";
/**
 * The answer of the message "help": what the instance does and how it is controlled, written for an AI agent (e.g.
 * ioBroker.pi-agent, or the MCP server with `send_to`) and for script authors. Keep it in sync with `onMessage` and
 * the state listeners (`this.cache.on(...)`) in main.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP = exports.COMMANDS = void 0;
/** The commands `onMessage` answers. write: true if the command has an effect */
exports.COMMANDS = [{ command: 'help', write: false }];
exports.HELP = `ioBroker.spotify-premium: controls the playback of a Spotify Premium account over the Spotify Web API (Spotify
Connect): chooses the device that plays (phone, computer, speaker, TV, Echo...), plays playlists, albums, artists,
tracks, podcast shows and episodes, pauses, skips, seeks, sets shuffle, repeat and volume, and shows what plays.
All of that is done by writing states; the only message is help. The instance must be authorized in its settings.

Commands (sendTo spotify-premium.0):
- help: this text; answer {help, commands: [{command, write}]}.

States (spotify-premium.0.*): write the commands with ack false; they are not acknowledged and give no error back
(errors go to the log). About 1 s after a command the adapter reads the playback into player.* (else it polls it
every 10 s by default).
Devices (Spotify Connect lists only devices that are switched on and logged in to the account):
- devices.<device>: one object of type device per device seen; <device> = its Spotify device ID without special
  characters, common.name = its name. States: name, type (Computer, Smartphone, Speaker), id (the Spotify device
  ID), isAvailable (in the last device list), isActive (it plays), isRestricted (cannot be controlled), volume (%),
  useForPlayback (button; missing on restricted devices).
- devices.availableDeviceListIds / devices.availableDeviceListString: the available devices, <device> and name in
  the same order, separated by ";". getDevices (button): reads the device list now (else every 5 min by default).
- devices.<device>.useForPlayback = true, or devices.deviceList = "<device>": moves the playback to that device and
  plays there (what played last).
Play something (Spotify URIs; a link https://open.spotify.com/<kind>/<id> is the URI spotify:<kind>:<id>):
- player.playUri (string): spotify:playlist:<id>, spotify:album:<id>, spotify:artist:<id> or spotify:show:<id> plays
  that from its start; spotify:track:<id> or spotify:episode:<id> plays one track or episode. Or a JSON text as the
  body of "start playback" of the Spotify API, plus device_id: {"device_id": "<value of devices.<device>.id>",
  "context_uri": "spotify:album:<id>", "offset": {"position": 4}} (position 0-based), or {"device_id": "...",
  "uris": ["spotify:track:<id>", ...], "position_ms": 0}. It plays on the device_id of the JSON, else on the device
  last chosen with useForPlayback / deviceList since the instance started, else on the active device.
  The surest way to play X on device Y: JSON with device_id and context_uri (or uris) in one write.
- playlists.<playlist>: the playlists of the account (own and followed); <playlist> = <ownerId>-<playlistId>
  without special characters, common.name and the state name = its name. States: id, owner, tracksTotal, imageUrl,
  trackListStates ("0:title - artist;1:title - artist;..."), playThisList (button: plays the playlist), trackList
  (number: plays the playlist from that track, 0-based). playlists.playlistList = "<playlist>" plays it too;
  playlists.playlistListIds / playlists.playlistListString list them (";"). getPlaylists (button): reads them again.
- player.trackId = "<track id>": plays that one track. player.playlist.trackNo (1-based) or player.playlist.trackList
  (0-based): plays that track of the playlist that plays. player.playlist.owner and player.playlist.id (each write
  starts the playlist of both) are for vis: to play a playlist by its ID use player.playUri spotify:playlist:<id>.
  These, playThisList and playlistList send no device: they play on the active device, so choose the device first
  (useForPlayback) and wait until player.device.name shows it.
Control (on the active device; play, pause, next and previous on the chosen one):
- player.play / player.pause (buttons, true): resume / pause. player.state = true resumes (false does nothing).
- player.skipPlus / player.skipMinus (buttons): next / previous track.
- player.progressMs (ms) or player.progressPercentage (0-100): jump to that position.
- player.shuffle = "on" / "off", or the buttons player.shuffleOn / player.shuffleOff; player.shuffleBool = true turns
  it on (false does nothing).
- player.repeat = "off" / "context" (the playlist or album) / "track"; or player.repeatMode = 0 off, 1 all, 2 one;
  or the buttons player.repeatOff / player.repeatContext / player.repeatTrack.
- player.volume (0-100 %): only while something plays; some devices (e.g. phones) do not allow it.
What plays (read):
- player.isPlaying (true / false), player.trackName, player.artistName (several: comma separated), player.album
  (an episode: the show), player.type (album, artist, playlist, track, show, episode), player.contextDescription
  (e.g. "Playlist: <name>"), player.playlist.name, player.trackId, player.progress and player.duration (mm:ss),
  player.progressMs, player.durationMs, player.durationSec, player.shuffle, player.repeat, player.albumImageUrl.
- player.device.name / type / id / volume / isActive: the device that plays; name empty = no device is active.
- authorization.authorized and info.connection false: not authorized (authorization.error tells why).
- getPlaybackInfo (button): reads the playback now.

How to talk to the user:
- Which device: if the user names none and more than one device is available, ask which one; do not guess and do
  not take the one of an earlier request. Name devices and playlists by their names, never by IDs. A device that is
  missing is off or not logged in: ask the user to open Spotify on it, then press getDevices.
- What to play: the adapter cannot search. Take the user's playlists from playlists.* by name; for anything else
  ask for a Spotify link or find the URI (e.g. with a web search) and say what you picked when you play it.
- Play, pause, skip and change the volume only on the user's request: it is the user's account (it also changes
  what plays on the phone). Loud (volume above about 50) only when asked.
- After a command read player.* again (a few seconds later) before saying that it plays.
- "What is playing": "<trackName> by <artistName> (<playlist or album>) on <device name>, playing, 1:23 of 3:45".
- Not authorized: tell the user to authorize the instance in its settings (Get Spotify access); an agent cannot.`;
//# sourceMappingURL=help.js.map