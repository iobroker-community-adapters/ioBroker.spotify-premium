export interface SpotifyPremiumAdapterConfig {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    delete_devices: boolean;
    delete_playlists: boolean;
    keep_shuffle_state: boolean;
    status_interval: string | number;
    device_interval: string | number;
    playlist_interval: string | number;
    defaultShuffle: 'on' | 'off';
}
