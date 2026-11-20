// Tests of the messages (sendTo): search, play, devices, help. They use the compiled code in build/ (committed).
const { expect } = require('chai');
const ioPackage = require('../io-package.json');
const {
    buildSearchQuery,
    cleanDeviceId,
    findDevice,
    messageError,
    normalizeDevices,
    normalizeSearchResult,
    parseSpotifyUri,
    playBody,
    searchParams,
    searchTypes,
    spotifyError,
} = require('../build/lib/messages');
const { COMMANDS, helpText } = require('../build/lib/help');

describe('messages: search', () => {
    it('builds the query from free text and field filters', () => {
        expect(buildSearchQuery({ track: 'Bohemian Rhapsody', artist: 'Queen' })).to.equal(
            'track:Bohemian Rhapsody artist:Queen',
        );
        expect(buildSearchQuery({ query: 'remaster', track: 'Doxy', artist: 'Miles Davis' })).to.equal(
            'remaster track:Doxy artist:Miles Davis',
        );
        // a colon in a value would start another filter
        expect(buildSearchQuery({ track: 'Live: 1975' })).to.equal('track:Live 1975');
        expect(buildSearchQuery({ year: 1975 })).to.equal('year:1975');
    });

    it('limits the result count to 10 (Spotify since February 2026)', () => {
        expect(searchParams({ query: 'x', limit: 50 }).params.limit).to.equal('10');
        expect(searchParams({ query: 'x' }).params.limit).to.equal('5');
        expect(searchParams({ query: 'x', limit: '3' }).params.limit).to.equal('3');
        expect(searchParams({ query: 'x', limit: 0 }).params.limit).to.equal('1');
        expect(searchParams({ query: 'x', offset: 10 }).params.offset).to.equal('10');
        expect(searchParams({ query: 'x' }).params).to.not.have.property('offset');
    });

    it('checks the types', () => {
        expect(searchTypes(undefined)).to.deep.equal(['track']);
        expect(searchTypes('tracks, albums')).to.deep.equal(['track', 'album']);
        expect(searchTypes(['Artist', 'playlist', 'artist'])).to.deep.equal(['artist', 'playlist']);
        expect(searchTypes('song')).to.deep.equal(['track']);
        expect(searchTypes('video')).to.be.a('string').that.includes('Unknown type');
        expect(searchParams({ query: 'x', type: 'video' })).to.have.property('reason', 'BAD_REQUEST');
    });

    it('needs something to search', () => {
        expect(searchParams({})).to.have.property('reason', 'BAD_REQUEST');
        expect(searchParams({ query: '  ' })).to.have.property('reason', 'BAD_REQUEST');
        expect(searchParams(null)).to.have.property('reason', 'BAD_REQUEST');
    });

    it('flattens the answer of Spotify and skips null items', () => {
        const data = {
            tracks: {
                items: [
                    {
                        type: 'track',
                        id: '4uLU6hMCjMI75M1A2tKUQC',
                        uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
                        name: 'Bohemian Rhapsody',
                        artists: [{ name: 'Queen' }],
                        album: {
                            name: 'A Night At The Opera',
                            release_date: '1975-11-21',
                            images: [
                                { url: 'big', width: 640, height: 640 },
                                { url: 'medium', width: 300, height: 300 },
                                { url: 'small', width: 64, height: 64 },
                            ],
                        },
                        duration_ms: 354320,
                        explicit: false,
                    },
                ],
            },
            playlists: {
                items: [
                    null,
                    {
                        id: 'p1',
                        uri: 'spotify:playlist:p1',
                        name: 'Queen Best Of',
                        owner: { id: 'spotify', display_name: 'Spotify' },
                        items: { total: 50 },
                        images: [{ url: 'cover', width: null, height: null }],
                    },
                ],
            },
        };
        const items = normalizeSearchResult(data, ['track', 'playlist']);
        expect(items).to.deep.equal([
            {
                type: 'track',
                uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
                id: '4uLU6hMCjMI75M1A2tKUQC',
                name: 'Bohemian Rhapsody',
                artists: ['Queen'],
                album: 'A Night At The Opera',
                durationMs: 354320,
                explicit: false,
                releaseDate: '1975-11-21',
                image: 'medium',
            },
            {
                type: 'playlist',
                uri: 'spotify:playlist:p1',
                id: 'p1',
                name: 'Queen Best Of',
                owner: 'Spotify',
                ownerId: 'spotify',
                totalTracks: 50,
                image: 'cover',
            },
        ]);
        expect(normalizeSearchResult({}, ['track'])).to.deep.equal([]);
    });
});

