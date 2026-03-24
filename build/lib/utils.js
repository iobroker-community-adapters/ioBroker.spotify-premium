"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmpty = isEmpty;
exports.removeNameSpace = removeNameSpace;
exports.setAdapter = setAdapter;
let adapter = null;
/**
 * Check if a value is considered empty.
 *
 * @param str Value to check.
 * @returns True if the value is empty.
 */
function isEmpty(str) {
    return !str && typeof str !== 'number';
}
/**
 * Remove the adapter namespace from an object id.
 *
 * @param id Full id including namespace.
 * @returns Id without namespace.
 */
function removeNameSpace(id) {
    const re = new RegExp(`${adapter?.namespace}*\\.`, 'g');
    return id.replace(re, '');
}
/**
 * Set an adapter instance for helper functions.
 *
 * @param a Adapter instance.
 */
function setAdapter(a) {
    adapter = a;
}
//# sourceMappingURL=utils.js.map