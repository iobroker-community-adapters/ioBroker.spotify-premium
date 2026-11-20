"use strict";
/**
 * The answer of the message "help": what the instance does and how it is controlled, written for an AI agent (e.g.
 * ioBroker.pi-agent, or the MCP server with `send_to`) and for script authors. Keep it in sync with `onMessage` and
 * the state listeners (`this.cache.on(...)`) in main.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP = exports.COMMANDS = void 0;
exports.helpText = helpText;
/** The commands `onMessage` answers. write: true if the command has an effect */
exports.COMMANDS = [
    { command: 'help', write: false },
    { command: 'search', write: false },
    { command: 'getDevices', write: false },
    { command: 'getPlaylists', write: false },
    { command: 'play', write: true },
];
exports.HELP = `ioBroker.spotify-premium: controls the playback of a Spotify Premium account over the Spotify Web API (Spotify
Connect): chooses the device that plays (phone, computer, speaker, TV, Echo...), plays playlists, albums, artists,
tracks, podcast shows and episodes, pauses, skips, seeks, sets shuffle, repeat and volume, and shows what plays.
The messages search the Spotify catalog and play with an answer; everything else is done by writing states. The
instance must be authorized in its settings.

Commands (sendTo spotify-premium.0; each answers, an error as {error, reason}):
- help: this text; answer {help, commands: [{command, write}]}.
- search {query?, track?, artist?, album?, year?, genre?, type?, limit?, offset?}: searches the Spotify catalog.
  query is free text; track, artist, album, year and genre narrow the search; at least one is needed. type: "track"
  (default), "album", "artist", "playlist", "show", "episode" or "audiobook", several comma separated. limit 1..10
  (default 5; Spotify allows at most 10 since February 2026), offset for the next results. Answers {items: [{type,
  uri, id, name, artists?, album?, durationMs?, explicit?, releaseDate?, totalTracks?, owner?, publisher?, image?}]},
  each type in the order of Spotify (the best match first).
- play {uri?, offset?, positionMs?, device?} (write): plays a URI or an open.spotify.com link. A track or an episode
  plays alone, an album, artist, playlist or show as a whole; an array of track URIs plays these in a row. offset:
  the number of the track in it (0 = first) or the URI of a track in it; positionMs: where to start. device: name or
  id of a Spotify Connect device (see getDevices), without it the active one plays; a device that did not play for a
  while gets the playback transferred first. Without uri it resumes. Answers {ok: true, device: {id, name}} or
  {error, reason}: reason NO_ACTIVE_DEVICE (no device named and none active, or the device sleeps),
  DEVICE_NOT_FOUND (with devices: the names), DEVICE_NOT_CONTROLLABLE, PREMIUM_REQUIRED, NOT_AUTHORIZED,
  RATE_LIMITED, BAD_REQUEST, ...
- getDevices: asks Spotify for the devices now (and updates devices.*), {devices: [{id, name, type, isActive,
  isRestricted, volume, supportsVolume}]}.
- getPlaylists {search?}: the playlists of the account the adapter knows (playlists.*), {playlists: [{uri, id, name,
  ownerId, tracksTotal, image}]}; search keeps those whose name contains the text.

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
  The surest way to play X on device Y is the message play {uri, device}: it answers whether it worked.
- playlists.<playlist>: the playlists of the account (own and followed); <playlist> = <ownerId>-<playlistId>
  without special characters, common.name and the state name = its name. States: id, owner, tracksTotal, imageUrl,
  trackListStates ("0:title - artist;1:title - artist;..."), playThisList (button: plays the playlist), trackList
  (number: plays the playlist from that track, 0-based). playlists.playlistList = "<playlist>" plays it too;
  playlists.playlistListIds / playlists.playlistListString list them (";"). getPlaylists (button): reads them again.
- player.trackId = "<track id>": plays that one track. player.playlist.trackNo (1-based) or player.playlist.trackList
  (0-based): plays that track of the playlist that plays. player.playlist.id starts that playlist (write its owner to
  player.playlist.owner first; the owner alone starts nothing). Both are for vis: to play a playlist by its ID use
  player.playUri spotify:playlist:<id>.
  These, playThisList and playlistList send no device: they play on the active device, so choose the device first
  (useForPlayback) and wait until player.device.name shows it.
Control (on the active device; play, pause, next and previous on the chosen one):
- player.play / player.pause (buttons, true): resume / pause. player.state = true resumes, false pauses.
- player.skipPlus / player.skipMinus (buttons): next / previous track.
- player.progressMs (ms) or player.progressPercentage (0-100): jump to that position.
- player.shuffle = "on" / "off", or the buttons player.shuffleOn / player.shuffleOff, or player.shuffleBool = true /
  false.
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
- What to play: a song: search {track, artist} (as the user named them, type track) and play the uri of the best
  item. "Music of <artist>": search type artist, play its uri. The user's playlists: getPlaylists (or playlists.*) by
  name, else search type playlist. Say what you picked when you play it; if it was the wrong one, offer the next
  items of the search.
- Play, pause, skip and change the volume only on the user's request: it is the user's account (it also changes
  what plays on the phone). Loud (volume above about 50) only when asked.
- After a command read player.* again (a few seconds later) before saying that it plays.
- "What is playing": "<trackName> by <artistName> (<playlist or album>) on <device name>, playing, 1:23 of 3:45".
- Not authorized: tell the user to authorize the instance in its settings (Get Spotify access); an agent cannot.`;
/**
 * The text of `help` for an instance: HELP names `spotify-premium.0`
 *
 * @param ns the namespace of the instance, e.g. `spotify-premium.1`
 */
function helpText(ns) {
    return exports.HELP.replace(/spotify-premium\.0/g, ns);
}
//# sourceMappingURL=help.js.map