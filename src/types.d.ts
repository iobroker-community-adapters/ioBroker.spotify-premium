export interface SpotifyPremiumAdapterConfig {
    delete_devices: boolean;
    delete_playlists: boolean;
    keep_shuffle_state: boolean;
    status_interval: number;
    device_interval: number;
    playlist_interval: number;
    defaultShuffle: 'on' | 'off';
}

export interface SpotifyUser {
    display_name: string;
    external_urls: {
        spotify: string;
    };
    followers: {
        href: string | null;
        total: number;
    };
    href: string;
    id: string;
    images: {
        height: number;
        url: string;
        width: number;
    }[];
    type: string;
    uri: string;
}

export type SpotifyPlaybackState = {
    device: {
        id: string;
        is_active: boolean;
        is_private_session: boolean;
        is_restricted: boolean;
        name: string;
        supports_volume: boolean;
        type: string;
        volume_percent: number;
    };
    shuffle_state: boolean;
    smart_shuffle: boolean;
    repeat_state: string;
    timestamp: number;
    context: {
        external_urls: {
            spotify: string;
        };
        href: string;
        type: 'album' | 'track' | 'artist' | 'playlist' | 'collection';
        uri: string;
    };
    progress_ms: number;
    item: {
        album: {
            album_type: string;
            artists: {
                external_urls: { spotify: string };
                href: string;
                id: string;
                name: string;
                type: string;
                uri: string;
            }[];
            available_markets: string[];
            external_urls: { spotify: string };
            href: string;
            id: string;
            images: { height: number; url: string; width: number }[];
            name: string;
            release_date: string;
            release_date_precision: string;
            total_tracks: number;
            type: string;
            uri: string;
        };
        artists: {
            external_urls: { spotify: string };
            href: string;
            id: string;
            name: string;
            type: string;
            uri: string;
        }[];
        available_markets: string[];
        disc_number: number;
        duration_ms: number;
        explicit: boolean;
        external_ids: { isrc: string };
        external_urls: { spotify: string };
        href: string;
        id: string;
        is_local: boolean;
        name: string;
        popularity: number;
        preview_url: string | null;
        track_number: number;
        type: 'album' | 'track' | 'artist' | 'playlist' | 'collection';
        uri: string;
    };
    currently_playing_type: string;
    actions: {
        disallows: {
            resuming: boolean;
        };
    };
    is_playing: boolean;
};

export type SpotifyPlaylistList = {
    href: string;
    limit: number;
    next: string | null;
    offset: number;
    previous: string | null;
    total: number;
    items: SpotifyPlaylist[];
};
export interface SpotifyPlaylistTracksResponse {
    href: string;
    items: SpotifyPlaylistTrackItem[];
    limit: number;
    next: string | null;
    offset: number;
    previous: string | null;
    total: number;
}

export interface SpotifyPlaylistTrackItem {
    added_at: string;
    added_by: SpotifyUser;
    is_local: boolean;
    primary_color: string | null;
    track: SpotifyTrack;
    video_thumbnail: {
        url: string | null;
    };
}

export interface SpotifyUser {
    external_urls: {
        spotify: string;
    };
    href: string;
    id: string;
    type: string;
    uri: string;
}

export interface SpotifyTrack {
    preview_url: string | null;
    available_markets: string[];
    explicit: boolean;
    type: string;
    episode: boolean;
    track: boolean;
    album: SpotifyAlbum;
    artists: SpotifyArtist[];
    disc_number: number;
    track_number: number;
    duration_ms: number;
    external_ids: {
        isrc: string;
    };
    external_urls: {
        spotify: string;
    };
    href: string;
    id: string;
    name: string;
    popularity: number;
    uri: string;
    is_local: boolean;
}

export interface SpotifyAlbum {
    available_markets: string[];
    type: string;
    album_type: string;
    href: string;
    id: string;
    images: SpotifyImage[];
    name: string;
    release_date: string;
    release_date_precision: string;
    uri: string;
    artists: SpotifyArtist[];
    external_urls: {
        spotify: string;
    };
    total_tracks: number;
}

export interface SpotifyArtist {
    external_urls: {
        spotify: string;
    };
    href: string;
    id: string;
    name: string;
    type: string;
    uri: string;
}

export interface SpotifyArtistFull {
    external_urls: {
        spotify: string;
    };
    followers: {
        href: string;
        total: number;
    };
    genres: string[];
    href: string;
    id: string;
    images: {
        url: string;
        height: number;
        width: number;
    }[];
    name: string;
    popularity: number;
    type: string;
    uri: string;
}

export interface SpotifyImage {
    height: number;
    url: string;
    width: number;
}

export interface AdapterStoreSong {
    id: string;
    title: string;
    artistName: string;
    artistArray: { id: string; name: string }[];
    album: { id: string; name: string };
    durationMs: number;
    duration: string;
    addedAt: string;
    addedBy: string;
    discNumber: number;
    episode: boolean;
    explicit: boolean;
    popularity: number;
}

interface SpotifyDevicesResponse {
    devices: SpotifyDevice[];
}

interface SpotifyDevice {
    id: string;
    is_active: boolean;
    is_private_session: boolean;
    is_restricted: boolean;
    name: string;
    supports_volume: boolean;
    type: string;
    volume_percent: number;
}

export interface SpotifyPlaylist {
    collaborative: boolean;
    description: string;
    external_urls: {
        spotify: string;
    };
    href: string;
    id: string;
    images: {
        url: string;
        height: number;
        width: number;
    }[];
    name: string;
    owner: {
        external_urls: {
            spotify: string;
        };
        href: string;
        id: string;
        type: string;
        uri: string;
        display_name: string;
    };
    public: boolean;
    snapshot_id: string;
    tracks: {
        href: string;
        limit: number;
        next: string;
        offset: number;
        previous: string;
        total: number;
        items: SpotifyPlaylistTrackItem[];
    };
    type: string;
    uri: string;
}

export interface SpotifyPlaylistTrackItem {
    added_at: string;
    added_by: {
        external_urls: {
            spotify: string;
        };
        href: string;
        id: string;
        type: string;
        uri: string;
    };
    is_local: boolean;
    track: SpotifyTrack;
}

export interface SpotifyTrack {
    album: {
        album_type: string;
        total_tracks: number;
        available_markets: string[];
        external_urls: {
            spotify: string;
        };
        href: string;
        id: string;
        images: {
            url: string;
            height: number;
            width: number;
        }[];
        name: string;
        release_date: string;
        release_date_precision: string;
        restrictions?: {
            reason: string;
        };
        type: string;
        uri: string;
        artists: {
            external_urls: {
                spotify: string;
            };
            href: string;
            id: string;
            name: string;
            type: string;
            uri: string;
        }[];
    };
    artists: {
        external_urls: {
            spotify: string;
        };
        href: string;
        id: string;
        name: string;
        type: string;
        uri: string;
    }[];
    available_markets: string[];
    disc_number: number;
    duration_ms: number;
    explicit: boolean;
    external_ids: {
        isrc: string;
        ean: string;
        upc: string;
    };
    external_urls: {
        spotify: string;
    };
    href: string;
    id: string;
    is_playable: boolean;
    linked_from: Record<string, unknown>;
    restrictions?: {
        reason: string;
    };
    name: string;
    popularity: number;
    preview_url: string;
    track_number: number;
    type: string;
    uri: string;
    is_local: boolean;
}
