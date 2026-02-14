const firestoreConstructor = jest.fn();

jest.mock('@google-cloud/firestore', () => ({
  Firestore: function FirestoreMock(this: unknown, ...args: unknown[]) {
    firestoreConstructor(...args);
    return (global as unknown as { __firestoreMock: unknown }).__firestoreMock;
  },
}));

describe('firestore service', () => {
  const originalFirestore = (global as unknown as { __firestoreMock?: unknown }).__firestoreMock;

  afterEach(() => {
    jest.resetModules();
    firestoreConstructor.mockClear();
    (global as unknown as { __firestoreMock?: unknown }).__firestoreMock = originalFirestore;
  });

  it('creates, reads, updates and deletes room records', async () => {
    const set = jest.fn(async () => undefined);
    const get = jest.fn(async () => ({ exists: true, id: 'ROOM1', data: () => ({ members: ['u1'] }) }));
    const update = jest.fn(async () => undefined);
    const del = jest.fn(async () => undefined);

    const doc = jest.fn(() => ({ set, get, update, delete: del }));
    const collection = jest.fn(() => ({ doc }));

    (global as unknown as { __firestoreMock: unknown }).__firestoreMock = { collection };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = (require('../../src/server/firestore').default) as {
      createRoom: (data: { id: string }) => Promise<unknown>;
      getRoom: (id: string) => Promise<unknown>;
      updateRoom: (id: string, data: Record<string, unknown>) => Promise<void>;
      deleteRoom: (id: string) => Promise<void>;
    };

    await service.createRoom({ id: 'ROOM1' });
    await expect(service.getRoom('ROOM1')).resolves.toEqual({ id: 'ROOM1', members: ['u1'] });
    await service.updateRoom('ROOM1', { foo: 'bar' });
    await service.deleteRoom('ROOM1');

    expect(collection).toHaveBeenCalledWith('rooms');
    expect(set).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ foo: 'bar' }));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('adds comments and maps fetched comments with date conversion and ordering', async () => {
    const add = jest.fn(async () => ({ id: 'comment-id-1' }));

    const forEach = (cb: (doc: { id: string; data: () => unknown }) => void) => {
      cb({
        id: 'newer',
        data: () => ({ roomId: 'ROOM2', message: 'second', userId: 'u2', createdAt: new Date('2024-01-02') }),
      });
      cb({
        id: 'older',
        data: () => ({
          roomId: 'ROOM2',
          message: 'first',
          userId: 'u1',
          createdAt: { toDate: () => new Date('2024-01-01') },
        }),
      });
    };

    const get = jest.fn(async () => ({ forEach }));
    const limit = jest.fn(() => ({ get }));
    const orderBy = jest.fn(() => ({ limit }));
    const where = jest.fn(() => ({ orderBy }));

    const commentsCollection = { add, where };
    const collection = jest.fn((name: string) => {
      if (name === 'comments') {
        return commentsCollection;
      }
      return { doc: jest.fn() };
    });

    (global as unknown as { __firestoreMock: unknown }).__firestoreMock = { collection };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = (require('../../src/server/firestore').default) as {
      addComment: (roomId: string, data: Record<string, unknown>) => Promise<string>;
      getComments: (roomId: string, limit: number) => Promise<Array<{ id?: string; message: string }>>;
    };

    await expect(service.addComment('ROOM2', { message: 'hello', userId: 'u1' })).resolves.toBe('comment-id-1');

    const comments = await service.getComments('ROOM2', 50);
    expect(comments.map((entry) => entry.id)).toEqual(['older', 'newer']);
    expect(comments.map((entry) => entry.message)).toEqual(['first', 'second']);
  });

  it('creates users, updates activity, and fetches room members', async () => {
    const userSet = jest.fn(async () => undefined);
    const userUpdate = jest.fn(async () => undefined);

    const userDocs = new Map<string, { exists: boolean; id: string; data: () => unknown }>([
      ['u1', { exists: true, id: 'u1', data: () => ({ createdAt: new Date('2024-01-01') }) }],
      ['u2', { exists: true, id: 'u2', data: () => ({ createdAt: new Date('2024-01-02') }) }],
    ]);

    const usersCollection = {
      doc: jest.fn((id: string) => ({
        set: userSet,
        update: userUpdate,
        get: jest.fn(async () => userDocs.get(id)),
      })),
    };

    const roomsCollection = {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: true, id: 'ROOM3', data: () => ({ members: ['u1', 'u2'] }) })),
      })),
    };

    const collection = jest.fn((name: string) => {
      if (name === 'users') {
        return usersCollection;
      }
      if (name === 'rooms') {
        return roomsCollection;
      }
      return { doc: jest.fn() };
    });

    (global as unknown as { __firestoreMock: unknown }).__firestoreMock = { collection };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = (require('../../src/server/firestore').default) as {
      createUser: (data: { id: string }) => Promise<{ id: string }>;
      updateUserActivity: (id: string) => Promise<void>;
      getRoomMembers: (roomId: string) => Promise<Array<{ id: string }>>;
    };

    await service.createUser({ id: 'u1' });
    await service.updateUserActivity('u1');
    const members = await service.getRoomMembers('ROOM3');

    expect(userSet).toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalled();
    expect(members.map((member) => member.id)).toEqual(['u1', 'u2']);
  });
});
