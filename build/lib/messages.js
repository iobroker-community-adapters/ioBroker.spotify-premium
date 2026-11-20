"use strict";
/**
 * Helpers for the messages (sendTo) of the adapter: search in the Spotify catalog, start playback on a Spotify
 * Connect device, list devices and playlists. Pure functions, so that they can be tested without Spotify.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_LIMIT_DEFAULT = exports.SEARCH_LIMIT_MAX = exports.SEARCH_TYPES = void 0;
exports.spotifyError = spotifyError;
exports.cleanDeviceId = cleanDeviceId;
exports.searchTypes = searchTypes;
exports.buildSearchQuery = buildSearchQuery;
exports.searchParams = searchParams;
exports.pickImage = pickImage;
exports.normalizeItem = normalizeItem;
exports.normalizeSearchResult = normalizeSearchResult;
exports.parseSpotifyUri = parseSpotifyUri;
exports.playBody = playBody;
exports.normalizeDevices = normalizeDevices;
exports.fold = fold;
exports.findDevice = findDevice;
exports.messageError = messageError;
/** The item types the search endpoint knows */
exports.SEARCH_TYPES = ['track', 'album', 'artist', 'playlist', 'show', 'episode', 'audiobook'];
/** Spotify allows at most 10 results per search request since February 2026 (it was 50) */
exports.SEARCH_LIMIT_MAX = 10;
/** The default of Spotify since February 2026 */
exports.SEARCH_LIMIT_DEFAULT = 5;
/** The field filters of the search ("track:Doxy artist:Miles Davis") */
const FILTERS = ['track', 'artist', 'album', 'year', 'genre'];
/** Items that play as a context (album, playlist, ...), the others (track, episode) are played as a list of URIs */
const CONTEXT_TYPES = ['album', 'artist', 'playlist', 'show', 'audiobook'];
const ITEM_TYPES = ['track', 'episode'];
/**
 * Create the error for an HTTP status of the Spotify Web API. The message stays the status (other code checks it with
 * `includes('404')`), the body of Spotify goes into `reason` and `detail`.
 *
 * @param status HTTP status
 * @param body parsed body of the response
 */
function spotifyError(status, body) {
    const error = new Error(String(status));
    error.status = status;
    const inner = body?.error;
    if (inner && typeof inner === 'object') {
        if (typeof inner.reason === 'string' && inner.reason) {
            error.reason = inner.reason;
        }
        if (typeof inner.message === 'string' && inner.message) {
            error.detail = inner.message;
        }
    }
    else if (typeof inner === 'string') {
        // the token endpoint answers {error: "invalid_grant", error_description: "..."}
        error.detail = body.error_description || inner;
    }
    return error;
}
/**
 * Remove the suffixes of Amazon Echo (_amzn_1, _amzn_2, ...) from a device id: Spotify reports them but rejects them in
 * playback commands.
 *
 * @param id device id
 */
