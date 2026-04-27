"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  dispatchCanvasAction,
  getCanvasDataSnapshot,
  setCanvasData,
  subscribeCanvasData,
} from "./host-bridge";

export type CanvasAction = {
  type: string;
  [key: string]: unknown;
};

export type SetCanvasState<T> = (action: T | ((prev: T) => T)) => void;

export function useCanvasState<T>(
  key: string,
  defaultValue: T,
): [T, SetCanvasState<T>] {
  const subscribe = useCallback(
    (callback: () => void) => subscribeCanvasData(key, callback),
    [key],
  );
  const getSnapshot = useCallback(() => getCanvasDataSnapshot(key), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const value = snapshot === undefined ? defaultValue : (snapshot as T);

  const setValue = useCallback<SetCanvasState<T>>(
    (action) => {
      const previous =
        (getCanvasDataSnapshot(key) as T | undefined) ?? defaultValue;
      const next =
        typeof action === "function"
          ? (action as (prev: T) => T)(previous)
          : action;
      setCanvasData(key, next);
    },
    [defaultValue, key],
  );

  return [value, setValue];
}

export function useCanvasAction(): (action: CanvasAction) => void {
  return useCallback((action: CanvasAction) => {
    dispatchCanvasAction(action);
  }, []);
}
