'use strict';

let adapter;

function isEmpty(str) {
    return ((!str && typeof str != 'number') || 0 === str.length);
}

function removeNameSpace(id) {
    var re = new RegExp(adapter.namespace + '*\.', 'g');
    return id.replace(re, '');
}

module.exports = function (a) {
	adapter = a;

    let module = {};
    module.isEmpty = isEmpty;
    module.removeNameSpace = removeNameSpace;

    return module;
};