function cleanDeviceId(id) {
    return (id || '').replace(/_amzn_\d+$/, '');
}
function text(value) {
    if (typeof value === 'number') {
        return String(value);
    }
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Normalize the asked types of a search
 *
 * @param type one type, several comma separated or an array
 * @returns the types or an error text
 */
function searchTypes(type) {
    let list;
    if (Array.isArray(type)) {
        list = type.map(t => text(t).toLowerCase());
    }
    else {
        list = text(type)
            .toLowerCase()
            .split(/[\s,;]+/);
    }
    list = list.filter(Boolean);
    if (!list.length) {
        return ['track'];
    }
    const result = [];
    for (const item of list) {
        // "tracks" or "songs" are clear enough
        const t = item === 'song' || item === 'songs' ? 'track' : item.replace(/s$/, '');
        if (!exports.SEARCH_TYPES.includes(t)) {
            return `Unknown type "${item}", known: ${exports.SEARCH_TYPES.join(', ')}`;
        }
        if (!result.includes(t)) {
            result.push(t);
        }
    }
    return result;
}
/**
 * Build the `q` of a search: the free text and the field filters (`track:Doxy artist:Miles Davis`, the form of the
 * Spotify documentation).
 *
 * @param req the request
 */
function buildSearchQuery(req) {
    const parts = [];
    const query = text(req.query);
    if (query) {
        parts.push(query);
    }
    for (const filter of FILTERS) {
        // a colon in the value would start another filter
        const value = text(req[filter]).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
        if (value) {
            parts.push(`${filter}:${value}`);
        }
    }
    return parts.join(' ');
}
function clamp(value, min, max, def) {
    const n = typeof value === 'number' ? value : parseInt(text(value), 10);
    if (!Number.isFinite(n)) {
        return def;
    }
    return Math.max(min, Math.min(max, Math.round(n)));
}
/**
 * The query string of GET /v1/search for a request
 *
 * @param req the request
 * @returns the parameters and the types, or an error
 */
function searchParams(req) {
    if (!req || typeof req !== 'object') {
        return { error: 'Expected {query, type?, limit?, ...}', reason: 'BAD_REQUEST' };
    }
    const q = buildSearchQuery(req);
    if (!q) {
        return { error: 'Nothing to search: give query, track, artist, album, year or genre', reason: 'BAD_REQUEST' };
    }
    const types = searchTypes(req.type);
    if (typeof types === 'string') {
        return { error: types, reason: 'BAD_REQUEST' };
    }
    const params = {
        q,
        type: types.join(','),
        limit: String(clamp(req.limit, 1, exports.SEARCH_LIMIT_MAX, exports.SEARCH_LIMIT_DEFAULT)),
    };
    const offset = clamp(req.offset, 0, 1000, 0);
    if (offset) {
        params.offset = String(offset);
    }
    const market = text(req.market);
    if (market) {
        params.market = market;
    }
    return { params, types };
}
/**
 * Pick an image of about 300 px: Spotify lists them from the widest to the smallest (640, 300, 64).
 *
 * @param images the images of an item
 */
function pickImage(images) {
    if (!Array.isArray(images) || !images.length) {
        return undefined;
    }
    const valid = images.filter(img => img && typeof img.url === 'string' && img.url);
    if (!valid.length) {
        return undefined;
    }
    const medium = valid.find(img => typeof img.width === 'number' && img.width > 0 && img.width <= 320);
    return (medium || valid[0]).url;
}
function names(list) {
    if (!Array.isArray(list)) {
        return undefined;
    }
    const result = list.map(item => text(item?.name)).filter(Boolean);
    return result.length ? result : undefined;
}
function setIf(item, key, value) {
    if (value !== undefined && value !== null && value !== '') {
        item[key] = value;
    }
}
/**
 * Convert one item of a search result
 *
 * @param type the type of the list it came in
 * @param raw the item of Spotify
 */
function normalizeItem(type, raw) {
    // Spotify puts null into the lists of playlists and episodes for items that are not available
    if (!raw || typeof raw !== 'object' || !raw.uri || !raw.id) {
        return null;
    }
    const item = { type, uri: raw.uri, id: raw.id, name: text(raw.name) };
    switch (type) {
        case 'track':
            setIf(item, 'artists', names(raw.artists));
            setIf(item, 'album', text(raw.album?.name));
            setIf(item, 'durationMs', typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined);
            setIf(item, 'explicit', typeof raw.explicit === 'boolean' ? raw.explicit : undefined);
            setIf(item, 'releaseDate', text(raw.album?.release_date));
            setIf(item, 'image', pickImage(raw.album?.images));
            break;
        case 'album':
            setIf(item, 'artists', names(raw.artists));
            setIf(item, 'releaseDate', text(raw.release_date));
            setIf(item, 'totalTracks', typeof raw.total_tracks === 'number' ? raw.total_tracks : undefined);
            setIf(item, 'image', pickImage(raw.images));
            break;
        case 'artist':
            setIf(item, 'image', pickImage(raw.images));
            break;
        case 'playlist': {
            setIf(item, 'owner', text(raw.owner?.display_name) || text(raw.owner?.id));
            setIf(item, 'ownerId', text(raw.owner?.id));
            // since February 2026 "items" instead of "tracks"
            const total = raw.items?.total ?? raw.tracks?.total;
            setIf(item, 'totalTracks', typeof total === 'number' ? total : undefined);
            setIf(item, 'image', pickImage(raw.images));
            break;
        }
        case 'show':
            setIf(item, 'publisher', text(raw.publisher));
            setIf(item, 'totalTracks', typeof raw.total_episodes === 'number' ? raw.total_episodes : undefined);
            setIf(item, 'image', pickImage(raw.images));
            break;
        case 'episode':
            setIf(item, 'durationMs', typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined);
            setIf(item, 'explicit', typeof raw.explicit === 'boolean' ? raw.explicit : undefined);
            setIf(item, 'releaseDate', text(raw.release_date));
            setIf(item, 'image', pickImage(raw.images));
            break;
        case 'audiobook':
            setIf(item, 'artists', names(raw.authors));
            setIf(item, 'publisher', text(raw.publisher));
            setIf(item, 'image', pickImage(raw.images));
            break;
    }
    return item;
}
/**
 * Flatten the answer of GET /v1/search: the items of every asked type, in the order of the types, each list in the
 * order of Spotify (the best match first).
 *
 * @param data the answer of Spotify
 * @param types the asked types
 */
function normalizeSearchResult(data, types) {
    const items = [];
    for (const type of types) {
        const list = data?.[`${type}s`]?.items;
        if (!Array.isArray(list)) {
            continue;
        }
        for (const raw of list) {
            const item = normalizeItem(type, raw);
            if (item) {
                items.push(item);
            }
        }
    }
    return items;
}
/**
 * Read a Spotify URI or an open.spotify.com link
 *
 * @param input e.g. `spotify:track:4uLU6hMCjMI75M1A2tKUQC`, `spotify:user:<owner>:playlist:<id>` or
 *   `https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=...`
 * @returns type, id and the URI to send to Spotify, or null
 */
function parseSpotifyUri(input) {
    const value = text(input);
    if (!value) {
        return null;
    }
    const link = value.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|artist|playlist|show|episode|audiobook)\/([A-Za-z0-9]+)/i);
    if (link) {
        const type = link[1].toLowerCase();
        return { type, id: link[2], uri: `spotify:${type}:${link[2]}` };
    }
    const uri = value.match(/^spotify:(?:user:[^:]+:)?(track|album|artist|playlist|show|episode|audiobook):([A-Za-z0-9]+)$/i);
    if (uri) {
        // the old form spotify:user:<owner>:playlist:<id> still works, send it as it came
        return { type: uri[1].toLowerCase(), id: uri[2], uri: value };
    }
    return null;
}
/**
 * The body of PUT /v1/me/player/play for a `play` message
 *
 * @param req the message
 * @returns the body (empty = resume) or an error
 */
