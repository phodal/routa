type DesktopAwareFetchMock = {
  mockImplementation(
    implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  ): void;
  mockReset(): void;
};

export function resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch: DesktopAwareFetchMock): void {
  desktopAwareFetch.mockReset();
  desktopAwareFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
}

export function mockUseRuntimeFitnessStatus() {
  return {
    data: null,
    loading: false,
    error: null,
    refresh: () => {},
  };
}
