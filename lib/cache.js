'use strict'

const Promise = require('promise');
const listener = [];

let isEmpty;
let removeNameSpace;

let cache = {values: {children: [], nodes: {}}};
let adapter;

function getPath(id) {
	let parts = id.split(".");
	let path = cache.values;
	let localPath = adapter.namespace;

	for(let j = 0; j < parts.length; j++) {
		let partName = parts[j];
		localPath += '.' + partName;
		let currentPath = path.nodes[partName];
		if(currentPath === undefined) {
			path.nodes[partName] = {children: [], nodes: {}, name: partName, fullName: localPath};
			path.children.push(path.nodes[partName]);
		}
		path = path.nodes[partName];
	}

	return path;
}

function init() {
	return new Promise(function (resolve, reject) {
		adapter.getStates('*', function(err, states) {
			let keys = Object.keys(states);
			for(let i = 0; i < keys.length; i++) {
				let longKey = keys[i];
				let key = removeNameSpace(longKey);

				let path = getPath(key);

				if (states[longKey] != null) {
					path.state = {};
					if(states[longKey]['val'] !== undefined) {
						path.state.val = states[longKey]['val'];
					}
					if(states[longKey]['ack'] !== undefined) {
						path.state.ack = states[longKey]['ack'];
					}
				} else {
					path.state = null;
				}
			}

			adapter.getAdapterObjects(function(objs) {
				let keys = Object.keys(objs);
				for(let i = 0; i < keys.length; i++) {
					let longKey = keys[i];
					let key = removeNameSpace(longKey);
	
					let path = getPath(key);
					if (objs[longKey] != null) {
						path.obj = objs[longKey];
					} else {
						path.obj = null;
					}
				}
				resolve();
			});
		});
	});
}

function get(name) {
	if(name.endsWith('.*')) {
		return gets(name);
	}

	let path = getPath(name);

	return path.state === undefined ? null : path.state;
}

function getObj(name) {
	let path = getPath(name);

	return path.obj === undefined ? null : path.obj;
}

function getSubStates(n) {
	let a = [];

	if(n.state !== undefined) {
		a.push(n);
	}

	let c = n.children;
	for(let i = 0; i < c.length; i++) {
		let t = getSubStates(c[i]);
		a = a.concat(t);
	}

	return a;
}

function gets(name) {
	let path = getPath(name.substring(0, name.length - 2));
	let a = getSubStates(path);

	let r = {};
	for(let i = 0; i < a.length; i++) {
		r[a[i].fullName] = a[i].state;
	}

	return r;
}

function set(name, state, obj) {
	let path = getPath(name);

	let stateChanged = false;
	let objChanged = false;

	if(state != null) {
		if(path.state === undefined || path.state === null) {
			path.state = {
				val: null,
				ack: true
			};
			stateChanged = true;
		}

		if(state['val'] != undefined && JSON.stringify(state['val']) !== JSON.stringify(path.state.val)) {
			path.state.val = state['val'];
			stateChanged = true;
		}

		if(state['ack'] !== undefined && state['ack'] !== path.state.ack) {
			path.state.ack = state['ack'];
			stateChanged = true;
		}
	}

	if(obj != null) {
		let oldObj = {};
		let newObj = {};

		if(path.obj === undefined) {
			objChanged = true;
		} else {
			for (let key in path.obj) {
				oldObj[key] = path.obj[key];
				newObj[key] = path.obj[key];
			}
		}
		
		for (let key in obj) {
			newObj[key] = obj[key];
		}
		
		if(JSON.stringify(oldObj) != JSON.stringify(newObj)) {
			path.obj = newObj;
			objChanged = true;
		}
	}

	let pArray = [];
	if(objChanged) {
		adapter.log.debug('save object: ' + name + ' -> ' + JSON.stringify(path.obj));
		pArray.push(new Promise(function(resolve, reject) {
	        let retFunc = function(err, obj) {
	            if (err) {
	                reject(err);
	            } else {
	                resolve(obj);
	            }
	        }
	        adapter.setObject(name, path.obj, retFunc);
	    }));
	}

	if(stateChanged) {
		adapter.log.debug('save state: ' + name + ' -> ' + JSON.stringify(path.state.val));
		pArray.push(new Promise(function(resolve, reject) {
	        let retFunc = function(err, id) {
	            if (err) {
	                reject(err);
	            } else {
	                resolve(id);
	            }
	        }

	        adapter.setState(name, {
                val: path.state.val,
                ack: path.state.ack
            }, retFunc);
	    }));
	} else {
	    if (state == null || path.state == null || (!path.state['val'] && typeof path.state.val != 'number')) {
	    } else {
	    	// call listener
	    	trigger(path.state, name);
	    }
	}

	return Promise.all(pArray).then(function() {
		return Promise.resolve(null, adapter.namespace + '.' + name);
	})
};

function trigger(state, name) {
	listener.forEach(function(value) {
        if (value.ackIsFalse && state.ack) {
            return;
        }
        if ((value.name instanceof RegExp && value.name.test(name)) || value.name == name) {
        	adapter.log.debug('trigger: ' + value.name);
            value.func({
                id: name,
                state: state
            });
        }
    });
}

function setExternal(id, state) {
    if (state == null || (!state['val'] && typeof state['val'] != 'number')) {
        return;
    }

	let name = removeNameSpace(id);
	
	let path = getPath(name);
	
	if(path.state === undefined) {
		path.state = {
			val: null,
			ack: true
		};
	}

	if(state != null && path.state != null) {
		if(state['val'] != undefined &&state['val'] !== path.state.val) {
			path.state.val = state['val'];
		}
		if(state['ack'] !== undefined && state['ack'] !== path.state.ack) {
			path.state.ack = state['ack'];
		}
	}

	trigger(state, name);
}

function setExternalObj(id, obj) {
	let name = removeNameSpace(id);

	let path = getPath(name);

	if(path.obj === undefined) {
		path.obj = null;
	}

	if(obj != null) {
		path.obj = obj;
	}
}

function delObject(id, options, callback) {
	let path = getPath(id);
	if(path.obj === undefined) {
		return Promise.resolve();
	}
	adapter.log.debug('delete object: ' + id);
	path.obj = undefined;

    return new Promise(function(resolve, reject) {
        let retFunc = function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        }
        if (options === undefined) {
            options = retFunc;
            retFunc = undefined;
        }
        adapter.delObject(id, options, retFunc);
    });
}

function on(str, obj, triggeredByOtherService) {
    if (isEmpty(triggeredByOtherService)) {
        triggeredByOtherService = false;
    }
    let a = {
        name: str,
        func: obj,
        ackIsFalse: triggeredByOtherService
    };
    listener.push(a);
}

module.exports = function (a) {
	adapter = a;

	let utils = require(__dirname + '/utils')(a);

	isEmpty = utils.isEmpty;
	removeNameSpace = utils.removeNameSpace;

    let module = {};
    module.init = init;
    module.set = set;
    module.get = get;
    module.getObj = getObj;
    module.setExternal = setExternal;
    module.setExternalObj = setExternalObj;
    module.on = on;
    module.delObject = delObject;

    return module;
};