function playBody(req) {
    if (req !== undefined && req !== null && typeof req !== 'object') {
        return { error: 'Expected {uri?, device?, offset?, positionMs?}', reason: 'BAD_REQUEST' };
    }
    const r = req || {};
    const body = {};
    const list = Array.isArray(r.uri) ? r.uri : Array.isArray(r.uris) ? r.uris : null;
    if (list) {
        const uris = [];
        for (const entry of list) {
            const parsed = parseSpotifyUri(entry);
            if (!parsed) {
                return { error: `Not a Spotify URI: ${String(entry)}`, reason: 'BAD_REQUEST' };
            }
            if (!ITEM_TYPES.includes(parsed.type)) {
                return {
                    error: `Only tracks and episodes can be played as a list, not ${parsed.type}: ${String(entry)}`,
                    reason: 'BAD_REQUEST',
                };
            }
            uris.push(parsed.uri);
        }
        if (!uris.length) {
            return { error: 'The list of URIs is empty', reason: 'BAD_REQUEST' };
        }
        body.uris = uris;
    }
    else if (r.uri !== undefined && r.uri !== null && r.uri !== '') {
        const parsed = parseSpotifyUri(r.uri);
        if (!parsed) {
            return { error: `Not a Spotify URI: ${String(r.uri)}`, reason: 'BAD_REQUEST' };
        }
        if (CONTEXT_TYPES.includes(parsed.type)) {
            body.context_uri = parsed.uri;
        }
        else {
            // a single track or episode cannot be played as context
            body.uris = [parsed.uri];
        }
    }
    if (r.offset !== undefined && r.offset !== null && r.offset !== '') {
        const position = typeof r.offset === 'number' ? r.offset : /^\d+$/.test(text(r.offset)) ? Number(r.offset) : NaN;
        if (Number.isFinite(position) && position >= 0) {
            if (body.context_uri || (body.uris && body.uris.length > 1)) {
                body.offset = { position: Math.floor(position) };
            }
        }
        else {
            const parsed = parseSpotifyUri(r.offset);
            if (!parsed || !ITEM_TYPES.includes(parsed.type)) {
                return {
                    error: `offset must be a number or the URI of a track: ${String(r.offset)}`,
                    reason: 'BAD_REQUEST',
                };
            }
            if (!body.context_uri) {
                return { error: 'offset as URI needs the uri of an album, playlist or show', reason: 'BAD_REQUEST' };
            }
            body.offset = { uri: parsed.uri };
        }
    }
    if (r.positionMs !== undefined && r.positionMs !== null && r.positionMs !== '') {
        const ms = typeof r.positionMs === 'number' ? r.positionMs : Number(r.positionMs);
        if (!Number.isFinite(ms) || ms < 0) {
            return {
                error: `positionMs must be a number of milliseconds: ${String(r.positionMs)}`,
                reason: 'BAD_REQUEST',
            };
        }
        body.position_ms = Math.floor(ms);
    }
    return { body };
}
/**
 * The devices of GET /v1/me/player/devices
 *
 * @param data the answer of Spotify
 */
