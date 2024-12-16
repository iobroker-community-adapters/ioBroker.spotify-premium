'use strict';

const listener = [];
const utils = require('./utils');

const cache = { values: { children: [], nodes: {} } };
let adapter;

function getPath(id) {
    const parts = id.split('.');
    let path = cache.values;
    let localPath = adapter.namespace;

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

function init() {
    return new Promise(resolve =>
        adapter.getStates('*', (err, states) => {
            if (err || !states) {
                adapter.log.error(`Error getting States: ${err.message}`);
                states = {};
            }
            const keys = Object.keys(states);
            for (let i = 0; i < keys.length; i++) {
                const longKey = keys[i];
                const key = utils.removeNameSpace(longKey);

                const path = getPath(key);

                if (states[longKey] != null) {
                    path.state = {};
                    if (states[longKey]['val'] !== undefined) {
                        path.state.val = states[longKey]['val'];
                    }
                    if (states[longKey]['ack'] !== undefined) {
                        path.state.ack = states[longKey]['ack'];
                    }
                } else {
                    path.state = null;
                }
            }

            adapter.getAdapterObjects(objs => {
                const keys = Object.keys(objs);
                for (let i = 0; i < keys.length; i++) {
                    const longKey = keys[i];
                    const key = utils.removeNameSpace(longKey);

                    const path = getPath(key);
                    if (objs[longKey] != null) {
                        path.obj = objs[longKey];
                    } else {
                        path.obj = null;
                    }
                }
                resolve();
            });
        }),
    );
}

function getValue(name) {
    if (name.endsWith('.*')) {
        return gets(name);
    }

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

function promiseSerial(pArray, _resolve, _results) {
    if (!_resolve) {
        return new Promise(resolve => promiseSerial(pArray, resolve, []));
    }
    if (!pArray || !pArray.length) {
        _resolve(_results);
    } else {
        const promise = pArray.shift();

        promise.task.then(result => {
            _results.push(result);
            if (promise.val !== undefined) {
                adapter.setState(promise.name, promise.val, _err =>
                    setImmediate(() => promiseSerial(pArray, _resolve, _results)),
                );
            } else {
                setImmediate(() => promiseSerial(pArray, _resolve, _results));
            }
        });
    }
}

function setValue(name, state, obj) {
    const path = getPath(name);

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

        if (state['ack'] === undefined && state['val'] === undefined) {
            state = { val: state, ack: true };
        }

        if (state['val'] !== undefined && JSON.stringify(state['val']) !== JSON.stringify(path.state.val)) {
            path.state.val = state['val'];
            stateChanged = true;
        }

        if (state['ack'] === undefined) {
            state.ack = true;
        }

        if (state['ack'] !== path.state.ack) {
            path.state.ack = state['ack'];
            stateChanged = true;
        }
    }

    if (obj) {
        const oldObj = {};
        const newObj = {};

        if (path.obj === undefined) {
            objChanged = true;
        } else {
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
        adapter.log.debug(`save object: ${name} -> ${JSON.stringify(path.obj)}`);
        pArray.push({ id: 'obj', name, task: adapter.setObjectAsync(name, path.obj) });
    }

    if (stateChanged) {
        adapter.log.debug(`save state: ${name} -> ${JSON.stringify(path.state.val)}`);
        let val = path.state.val;
        if (val !== null && typeof val === 'object') {
            val = JSON.stringify(val);
        }
        if (pArray.length) {
            pArray[0].val = { val, ack: path.state.ack };
        } else {
            pArray.push({ id: 'state', name, task: adapter.setStateAsync(name, { val, ack: path.state.ack }) });
        }
    } else {
        if (!state || path.state == null || (!path.state['val'] && typeof path.state.val !== 'number')) {
            // empty block
        } else {
            // call listener
            trigger(path.state, name);
        }
    }

    // this must be done serial
    return promiseSerial(pArray).then(() => Promise.resolve([null, `${adapter.namespace}.${name}`]));
}

function trigger(state, name) {
    listener.forEach(value => {
        if (value.ackIsFalse && state.ack) {
            return;
        }
        if ((value.name instanceof RegExp && value.name.test(name)) || value.name === name) {
            adapter.log.debug(`trigger: ${value.name} -> ${JSON.stringify(state)}`);
            value.func({
                id: name,
                state: state,
            });
        }
    });
}

function setExternal(id, state) {
    if (state == null || (!state['val'] && typeof state['val'] != 'number')) {
        return;
    }

    const name = utils.removeNameSpace(id);

    const path = getPath(name);

    if (path.state === undefined) {
        path.state = {
            val: null,
            ack: true,
        };
    }

    if (state && path.state != null) {
        if (state['val'] !== undefined && state['val'] !== path.state.val) {
            path.state.val = state['val'];
        }
        if (state['ack'] !== undefined && state['ack'] !== path.state.ack) {
            path.state.ack = state['ack'];
        }
    }

    trigger(state, name);
}

function setExternalObj(id, obj) {
    const name = utils.removeNameSpace(id);

    const path = getPath(name);

    if (path.obj === undefined) {
        path.obj = null;
    }

    if (obj != null) {
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

function on(str, obj, triggeredByOtherService) {
    if (utils.isEmpty(triggeredByOtherService)) {
        triggeredByOtherService = false;
    }
    if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++) {
            const a = {
                name: str[i],
                func: obj,
                ackIsFalse: triggeredByOtherService,
            };
            listener.push(a);
        }
    } else {
        const a = {
            name: str,
            func: obj,
            ackIsFalse: triggeredByOtherService,
        };
        listener.push(a);
    }
}

function setAdapter(a) {
    adapter = a;

    utils.setAdapter(a);
}

module.exports = {
    init,
    setValue,
    getValue,
    getObj,
    setExternal,
    setExternalObj,
    on,
    delObject,
    setAdapter,
};
