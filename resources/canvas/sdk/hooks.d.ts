export type CanvasAction = {
    type: string;
    [key: string]: unknown;
};
export type SetCanvasState<T> = (action: T | ((prev: T) => T)) => void;
export declare function useCanvasState<T>(key: string, defaultValue: T): [T, SetCanvasState<T>];
export declare function useCanvasAction(): (action: CanvasAction) => void;
