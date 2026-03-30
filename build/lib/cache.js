"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
class Cache {
    listener = [];
    cache = {
        values: { children: [], nodes: {} },
    };
    adapter;
    constructor(a) {
        this.adapter = a;
        (0, utils_1.setAdapter)(a);
    }
    getPath(id) {
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
    async init() {
        let states = await this.adapter.getStatesAsync('*');
        states ||= {};
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            const longKey = keys[i];
            const key = (0, utils_1.removeNameSpace)(longKey);
            const path = this.getPath(key);
            if (states[longKey] != null) {
                path.state = {};
                if (states[longKey].val !== undefined) {
                    path.state.val = states[longKey].val;
                }
                if (states[longKey].ack !== undefined) {
                    path.state.ack = states[longKey].ack;
                }
            }
            else {
                path.state = null;
            }
        }
        const objs = await this.adapter.getAdapterObjectsAsync();
        const keyObjs = Object.keys(objs);
        for (let i = 0; i < keyObjs.length; i++) {
            const longKey = keyObjs[i];
            const key = (0, utils_1.removeNameSpace)(longKey);
            const path = this.getPath(key);
            if (objs[longKey] != null) {
                path.obj = objs[longKey];
            }
            else {
                path.obj = null;
            }
        }
    }
    getValues(name) {
        if (!name.endsWith('.*')) {
            throw new Error('invalid name');
        }
        return this.gets(name);
    }
    getValue(name) {
        if (name.endsWith('.*')) {
            throw new Error('invalid name');
        }
        const path = this.getPath(name);
        return path.state || null;
    }
    getObj(name) {
        const path = this.getPath(name);
        return path.obj === undefined ? null : path.obj;
    }
    getSubStates(n) {
        let a = [];
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
    gets(name) {
        const path = this.getPath(name.substring(0, name.length - 2));
        const a = this.getSubStates(path);
        const r = {};
        for (let i = 0; i < a.length; i++) {
            r[a[i].fullName] = a[i].state;
        }
        return r;
    }
    promiseSerial(pArray, _resolve, _results) {
        if (!_resolve) {
            return new Promise(resolve => this.promiseSerial(pArray, resolve, []));
        }
        if (!pArray || !pArray.length) {
            _resolve(_results);
        }
        else {
            const promise = pArray.shift();
            void promise.task.then(result => {
                _results.push(result);
                if (promise.val !== undefined) {
                    void this.adapter.setState(promise.name, promise.val, () => setImmediate(() => this.promiseSerial(pArray, _resolve, _results)));
                }
                else {
                    setImmediate(() => this.promiseSerial(pArray, _resolve, _results));
                }
            });
        }
    }
    setValue(name, state, obj) {
        const path = this.getPath(name);
        let stateChanged = false;
        let objChanged = false;
        if (state != null) {
            if (path.state === undefined || path.state === null) {
                path.state = {
                    val: null,
                    ack: true,
                };
                stateChanged = true;
            }
            if (state.ack === undefined &&
                state.val === undefined) {
                state = { val: state, ack: true };
            }
            if (state.val !== undefined &&
                JSON.stringify(state.val) !== JSON.stringify(path.state.val)) {
                path.state.val = state.val;
                stateChanged = true;
            }
            if (state.ack === undefined) {
                state.ack = true;
            }
            if (state.ack !== path.state.ack) {
                path.state.ack = !!state.ack;
                stateChanged = true;
            }
        }
        if (obj) {
            const oldObj = {};
            const newObj = {};
            if (path.obj === undefined) {
                objChanged = true;
            }
            else {
                for (const key in path.obj) {
                    oldObj[key] = path.obj[key];
                    newObj[key] = path.obj[key];
                }
            }
            for (const key in obj) {
                newObj[key] = obj[key];
            }
            if (JSON.stringify(oldObj) !== JSON.stringify(newObj)) {
                path.obj = newObj;
                objChanged = true;
            }
        }
        const pArray = [];
        if (objChanged) {
            this.adapter.log.debug(`save object: ${name} -> ${JSON.stringify(path.obj)}`);
            pArray.push({ id: 'obj', name, task: this.adapter.setObjectAsync(name, path.obj) });
        }
        if (stateChanged) {
            this.adapter.log.debug(`save state: ${name} -> ${JSON.stringify(path.state.val)}`);
            let val = path.state.val;
            if (val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
            }
            if (pArray.length) {
                pArray[0].val = { val, ack: path.state.ack };
            }
            else {
                pArray.push({
                    id: 'state',
                    name,
                    task: this.adapter.setStateAsync(name, { val, ack: path.state.ack }),
                });
            }
        }
        else if (state && path.state != null && (path.state.val || typeof path.state.val === 'number')) {
            this.trigger(path.state, name);
        }
        // this must be done serial
        return this.promiseSerial(pArray).then(() => Promise.resolve([null, `${this.adapter.namespace}.${name}`]));
    }
    trigger(state, id) {
        this.listener.forEach(value => {
            if (value.ackIsFalse && state.ack) {
                return;
            }
            if ((value.name instanceof RegExp && value.name.test(id)) || value.name === id) {
                this.adapter.log.debug(`trigger: ${value.name} -> ${JSON.stringify(state)}`);
                value.func({
                    id,
                    state,
                });
            }
        });
    }
    setExternal(id, state) {
        if (state == null || (!state.val && typeof state.val !== 'number')) {
            return;
        }
        const name = (0, utils_1.removeNameSpace)(id);
        const path = this.getPath(name);
        if (path.state === undefined) {
            path.state = {
                val: null,
                ack: true,
            };
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
    setExternalObj(id, obj) {
        const name = (0, utils_1.removeNameSpace)(id);
        const path = this.getPath(name);
        if (path.obj === undefined) {
            path.obj = null;
        }
        if (obj != null) {
            path.obj = obj;
        }
    }
    delObject(id) {
        const path = this.getPath(id);
        if (path.obj === undefined) {
            return Promise.resolve();
        }
        this.adapter.log.debug(`delete object: ${id}`);
        path.obj = undefined;
        return this.adapter.delObjectAsync(id);
    }
    on(str, obj, triggeredByOtherService) {
        if ((0, utils_1.isEmpty)(triggeredByOtherService)) {
            triggeredByOtherService = false;
        }
        if (Array.isArray(str)) {
            for (let i = 0; i < str.length; i++) {
                const a = {
                    name: str[i],
                    func: obj,
                    ackIsFalse: triggeredByOtherService,
                };
                this.listener.push(a);
            }
        }
        else {
            const a = {
                name: str,
                func: obj,
                ackIsFalse: triggeredByOtherService,
            };
            this.listener.push(a);
        }
    }
}
exports.default = Cache;
//# sourceMappingURL=cache.js.map