describe('messages: play', () => {
    it('reads URIs and open.spotify.com links', () => {
        expect(parseSpotifyUri('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).to.deep.equal({
            type: 'track',
            id: '4uLU6hMCjMI75M1A2tKUQC',
            uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
        });
        expect(parseSpotifyUri('https://open.spotify.com/intl-de/album/6X9k3hSsvQck2OfKYdBbXr?si=abc')).to.deep.equal(
            { type: 'album', id: '6X9k3hSsvQck2OfKYdBbXr', uri: 'spotify:album:6X9k3hSsvQck2OfKYdBbXr' },
        );
        expect(parseSpotifyUri('spotify:user:11128263953:playlist:3sP5z9L9w0GHRWQlnZgyQN').uri).to.equal(
            'spotify:user:11128263953:playlist:3sP5z9L9w0GHRWQlnZgyQN',
        );
        expect(parseSpotifyUri('Bohemian Rhapsody')).to.equal(null);
        expect(parseSpotifyUri('spotify:track:')).to.equal(null);
    });

    it('plays a track alone and an album as context', () => {
        expect(playBody({ uri: 'spotify:track:abc' })).to.deep.equal({ body: { uris: ['spotify:track:abc'] } });
        expect(playBody({ uri: 'spotify:album:abc', offset: 2 })).to.deep.equal({
            body: { context_uri: 'spotify:album:abc', offset: { position: 2 } },
        });
        expect(playBody({ uri: 'spotify:playlist:p', offset: 'spotify:track:t' })).to.deep.equal({
            body: { context_uri: 'spotify:playlist:p', offset: { uri: 'spotify:track:t' } },
        });
        expect(playBody({ uri: ['spotify:track:a', 'spotify:track:b'], offset: 1, positionMs: 1500 })).to.deep.equal({
            body: { uris: ['spotify:track:a', 'spotify:track:b'], offset: { position: 1 }, position_ms: 1500 },
        });
        // resume
        expect(playBody({ device: 'Kitchen' })).to.deep.equal({ body: {} });
        expect(playBody(undefined)).to.deep.equal({ body: {} });
    });

    it('rejects what Spotify cannot play', () => {
        expect(playBody({ uri: 'Bohemian Rhapsody' })).to.have.property('reason', 'BAD_REQUEST');
        expect(playBody({ uri: ['spotify:album:a'] })).to.have.property('reason', 'BAD_REQUEST');
        expect(playBody({ uri: 'spotify:track:a', offset: 'spotify:track:b' })).to.have.property(
            'reason',
            'BAD_REQUEST',
        );
        expect(playBody({ uri: 'spotify:track:a', positionMs: -1 })).to.have.property('reason', 'BAD_REQUEST');
        expect(playBody('spotify:track:a')).to.have.property('reason', 'BAD_REQUEST');
    });
});

