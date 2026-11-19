// Cache.setExternal (build/lib/cache.js): which written values reach the state listeners

const { expect } = require('chai');
const Cache = require('../build/lib/cache').default;

const NS = 'spotify-premium.0';

/**
 * A cache with the objects of a boolean command, a button and a string state, and listeners on them
 *
 * @returns {{ cache: object, calls: { id: string, val: unknown }[] }} the cache and the listener calls
 */
function createCache() {
    const adapter = { namespace: NS, log: { debug: () => {}, error: () => {}, warn: () => {}, info: () => {} } };
    const cache = new Cache(adapter);
    const calls = [];
    const object = type => ({ type: 'state', common: { type, read: true, write: true }, native: {} });
    cache.setExternalObj(`${NS}.player.state`, object('boolean'));
    cache.setExternalObj(`${NS}.player.play`, object('boolean'));
    cache.setExternalObj(`${NS}.player.trackId`, object('string'));
    // like main.ts: commands that read the value with true (not on ack), buttons without
    cache.on('player.state', ({ id, state }) => calls.push({ id, val: state.val }), true);
    cache.on('player.play', ({ id, state }) => calls.push({ id, val: state.val }));
    cache.on('player.trackId', ({ id, state }) => calls.push({ id, val: state.val }), true);
    return { cache, calls };
}

describe('Cache.setExternal', () => {
    it('passes false of a boolean command to its listener and keeps it in the cache', () => {
        const { cache, calls } = createCache();
        cache.setExternal(`${NS}.player.state`, { val: true, ack: true });
        cache.setExternal(`${NS}.player.state`, { val: false, ack: false });
        expect(calls).to.deep.equal([{ id: 'player.state', val: false }]);
        expect(cache.getValue('player.state')).to.include({ val: false, ack: false });
    });

    it('does not press a button with false', () => {
        const { cache, calls } = createCache();
        cache.setExternal(`${NS}.player.play`, { val: false, ack: false });
        cache.setExternal(`${NS}.player.play`, { val: false, ack: true });
        expect(calls).to.deep.equal([]);
        cache.setExternal(`${NS}.player.play`, { val: true, ack: false });
        expect(calls).to.deep.equal([{ id: 'player.play', val: true }]);
    });

    it('still ignores false and empty values of other states', () => {
        const { cache, calls } = createCache();
        cache.setExternal(`${NS}.player.trackId`, { val: false, ack: false });
        cache.setExternal(`${NS}.player.trackId`, { val: '', ack: false });
        cache.setExternal(`${NS}.player.trackId`, { val: null, ack: false });
        expect(calls).to.deep.equal([]);
        cache.setExternal(`${NS}.player.trackId`, { val: 'abc', ack: false });
        expect(calls).to.deep.equal([{ id: 'player.trackId', val: 'abc' }]);
    });
});
