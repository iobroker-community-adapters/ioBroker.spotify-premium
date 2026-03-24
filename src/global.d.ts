declare module 'dns-lookup-cache' {
    export function lookup(
        hostname: string,
        options: any,
        callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
    ): void;
}
