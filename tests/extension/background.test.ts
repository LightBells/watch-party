describe('background entry', () => {
  const originalChrome = (global as unknown as { chrome?: unknown }).chrome;

  afterEach(() => {
    jest.resetModules();
    (global as unknown as { chrome?: unknown }).chrome = originalChrome;
  });

  it('sends pageLoaded message on supported tab completion', async () => {
    const listeners: Record<string, (...args: unknown[]) => unknown> = {};
    const sendMessage = jest.fn(async () => undefined);

    (global as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getManifest: () => ({ name: 'test-extension' }),
        onInstalled: { addListener: (cb: (...args: unknown[]) => void) => { listeners.installed = cb; } },
        onMessage: { addListener: (cb: (...args: unknown[]) => void) => { listeners.message = cb; } },
      },
      tabs: {
        onUpdated: { addListener: (cb: (...args: unknown[]) => void) => { listeners.updated = cb; } },
        sendMessage,
        query: jest.fn(async () => []),
      },
      storage: {
        onChanged: { addListener: (cb: (...args: unknown[]) => void) => { listeners.changed = cb; } },
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
      },
    };

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../extension/src/background');
    });

    const updated = listeners.updated;
    updated?.(
      10,
      { status: 'complete' },
      { url: 'https://www.amazon.co.jp/gp/video/detail/abc' },
    );

    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(10, {
      action: 'pageLoaded',
      url: 'https://www.amazon.co.jp/gp/video/detail/abc',
    });
  });

  it('returns tabId for getTabId runtime message', () => {
    const listeners: Record<string, (...args: unknown[]) => unknown> = {};

    (global as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getManifest: () => ({ name: 'test-extension' }),
        onInstalled: { addListener: (cb: (...args: unknown[]) => void) => { listeners.installed = cb; } },
        onMessage: { addListener: (cb: (...args: unknown[]) => void) => { listeners.message = cb; } },
      },
      tabs: {
        onUpdated: { addListener: (cb: (...args: unknown[]) => void) => { listeners.updated = cb; } },
        sendMessage: jest.fn(async () => undefined),
        query: jest.fn(async () => []),
      },
      storage: {
        onChanged: { addListener: (cb: (...args: unknown[]) => void) => { listeners.changed = cb; } },
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
      },
    };

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../extension/src/background');
    });

    const sendResponse = jest.fn();
    const onMessage = listeners.message;

    const keepAlive = onMessage?.(
      { action: 'getTabId' },
      { tab: { id: 123 } },
      sendResponse,
    );

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, tabId: 123 });
  });
});
