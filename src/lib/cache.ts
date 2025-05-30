import { removeNameSpace, setUtilsAdapter } from './utils';

const listener: {
    ackIsFalse?: boolean;
    name: string | RegExp;
    func: (options: { id: string; state: ioBroker.State | null | undefined }) => void;
}[] = [];

interface CacheNode {
    children: Array<CacheNode>;
    nodes: Record<string, CacheNode>;
    name: string;
    fullName: string;
    state?: { val?: ioBroker.StateValue; ack?: boolean } | null;
    obj?: ioBroker.Object | null;
}
let adapter: ioBroker.Adapter;

const cache: {
    values: CacheNode;
} = { values: { children: [], nodes: {}, fullName: '', name: '' } };

function getPath(id: string): CacheNode {
    const parts = id.split('.');
    let path = cache.values;
    let localPath = adapter.namespace;

    for (let j = 0; j < parts.length; j++) {
        const partName = parts[j];
        localPath += `.${partName}`;
        if (!path.nodes[partName]) {
            path.nodes[partName] = { children: [], nodes: {}, name: partName, fullName: localPath };
            path.children.push(path.nodes[partName]);
        }
        path = path.nodes[partName];
    }

    return path;
}

export async function init(): Promise<void> {
    let states = await adapter.getStatesAsync('*');
    if (!states) {
        adapter.log.error(`Error getting States: empty`);
        states = {};
    }

    const keys = Object.keys(states);
    for (let i = 0; i < keys.length; i++) {
        const longKey = keys[i];
        const key = removeNameSpace(longKey);

        const path = getPath(key);

        if (states[longKey]) {
            path.state = {};
            if (states[longKey].val !== undefined) {
                path.state.val = states[longKey].val;
            }
            if (states[longKey].ack !== undefined) {
                path.state.ack = states[longKey].ack;
            }
        } else {
            path.state = null;
        }
    }

    const objs = await adapter.getAdapterObjectsAsync();
    const oKeys = Object.keys(objs);
    for (let i = 0; i < oKeys.length; i++) {
        const longKey = oKeys[i];
        const key = removeNameSpace(longKey);

        const path = getPath(key);
        if (objs[longKey] != null) {
            path.obj = objs[longKey] as ioBroker.StateObject;
        } else {
            path.obj = null;
        }
    }
}

export function getValues(
    name: string,
): Record<string, { val?: ioBroker.StateValue; ack?: boolean } | null | undefined> {
    return gets(name);
}

export function getValue(name: string): { val?: ioBroker.StateValue; ack?: boolean } | null {
    const path = getPath(name);

    return path.state === undefined ? null : path.state;
}

export function getObj(name: string): ioBroker.Object | null {
    const path = getPath(name);

    return path.obj === undefined ? null : path.obj;
}

function getSubStates(n: CacheNode): CacheNode[] {
    let a: CacheNode[] = [];

    if (n.state !== undefined) {
        a.push(n);
    }

    const c = n.children;
    for (let i = 0; i < c.length; i++) {
        const t = getSubStates(c[i]);
        a = a.concat(t);
    }

    return a;
}

function gets(name: string): Record<string, { val?: ioBroker.StateValue; ack?: boolean } | null | undefined> {
    const path = getPath(name.substring(0, name.length - 2));
    const a = getSubStates(path);

    const r: Record<string, { val?: ioBroker.StateValue; ack?: boolean } | null | undefined> = {};
    for (let i = 0; i < a.length; i++) {
        r[a[i].fullName] = a[i].state;
    }

    return r;
}

