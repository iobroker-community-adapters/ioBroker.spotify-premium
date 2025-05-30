"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeNameSpace = removeNameSpace;
exports.init = init;
exports.getValues = getValues;
exports.getValue = getValue;
exports.getObj = getObj;
exports.setValue = setValue;
exports.setExternal = setExternal;
exports.setExternalObj = setExternalObj;
exports.delObject = delObject;
exports.on = on;
exports.setAdapter = setAdapter;
const listener = [];
let adapter;
const cache = { values: { children: [], nodes: {}, fullName: '', name: '' } };
function getPath(id) {
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
function removeNameSpace(id) {
    const re = new RegExp(`${adapter.namespace}*.`, 'g');
    return id.replace(re, '');
}
async function init() {
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
        }
        else {
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
            path.obj = objs[longKey];
        }
        else {
            path.obj = null;
        }
    }
}
function getValues(name) {
    return gets(name);
}
function getValue(name) {
    const path = getPath(name);
    return path.state === undefined ? null : path.state;
}
function getObj(name) {
    const path = getPath(name);
    return path.obj === undefined ? null : path.obj;
}
function getSubStates(n) {
    let a = [];
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
function gets(name) {
    const path = getPath(name.substring(0, name.length - 2));
    const a = getSubStates(path);
    const r = {};
    for (let i = 0; i < a.length; i++) {
        r[a[i].fullName] = a[i].state;
    }
    return r;
}
async function setValue(name, state, obj) {
    const path = getPath(name);
    let stateChanged = false;
    let stateObj = null;
    if (state !== null) {
        if (path.state === undefined || path.state === null) {
            path.state = {
                val: null,
                ack: true,
            };
            stateChanged = true;
        }
        if (typeof state !== 'object' || (state.ack === undefined && state.val === undefined)) {
            stateObj = { val: state, ack: true };
        }
        else {
            stateObj = state;
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
        const oldObj = {};
        const newObj = {};
        if (path.obj) {
            const _oldObj = path.obj;
            for (const key in _oldObj) {
                oldObj[key] = _oldObj[key];
                newObj[key] = _oldObj[key];
            }
        }
        // Update object with new values
        for (const key in obj) {
            newObj[key] = obj[key];
        }
        if (JSON.stringify(oldObj) !== JSON.stringify(newObj)) {
            path.obj = newObj;
            adapter.log.debug(`save object: ${name} -> ${JSON.stringify(path.obj)}`);
            await adapter.setObjectAsync(name, path.obj);
        }
    }
    if (stateChanged) {
        adapter.log.debug(`save state: ${name} -> ${JSON.stringify(path.state?.val)}`);
        let val = path.state.val;
        if (val !== null && typeof val === 'object') {
            val = JSON.stringify(val);
        }
        if (val !== undefined) {
            await adapter.setStateAsync(name, val, path.state.ack);
        }
    }
    else {
        if (!state || path.state == null || (!path.state.val && typeof path.state.val !== 'number')) {
            // empty block
        }
        else {
            // call listener
            trigger(path.state, name);
        }
    }
    // this must be done serial
    return `${adapter.namespace}.${name}`;
}
function trigger(state, name) {
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
function setExternal(id, state) {
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
function setExternalObj(id, obj) {
    const name = removeNameSpace(id);
    const path = getPath(name);
    if (path.obj === undefined) {
        path.obj = null;
    }
    if (obj) {
        path.obj = obj;
    }
}
function delObject(id) {
    const path = getPath(id);
    if (path.obj === undefined) {
        return Promise.resolve();
    }
    adapter.log.debug(`delete object: ${id}`);
    path.obj = undefined;
    return adapter.delObjectAsync(id);
}
function on(str, func, triggeredByOtherService) {
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
    }
    else {
        const a = {
            name: str,
            func,
            ackIsFalse: triggeredByOtherService,
        };
        listener.push(a);
    }
}
function setAdapter(a) {
    adapter = a;
}
//# sourceMappingURL=cache.js.map