function normalizeDevices(data) {
    const list = Array.isArray(data?.devices) ? data.devices : [];
    return list
        .filter((d) => d && typeof d === 'object' && d.id)
        .map((d) => ({
        id: cleanDeviceId(String(d.id)),
        name: text(d.name),
        type: text(d.type),
        isActive: !!d.is_active,
        isRestricted: !!d.is_restricted,
        volume: typeof d.volume_percent === 'number' ? d.volume_percent : null,
        supportsVolume: d.supports_volume !== false,
    }));
}
/**
 * Fold a name for comparing: lower case, without accents and punctuation
 *
 * @param value the name
 */
function fold(value) {
    return (value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
/**
 * Find a device by its id or name: the id, then the name exactly (case and accents do not count), then the only device
 * whose name contains the text.
 *
 * @param devices the known devices
 * @param wanted id or name
 */
function findDevice(devices, wanted) {
    const value = text(wanted);
    if (!value) {
        return null;
    }
    const id = cleanDeviceId(value);
    const byId = devices.find(d => d.id === id);
    if (byId) {
        return byId;
    }
    const name = fold(value);
    if (!name) {
        return null;
    }
    const exact = devices.filter(d => fold(d.name) === name);
    if (exact.length) {
        // two devices with the same name: the active one
        return exact.find(d => d.isActive) || exact[0];
    }
    const partial = devices.filter(d => fold(d.name).includes(name));
    return partial.length === 1 ? partial[0] : null;
}
/**
 * The answer for a failed message
 *
 * @param err the error of sendRequest
 */
function messageError(err) {
    const message = typeof err === 'string' ? err : err?.message || String(err);
    if (message === 'reauthorization required') {
        return {
            error: 'The adapter is not authorized at Spotify: authorize it in the instance settings',
            reason: 'NOT_AUTHORIZED',
        };
    }
    const status = typeof err?.status === 'number' ? err.status : /^\d{3}$/.test(message) ? Number(message) : undefined;
    const result = { error: err?.detail || message };
    if (status) {
        result.status = status;
    }
    if (err?.reason && err.reason !== 'UNKNOWN') {
        result.reason = err.reason;
    }
    else if (status === 404) {
        result.reason = 'NO_ACTIVE_DEVICE';
    }
    else if (status === 429) {
        result.reason = 'RATE_LIMITED';
    }
    else if (status === 401) {
        result.reason = 'NOT_AUTHORIZED';
    }
    else if (status === 403) {
        result.reason = 'FORBIDDEN';
    }
    if (!err?.detail) {
        if (status === 404) {
            result.error = 'No active device: open Spotify on a device or name one';
        }
        else if (status === 429) {
            result.error = 'Too many requests to Spotify, try again later';
        }
        else if (status === 503 || status === 502 || status === 500) {
            result.error = `Spotify is not reachable (${status})`;
        }
    }
    return result;
}
//# sourceMappingURL=messages.js.map