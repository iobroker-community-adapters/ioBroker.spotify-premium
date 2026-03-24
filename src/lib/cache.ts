import { removeNameSpace, isEmpty, setAdapter as setAdapterInUtils } from './utils';

interface TreeNode {
    children: TreeNode[];
    nodes: Record<string, TreeNode>;
    name?: string;
    fullName?: string;
    state?: ioBroker.State | null;
    obj?: ioBroker.StateObject | null;
}

interface Listener {
    name: string | RegExp;
    func: (event: { id: string; state: ioBroker.State }) => void;
    ackIsFalse: boolean;
}

interface PromiseSerialItem {
    id: string;
    name: string;
    task: Promise<any>;
    val?: { val: ioBroker.StateValue; ack: boolean };
}

type ListenerCallback = (event: { id: string; state: ioBroker.State }) => void;

export default class Cache {
    private listener: Listener[] = [];
    private cache: { values: TreeNode } = {
        values: { children: [], nodes: {} },
    };
    private adapter!: ioBroker.Adapter;

    constructor(a: ioBroker.Adapter) {
        this.adapter = a;
        setAdapterInUtils(a);
    }

    private getPath(id: string): TreeNode {
        const parts = id.split('.');
        let path = this.cache.values;
        let localPath = this.adapter.namespace;

        for (let j = 0; j < parts.length; j++) {
            const partName = parts[j];
            localPath += `.${partName}`;
            const currentPath = path.nodes[partName];
            if (currentPath === undefined) {
                path.nodes[partName] = { children: [], nodes: {}, name: partName, fullName: localPath };
                path.children.push(path.nodes[partName]);
            }
            path = path.nodes[partName];
        }

        return path;
    }

