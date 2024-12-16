'use strict';

let adapter;

function isEmpty(str) {
    return (!str && typeof str !== 'number') || 0 === str.length;
}

function removeNameSpace(id) {
    /* eslint-disable-next-line */
    const re = new RegExp(adapter.namespace + '*\.', 'g');
    return id.replace(re, '');
}

function setAdapter(a) {
    adapter = a;
}

module.exports = {
    isEmpty,
    removeNameSpace,
    setAdapter,
};
