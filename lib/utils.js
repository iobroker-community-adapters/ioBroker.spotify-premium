'use strict';

let adapter;

/**
 * Check if a value is considered empty.
 *
 * @param {string|number|null|undefined} str Value to check.
 * @returns {boolean} True if the value is empty.
 */
function isEmpty(str) {
    return (!str && typeof str !== 'number') || 0 === str.length;
}

/**
 * Remove the adapter namespace from an object id.
 *
 * @param {string} id Full id including namespace.
 * @returns {string} Id without namespace.
 */
function removeNameSpace(id) {
    /* eslint-disable-next-line */
    const re = new RegExp(adapter.namespace + '*\.', 'g');
    return id.replace(re, '');
}

/**
 * Set adapter instance for helper functions.
 *
 * @param {ioBroker.Adapter} a Adapter instance.
 */
function setAdapter(a) {
    adapter = a;
}

module.exports = {
    isEmpty,
    removeNameSpace,
    setAdapter,
};