    async init(): Promise<void> {
        let states = await this.adapter.getStatesAsync('*');
        states ||= {};
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            const longKey = keys[i];
            const key = removeNameSpace(longKey);

            const path = this.getPath(key);

            if (states[longKey] != null) {
                path.state = {} as ioBroker.State;
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

        const objs = await this.adapter.getAdapterObjectsAsync();
        const keyObjs = Object.keys(objs);
        for (let i = 0; i < keyObjs.length; i++) {
            const longKey = keyObjs[i];
            const key = removeNameSpace(longKey);

            const path = this.getPath(key);
            if (objs[longKey] != null) {
                path.obj = objs[longKey] as ioBroker.StateObject;
            } else {
                path.obj = null;
            }
        }
    }

    getValues(name: string): Record<string, ioBroker.State | null | undefined> {
        if (!name.endsWith('.*')) {
            throw new Error('invalid name');
        }
        return this.gets(name);
    }

    getValue(name: string): ioBroker.State | null {
        if (name.endsWith('.*')) {
            throw new Error('invalid name');
        }

        const path = this.getPath(name);

        return path.state || null;
    }

    getObj(name: string): Record<string, any> | null {
        const path = this.getPath(name);

        return path.obj === undefined ? null : path.obj;
    }

    private getSubStates(n: TreeNode): TreeNode[] {
        let a: TreeNode[] = [];

        if (n.state !== undefined) {
            a.push(n);
        }

        const c = n.children;
        for (let i = 0; i < c.length; i++) {
            const t = this.getSubStates(c[i]);
            a = a.concat(t);
        }

        return a;
    }

    private gets(name: string): Record<string, ioBroker.State | null | undefined> {
        const path = this.getPath(name.substring(0, name.length - 2));
        const a = this.getSubStates(path);

        const r: Record<string, ioBroker.State | null | undefined> = {};
        for (let i = 0; i < a.length; i++) {
            r[a[i].fullName!] = a[i].state;
        }

        return r;
    }

    private promiseSerial(
        pArray: PromiseSerialItem[],
        _resolve?: (results: any[]) => void,
        _results?: any[],
    ): Promise<any> | void {
        if (!_resolve) {
            return new Promise(resolve => this.promiseSerial(pArray, resolve, []));
        }
        if (!pArray || !pArray.length) {
            _resolve(_results!);
        } else {
            const promise = pArray.shift()!;

            void promise.task.then(result => {
                _results!.push(result);
                if (promise.val !== undefined) {
                    void this.adapter.setState(promise.name, promise.val, () =>
                        setImmediate(() => this.promiseSerial(pArray, _resolve, _results)),
                    );
                } else {
                    setImmediate(() => this.promiseSerial(pArray, _resolve, _results));
                }
            });
        }
    }

    setValue(
        name: string,
        state: ioBroker.SettableState | ioBroker.StateValue | null,
        obj?: ioBroker.StateObject | ioBroker.ChannelObject | ioBroker.DeviceObject,
    ): Promise<any> {
        const path = this.getPath(name);

        let stateChanged = false;
        let objChanged = false;

        if (state != null) {
            if (path.state === undefined || path.state === null) {
                path.state = {
                    val: null,
                    ack: true,
                } as ioBroker.State;
                stateChanged = true;
            }

            if (
                (state as ioBroker.SettableState).ack === undefined &&
                (state as ioBroker.SettableState).val === undefined
            ) {
                state = { val: state as ioBroker.StateValue, ack: true };
            }

            if (
                (state as ioBroker.SettableState).val !== undefined &&
                JSON.stringify((state as ioBroker.SettableState).val) !== JSON.stringify(path.state.val)
            ) {
                path.state.val = (state as ioBroker.SettableState).val!;
                stateChanged = true;
            }

            if ((state as ioBroker.SettableState).ack === undefined) {
                (state as ioBroker.SettableState).ack = true;
            }

            if ((state as ioBroker.SettableState).ack !== path.state.ack) {
                path.state.ack = !!(state as ioBroker.SettableState).ack;
                stateChanged = true;
            }
        }

        if (obj) {
            const oldObj: Record<string, any> = {};
            const newObj: Record<string, any> = {};

            if (path.obj === undefined) {
                objChanged = true;
            } else {
                for (const key in path.obj) {
                    oldObj[key] = (path.obj as any)[key];
                    newObj[key] = (path.obj as any)[key];
                }
            }

            for (const key in obj) {
                newObj[key] = (obj as any)[key];
            }

            if (JSON.stringify(oldObj) !== JSON.stringify(newObj)) {
                path.obj = newObj as ioBroker.StateObject;
                objChanged = true;
            }
        }

        const pArray: PromiseSerialItem[] = [];
        if (objChanged) {
            this.adapter.log.debug(`save object: ${name} -> ${JSON.stringify(path.obj)}`);
            pArray.push({ id: 'obj', name, task: this.adapter.setObjectAsync(name, path.obj!) });
        }

        if (stateChanged) {
            this.adapter.log.debug(`save state: ${name} -> ${JSON.stringify(path.state!.val)}`);
            let val: ioBroker.StateValue = path.state!.val;
            if (val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
            }
            if (pArray.length) {
                pArray[0].val = { val, ack: path.state!.ack };
            } else {
                pArray.push({
                    id: 'state',
                    name,
                    task: this.adapter.setStateAsync(name, { val, ack: path.state!.ack }),
                });
            }
        } else if (state && path.state != null && (path.state.val || typeof path.state.val === 'number')) {
            this.trigger(path.state, name);
        }

        // this must be done serial
        return (this.promiseSerial(pArray) as Promise<any>).then(() =>
            Promise.resolve([null, `${this.adapter.namespace}.${name}`] as [null, string]),
        );
    }

    private trigger(state: ioBroker.State, name: string): void {
        this.listener.forEach(value => {
            if (value.ackIsFalse && state.ack) {
                return;
            }
            if ((value.name instanceof RegExp && value.name.test(name)) || value.name === name) {
                this.adapter.log.debug(`trigger: ${value.name} -> ${JSON.stringify(state)}`);
                value.func({
                    id: name,
                    state: state,
                });
            }
        });
    }

    setExternal(id: string, state: ioBroker.State | null | undefined): void {
        if (state == null || (!state.val && typeof state.val !== 'number')) {
            return;
        }

        const name = removeNameSpace(id);

        const path = this.getPath(name);

        if (path.state === undefined) {
            path.state = {
                val: null,
                ack: true,
            } as ioBroker.State;
        }

        if (state && path.state != null) {
            if (state.val !== undefined && state.val !== path.state.val) {
                path.state.val = state.val;
            }
            if (state.ack !== undefined && state.ack !== path.state.ack) {
                path.state.ack = state.ack;
            }
        }

        this.trigger(state, name);
    }

    setExternalObj(id: string, obj: ioBroker.StateObject | null | undefined): void {
        const name = removeNameSpace(id);

        const path = this.getPath(name);

        if (path.obj === undefined) {
            path.obj = null;
        }

        if (obj != null) {
            path.obj = obj;
        }
    }

    delObject(id: string): Promise<void> {
        const path = this.getPath(id);
        if (path.obj === undefined) {
            return Promise.resolve();
        }
        this.adapter.log.debug(`delete object: ${id}`);
        path.obj = undefined;
        return this.adapter.delObjectAsync(id);
    }

    on(
        str: string | RegExp | (string | RegExp)[],
        obj: ListenerCallback,
        triggeredByOtherService?: boolean | string,
    ): void {
        if (isEmpty(triggeredByOtherService as any)) {
            triggeredByOtherService = false;
        }
        if (Array.isArray(str)) {
            for (let i = 0; i < str.length; i++) {
                const a: Listener = {
                    name: str[i],
                    func: obj,
                    ackIsFalse: triggeredByOtherService as boolean,
                };
                this.listener.push(a);
            }
        } else {
            const a: Listener = {
                name: str,
                func: obj,
                ackIsFalse: triggeredByOtherService as boolean,
            };
            this.listener.push(a);
        }
    }
}
