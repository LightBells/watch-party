import { storageFeature } from '../../extension/src/content/features/storage';

describe('storageFeature', () => {
  const originalChrome = (global as unknown as { chrome?: unknown }).chrome;

  afterEach(() => {
    (global as unknown as { chrome?: unknown }).chrome = originalChrome;
  });

  it('saves tab-specific room data', async () => {
    const set = jest.fn(async () => undefined);

    (global as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: { set },
      },
    };

    const context = {
      resolveTabId: jest.fn(async () => 12),
    };

    await storageFeature.saveRoomData.call(context as never, 'ROOM', 'TOKEN', 'USER', 'NAME', true);

    expect(set).toHaveBeenCalledWith({
      tab_12_roomId: 'ROOM',
      tab_12_token: 'TOKEN',
      tab_12_userId: 'USER',
      tab_12_username: 'NAME',
      tab_12_isHost: true,
    });
  });

  it('loads stored data and applies member awaiting state', async () => {
    const get = jest.fn(async () => ({
      tab_99_roomId: 'ROOM99',
      tab_99_token: 'TOKEN99',
      tab_99_userId: 'USER99',
      tab_99_username: 'NAME99',
      tab_99_isHost: false,
    }));

    (global as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: { get },
      },
    };

    const context = {
      resolveTabId: jest.fn(async () => 99),
      isHost: true,
      awaitingInitialState: false,
      initialVideoStateApplied: true,
      enforcePauseWhileAwaiting: jest.fn(),
      currentRoom: null,
      currentUser: null,
      username: null,
      authToken: null,
    };

    const token = await storageFeature.loadStoredData.call(context as never);

    expect(token).toBe('TOKEN99');
    expect(context.currentRoom).toBe('ROOM99');
    expect(context.currentUser).toBe('USER99');
    expect(context.username).toBe('NAME99');
    expect(context.isHost).toBe(false);
    expect(context.awaitingInitialState).toBe(true);
    expect(context.initialVideoStateApplied).toBe(false);
    expect(context.enforcePauseWhileAwaiting).toHaveBeenCalledTimes(1);
  });

  it('restoreRoomState falls back to disconnected view when no token exists', async () => {
    const context = {
      loadStoredData: jest.fn(async () => null),
      updateStatus: jest.fn(),
      showRoomSetup: jest.fn(),
      currentRoom: null,
      currentUser: null,
    };

    await storageFeature.restoreRoomState.call(context as never);

    expect(context.updateStatus).toHaveBeenCalledWith('未接続');
    expect(context.showRoomSetup).toHaveBeenCalledTimes(1);
  });

  it('persistRoomState delegates to saveRoomData only when state is complete', async () => {
    const completeContext = {
      currentRoom: 'ROOMA',
      authToken: 'TOKENA',
      currentUser: 'USERA',
      username: 'NAMEA',
      isHost: false,
      saveRoomData: jest.fn(async () => undefined),
    };

    await storageFeature.persistRoomState.call(completeContext as never);
    expect(completeContext.saveRoomData).toHaveBeenCalledWith('ROOMA', 'TOKENA', 'USERA', 'NAMEA', false);

    const incompleteContext = {
      currentRoom: null,
      authToken: null,
      currentUser: null,
      username: null,
      isHost: false,
      saveRoomData: jest.fn(async () => undefined),
    };

    await storageFeature.persistRoomState.call(incompleteContext as never);
    expect(incompleteContext.saveRoomData).not.toHaveBeenCalled();
  });
});
