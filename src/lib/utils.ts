let adapter: ioBroker.Adapter;

export function isEmpty(str: any): boolean {
    return (!str && typeof str !== 'number') || 0 === str.length;
}

export function removeNameSpace(id: string): string {
    const re = new RegExp(`${adapter.namespace}*.`, 'g');
    return id.replace(re, '');
}

export function setUtilsAdapter(a: ioBroker.Adapter): void {
    adapter = a;
}