export async function setValue(
    name: string,
    state: ioBroker.StateValue | ioBroker.SettableState,
    obj?: ioBroker.Object,
): Promise<string> {
    const path = getPath(name);

    let stateChanged = false;

    let stateObj: ioBroker.SettableState | null = null;

    if (state !== null) {
        if (path.state === undefined || path.state === null) {
            path.state = {
                val: null,
                ack: true,
            };
            stateChanged = true;
        }

        if (typeof state !== 'object' || (state.ack === undefined && state.val === undefined)) {
            stateObj = { val: state as ioBroker.StateValue, ack: true };
        } else {
            stateObj = state as ioBroker.SettableState;
        }

        if (stateObj.val !== undefined && JSON.stringify(stateObj.val) !== JSON.stringify(path.state.val)) {
            path.state.val = stateObj.val;
            stateChanged = true;
        }

        if (stateObj.ack === undefined) {
            stateObj.ack = true;
        }

        if (stateObj.ack !== path.state.ack) {
            path.state.ack = stateObj.ack;
            stateChanged = true;
        }
    }

    if (obj) {
        const oldObj: Record<string, any> = {};
        const newObj: Record<string, any> = {};

        if (path.obj) {
            const _oldObj = path.obj as Record<string, any>;
            for (const key in _oldObj) {
                oldObj[key] = _oldObj[key];
                newObj[key] = _oldObj[key];
            }
        }

        // Update object with new values
        for (const key in obj) {
            newObj[key] = (obj as Record<string, any>)[key];
        }

        if (JSON.stringify(oldObj) !== JSON.stringify(newObj)) {
            path.obj = newObj as ioBroker.StateObject;
            adapter.log.debug(`save object: ${name} -> ${JSON.stringify(path.obj)}`);
            await adapter.setObjectAsync(name, path.obj);
        }
    }

    if (stateChanged) {
        adapter.log.debug(`save state: ${name} -> ${JSON.stringify(path.state?.val)}`);

        let val = path.state!.val;
        if (val !== null && typeof val === 'object') {
            val = JSON.stringify(val);
        }
        if (val !== undefined) {
            await adapter.setStateAsync(name, val, path.state!.ack);
        }
    } else {
        if (!state || path.state == null || (!path.state.val && typeof path.state.val !== 'number')) {
            // empty block
        } else {
            // call listener
            trigger(path.state as ioBroker.State, name);
        }
    }

    // this must be done serial
    return `${adapter.namespace}.${name}`;
}

function trigger(state: ioBroker.State | null | undefined, name: string): void {
    listener.forEach(value => {
        if (value.ackIsFalse && state?.ack) {
            return;
        }
        if ((value.name instanceof RegExp && value.name.test(name)) || value.name === name) {
            adapter.log.debug(`trigger: ${value.name} -> ${JSON.stringify(state)}`);
            value.func({
                id: name,
                state,
            });
        }
    });
}

export function setExternal(id: string, state: ioBroker.State | null | undefined): void {
    if (!state || (!state.val && state.val !== 0 && state.val !== '')) {
        return;
    }

    const name = removeNameSpace(id);

    const path = getPath(name);

    if (path.state === undefined) {
        path.state = {
            val: null,
            ack: true,
        };
    }

    if (state && path.state != null) {
        if (state.val !== undefined) {
            path.state.val = state.val;
        }
        if (state.ack !== undefined) {
            path.state.ack = state.ack;
        }
    }

    trigger(state, name);
}

export function setExternalObj(id: string, obj: ioBroker.Object | null | undefined): void {
    const name = removeNameSpace(id);

    const path = getPath(name);

    if (path.obj === undefined) {
        path.obj = null;
    }

    if (obj) {
        path.obj = obj as ioBroker.StateObject;
    }
}

export function delObject(id: string): Promise<void> {
    const path = getPath(id);
    if (path.obj === undefined) {
        return Promise.resolve();
    }
    adapter.log.debug(`delete object: ${id}`);
    path.obj = undefined;
    return adapter.delObjectAsync(id);
}

export function on(
    str: string | string[] | RegExp,
    func: (options: { id: string; state: ioBroker.State | null | undefined }) => Promise<void> | void,
    triggeredByOtherService?: boolean,
): void {
    triggeredByOtherService ||= false;

    if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++) {
            const a = {
                name: str[i],
                func,
                ackIsFalse: triggeredByOtherService,
            };
            listener.push(a);
        }
    } else {
        const a = {
            name: str,
            func,
            ackIsFalse: triggeredByOtherService,
        };
        listener.push(a);
    }
}

export function setAdapter(a: ioBroker.Adapter): void {
    adapter = a;
    setUtilsAdapter(a);
}
