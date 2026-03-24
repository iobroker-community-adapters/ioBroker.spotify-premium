let adapter: ioBroker.Adapter | null = null;

/**
 * Check if a value is considered empty.
 *
 * @param str Value to check.
 * @returns True if the value is empty.
 */
export function isEmpty(str: any): boolean {
    return !str && typeof str !== 'number';
}

/**
 * Remove the adapter namespace from an object id.
 *
 * @param id Full id including namespace.
 * @returns Id without namespace.
 */
export function removeNameSpace(id: string): string {
    const re = new RegExp(`${adapter?.namespace}*\\.`, 'g');
    return id.replace(re, '');
}

/**
 * Set an adapter instance for helper functions.
 *
 * @param a Adapter instance.
 */
export function setAdapter(a: ioBroker.Adapter): void {
    adapter = a;
}
