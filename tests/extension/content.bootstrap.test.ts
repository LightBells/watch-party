const WatchPartyContentMock = jest.fn();

jest.mock('../../extension/src/content/watchPartyContent', () => ({
  WatchPartyContent: WatchPartyContentMock,
}));

describe('content bootstrap', () => {
  afterEach(() => {
    jest.resetModules();
    WatchPartyContentMock.mockClear();
  });

  it('instantiates WatchPartyContent on module load', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../extension/src/content');
    });

    expect(WatchPartyContentMock).toHaveBeenCalledTimes(1);
  });
});
