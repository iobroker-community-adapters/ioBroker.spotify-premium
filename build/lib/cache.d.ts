export declare function init(): Promise<void>;
export declare function getValues(name: string): Record<string, {
    val?: ioBroker.StateValue;
    ack?: boolean;
} | null | undefined>;
export declare function getValue(name: string): {
    val?: ioBroker.StateValue;
    ack?: boolean;
} | null;
export declare function getObj(name: string): ioBroker.Object | null;
export declare function setValue(name: string, state: ioBroker.StateValue | ioBroker.SettableState, obj?: ioBroker.Object): Promise<string>;
export declare function setExternal(id: string, state: ioBroker.State | null | undefined): void;
export declare function setExternalObj(id: string, obj: ioBroker.Object | null | undefined): void;
export declare function delObject(id: string): Promise<void>;
export declare function on(str: string | string[] | RegExp, func: (options: {
    id: string;
    state: ioBroker.State | null | undefined;
}) => Promise<void> | void, triggeredByOtherService?: boolean): void;
export declare function setAdapter(a: ioBroker.Adapter): void;