describe('messages: devices', () => {
    const devices = normalizeDevices({
        devices: [
            { id: 'abc_amzn_1', name: 'Küche', type: 'Speaker', is_active: false, is_restricted: false, volume_percent: 40 },
            { id: 'def', name: 'Wohnzimmer TV', type: 'TV', is_active: true, is_restricted: false, volume_percent: null },
            { id: 'ghi', name: 'Wohnzimmer Echo', type: 'Speaker', is_active: false, is_restricted: true },
            null,
        ],
    });

    it('cleans the ids of Echo devices', () => {
        expect(cleanDeviceId('abc_amzn_12')).to.equal('abc');
        expect(devices.map(d => d.id)).to.deep.equal(['abc', 'def', 'ghi']);
        expect(devices[1]).to.deep.equal({
            id: 'def',
            name: 'Wohnzimmer TV',
            type: 'TV',
            isActive: true,
            isRestricted: false,
            volume: null,
            supportsVolume: true,
        });
    });

    it('finds a device by id, name or a unique part of the name', () => {
        expect(findDevice(devices, 'abc_amzn_3').name).to.equal('Küche');
        expect(findDevice(devices, 'kuche').name).to.equal('Küche');
        expect(findDevice(devices, 'KÜCHE').name).to.equal('Küche');
        expect(findDevice(devices, 'tv').name).to.equal('Wohnzimmer TV');
        // two devices contain it
        expect(findDevice(devices, 'wohnzimmer')).to.equal(null);
        expect(findDevice(devices, 'Bad')).to.equal(null);
        expect(findDevice(devices, '')).to.equal(null);
    });
});

describe('messages: errors', () => {
    it('keeps the HTTP status as message and adds the body of Spotify', () => {
        const err = spotifyError(404, {
            error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' },
        });
        expect(err.message).to.equal('404');
        expect(err.toString()).to.include('404');
        expect(messageError(err)).to.deep.equal({
            error: 'Player command failed: No active device found',
            status: 404,
            reason: 'NO_ACTIVE_DEVICE',
        });
    });

    it('names the usual reasons', () => {
        expect(messageError(spotifyError(404, {}))).to.include({ reason: 'NO_ACTIVE_DEVICE', status: 404 });
        expect(
            messageError(
                spotifyError(403, {
                    error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' },
                }),
            ),
        ).to.include({ reason: 'PREMIUM_REQUIRED' });
        // UNKNOWN says nothing
        expect(
            messageError(spotifyError(403, { error: { message: 'Restriction violated', reason: 'UNKNOWN' } })),
        ).to.include({ reason: 'FORBIDDEN', error: 'Restriction violated' });
        expect(messageError(new Error('reauthorization required'))).to.include({ reason: 'NOT_AUTHORIZED' });
        expect(messageError(new Error('429'))).to.include({ reason: 'RATE_LIMITED', status: 429 });
        expect(messageError(new Error('503')).error).to.include('not reachable');
    });
});

describe('help', () => {
    const text = helpText('spotify-premium.0');

    it('names every command and is declared in io-package.json', () => {
        for (const { command } of COMMANDS) {
            expect(text).to.include(`- ${command}`);
        }
        expect(ioPackage.common.supportedMessages.help).to.equal(true);
    });

    it('names every writable state', () => {
        const writable = ioPackage.instanceObjects
            .filter(obj => obj.type === 'state' && obj.common.write && !obj._id.startsWith('authorization.'))
            .map(obj => obj._id);
        expect(writable.length).to.be.greaterThan(20);
        for (const id of writable) {
            const name = id.split('.').pop();
            // "player.playlist.trackNo" may be named as "player.playlist.trackNo" or in a list after its parent
            expect(text, id).to.match(new RegExp(`(^|[^A-Za-z])(${id.replace(/\./g, '\\.')}|${name})([^A-Za-z]|$)`));
        }
    });

    it('names only states that exist', () => {
        const ids = new Set(ioPackage.instanceObjects.map(obj => obj._id));
        const named = text.match(/\bplayer\.[A-Za-z]+(\.[A-Za-z]+)?\b/g) || [];
        expect(named.length).to.be.greaterThan(10);
        for (const id of named) {
            expect(ids.has(id), id).to.equal(true);
        }
    });
});
