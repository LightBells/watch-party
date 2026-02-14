type ListenerMap = Record<string, (event?: unknown) => void>;

type FakeElement = {
  value: string;
  textContent: string;
  disabled: boolean;
  className: string;
  checked: boolean;
  style: Record<string, string>;
  addEventListener: (event: string, handler: (event?: unknown) => void) => void;
  trigger: (event: string, payload?: unknown) => void;
};

const createElement = (initialValue = ''): FakeElement => {
  const listeners: ListenerMap = {};
  return {
    value: initialValue,
    textContent: '',
    disabled: true,
    className: '',
    checked: false,
    style: {},
    addEventListener: (event, handler) => {
      listeners[event] = handler;
    },
    trigger: (event, payload) => {
      listeners[event]?.(payload);
    },
  };
};

describe('popup entry', () => {
  const originalDocument = global.document;
  const originalChrome = (global as unknown as { chrome?: unknown }).chrome;
  const originalWindow = global.window;

  afterEach(() => {
    jest.resetModules();
    Object.defineProperty(global, 'document', { configurable: true, value: originalDocument });
    (global as unknown as { chrome?: unknown }).chrome = originalChrome;
    Object.defineProperty(global, 'window', { configurable: true, value: originalWindow });
  });

  it('loads popup and saves username from click action', async () => {
    const usernameInput = createElement('Alice');
    const saveButton = createElement('');
    const charCount = createElement('');
    const status = createElement('');
    const overlayMode = createElement('');
    const sidebarMode = createElement('');
    overlayMode.checked = true;

    const elements = new Map<string, FakeElement>([
      ['username', usernameInput],
      ['save-username', saveButton],
      ['char-count', charCount],
      ['username-status', status],
      ['chat-display-overlay', overlayMode],
      ['chat-display-sidebar', sidebarMode],
    ]);

    const docListeners: ListenerMap = {};
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        getElementById: (id: string) => elements.get(id) ?? null,
        addEventListener: (event: string, handler: (event?: unknown) => void) => {
          docListeners[event] = handler;
        },
      },
    });

    const set = jest.fn(async () => undefined);
    const get = jest.fn(async (key: unknown) => {
      if (key === null) {
        return { tab_1_username: 'old' };
      }
      return {};
    });

    (global as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get,
          set,
        },
      },
    };

    const immediateSetTimeout = jest.fn((callback: (...args: unknown[]) => void) => {
      callback();
      return 1;
    });

    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        setTimeout: immediateSetTimeout,
      },
    });

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../extension/src/popup');
    });

    docListeners.DOMContentLoaded?.();

    usernameInput.trigger('input');
    expect(saveButton.disabled).toBe(false);
    sidebarMode.checked = true;
    overlayMode.checked = false;
    sidebarMode.trigger('change');

    saveButton.trigger('click');
    await Promise.resolve();
    await Promise.resolve();

    expect(set).toHaveBeenCalledWith({ globalUsername: 'Alice', chatDisplayMode: 'sidebar' });
    expect(status.textContent).toBe('設定が保存されました');
    expect(immediateSetTimeout).toHaveBeenCalled();
  });

  it('defaults to overlay when chat display mode is missing', async () => {
    const usernameInput = createElement('Alice');
    const saveButton = createElement('');
    const charCount = createElement('');
    const status = createElement('');
    const overlayMode = createElement('');
    const sidebarMode = createElement('');

    const elements = new Map<string, FakeElement>([
      ['username', usernameInput],
      ['save-username', saveButton],
      ['char-count', charCount],
      ['username-status', status],
      ['chat-display-overlay', overlayMode],
      ['chat-display-sidebar', sidebarMode],
    ]);

    const docListeners: ListenerMap = {};
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        getElementById: (id: string) => elements.get(id) ?? null,
        addEventListener: (event: string, handler: (event?: unknown) => void) => {
          docListeners[event] = handler;
        },
      },
    });

    const get = jest.fn(async () => ({ globalUsername: 'Alice' }));
    (global as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get,
          set: jest.fn(async () => undefined),
        },
      },
    };

    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        setTimeout: jest.fn(() => 1),
      },
    });

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../extension/src/popup');
    });

    docListeners.DOMContentLoaded?.();
    await Promise.resolve();

    expect(overlayMode.checked).toBe(true);
    expect(sidebarMode.checked).toBe(false);
  });
});
