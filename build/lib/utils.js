"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmpty = isEmpty;
exports.removeNameSpace = removeNameSpace;
exports.setUtilsAdapter = setUtilsAdapter;
let adapter;
function isEmpty(str) {
    return (!str && typeof str !== 'number') || 0 === str.length;
}
function removeNameSpace(id) {
    const re = new RegExp(`${adapter.namespace}*.`, 'g');
    return id.replace(re, '');
}
function setUtilsAdapter(a) {
    adapter = a;
}
//# sourceMappingURL=utils.js.map