import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import type { AdapterStoreSong, SpotifyDevicesResponse, SpotifyPlaybackState, SpotifyPlaylistList, SpotifyPlaylistTrackItem, SpotifyPremiumAdapterConfig, SpotifyUser } from './types';
export declare class SpotifyPremiumAdapter extends Adapter {
    config: SpotifyPremiumAdapterConfig;
    private artistImageUrlCache;
    private playlistCache;
    private tokenWorker?;
    private readonly application;
    private readonly deviceData;
    private stopped;
    private tooManyRequests;
    constructor(options?: Partial<AdapterOptions>);
    main(): void;
    start(): Promise<void>;
    sendRequest<T = any>(endPoint: string, method: 'POST' | 'GET' | 'PUT', sendBody: string, delayAccepted?: boolean): Promise<T | null>;
    static loadOrDefault<T = any>(obj: Record<string, any> | null | undefined, name: string, defaultVal: T): T;
    createOrDefault(obj: Record<string, any>, name: string, state: string, defaultVal: ioBroker.StateValue, description: string, type: ioBroker.CommonType, states?: Record<string, string>): Promise<string>;
    static setOrDefault(obj: Record<string, any> | null | undefined, name: string, state: string, defaultVal: ioBroker.StateValue): Promise<string>;
    static shrinkStateName(v: string): string;
    static getArtistNamesOrDefault(data: SpotifyPlaybackState | SpotifyPlaylistTrackItem | null | undefined, isTrack?: boolean): string;
    static setObjectStatesIfChanged(id: string, states?: Record<string, string>): Promise<string>;
    copyState(src: string, dst: string): Promise<void>;
    copyObjectStates(src: string, dst: string): Promise<void>;
    createPlaybackInfo(data?: SpotifyPlaybackState | null): Promise<void>;
    static convertToDigiClock(ms: number | string): string;
    setUserInformation(data: SpotifyUser): void;
    reloadUsersPlaylist: () => Promise<void>;
    deleteUsersPlaylist(addedList: string[]): Promise<void>;
    createPlaylists(parseJson: SpotifyPlaylistList | null | undefined, autoContinue?: boolean, addedList?: string[]): Promise<string[]>;
    getUsersPlaylist(offset: number, addedList?: string[]): Promise<string[]>;
    getSelectedDevice(deviceData: {
        lastActiveDeviceId: string;
        lastSelectDeviceId: string;
    }): string;
    static cleanState(str: string): string;
    getPlaylistTracks(owner: string, id: string): Promise<{
        stateString: string;
        listString: string;
        listNumber: string;
        trackIdMap: string;
        trackIds: string;
        songs: AdapterStoreSong[];
    }>;
    reloadDevices(data: SpotifyDevicesResponse | null | undefined): Promise<void>;
    disableDevices(addedList: string[]): Promise<void>;
    deleteDevices(addedList: string[]): Promise<void>;
    static getIconByType(type: string): string;
    createDevices(data?: SpotifyDevicesResponse | null): Promise<string[]>;
    refreshPlaylistList(): Promise<void>;
    refreshDeviceList(): Promise<void>;
    increaseTime(durationMs: number, progressMs: number, startDate: number, count: number): Promise<void>;
    scheduleStatusInternalTimer(durationMs: number, progressMs: number, startDate: number, count: number): void;
    scheduleStatusPolling(): void;
    pollStatusApi(noReschedule?: boolean): void;
    scheduleDevicePolling(): void;
    pollDeviceApi(): void;
    schedulePlaylistPolling(): void;
    pollPlaylistApi(): void;
    startPlaylist(playlist: string, owner: string, trackNo: number, keepTrack?: boolean): Promise<void>;
    listenOnUseForPlayback: (options: {
        id: string;
        state?: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnTrackList: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlayThisList: (options: {
        id: string;
        state?: ioBroker.State | null | undefined;
    }, pos?: number) => Promise<void>;
    listenOnDeviceList: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlaylistList: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlayUri: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlay: () => Promise<void>;
    listenOnPause: () => Promise<void>;
    listenOnSkipPlus: () => Promise<void>;
    listenOnSkipMinus: () => Promise<void>;
    listenOnRepeat: (options: {
        id: string;
        state: {
            val?: ioBroker.StateValue;
            ack?: boolean;
        } | null | undefined;
    }) => Promise<void>;
    listenOnRepeatTrack: () => Promise<void>;
    listenOnRepeatContext: () => Promise<void>;
    listenOnRepeatOff: () => Promise<void>;
    listenOnVolume: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnProgressMs: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnProgressPercentage: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnShuffle: (options: {
        id: string;
        state: {
            val: ioBroker.StateValue;
            ack: boolean;
        } | null | undefined;
    }) => Promise<void>;
    listenOnShuffleOff: () => Promise<void>;
    listenOnShuffleOn: () => Promise<void>;
    listenOnTrackId: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlaylistId: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlaylistOwner: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnPlaylistTrackNo: (options: {
        id: string;
        state: ioBroker.State | null | undefined;
    }) => Promise<void>;
    listenOnGetPlaybackInfo: () => void;
    listenOnGetDevices: () => Promise<void>;
    clearCache(): void;
    listenOnHtmlPlaylists: () => Promise<void>;
    listenOnHtmlTracklist: () => Promise<void>;
    listenOnHtmlDevices: () => Promise<void>;
}
