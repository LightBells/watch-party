import { uiFeature } from '../../extension/src/content/features/ui';

describe('uiFeature additional behavior', () => {
  const originalDocument = global.document;

  afterEach(() => {
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  it('updateStatus updates indicator and connection text', () => {
    const status = { textContent: '' };
    const room = { textContent: '' };
    const indicator = { className: '' };
    const connectionText = { textContent: '' };

    const map = new Map<string, unknown>([
      ['wp-status', status],
      ['wp-room', room],
      ['wp-connection-indicator', indicator],
      ['wp-connection-text', connectionText],
    ]);

    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        getElementById: (id: string) => map.get(id) ?? null,
      },
    });

    const context = { currentRoom: 'ROOM9' };
    uiFeature.updateStatus.call(context as never, 'ホスト');

    expect(status.textContent).toBe('ホスト');
    expect(room.textContent).toBe('ROOM9');
    expect(indicator.className).toBe('wp-indicator connected');
    expect(connectionText.textContent).toContain('ROOM9');

    uiFeature.updateStatus.call(context as never, '未接続');
    expect(indicator.className).toBe('wp-indicator disconnected');
  });

  it('notifyStatusTransitions emits toasts for online/offline transitions of other users', () => {
    const context = {
      currentUser: 'self',
      showToast: jest.fn(),
    };

    uiFeature.notifyStatusTransitions.call(
      context as never,
      [
        { id: 'u1', username: 'Alice', status: 'offline' },
        { id: 'u2', username: 'Bob', status: 'online' },
      ],
      [
        { id: 'u1', username: 'Alice', status: 'online' },
        { id: 'u2', username: 'Bob', status: 'offline' },
        { id: 'self', username: 'Me', status: 'offline' },
      ],
      null,
    );

    expect(context.showToast).toHaveBeenCalledWith('Alice がオンラインになりました', 'join');
    expect(context.showToast).toHaveBeenCalledWith('Bob がオフラインになりました', 'leave');
    expect(context.showToast).toHaveBeenCalledTimes(2);
  });
});
