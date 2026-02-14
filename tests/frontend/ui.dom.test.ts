import { uiFeature } from '../../extension/src/content/features/ui';
import type { RoomMember } from '../../extension/src/content/types';

class FakeClassList {
  private classes = new Set<string>();

  constructor(initial: string[] = []) {
    initial.forEach((name) => this.classes.add(name));
  }

  add(...names: string[]): void {
    names.forEach((name) => this.classes.add(name));
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.classes.delete(name));
  }

  contains(name: string): boolean {
    return this.classes.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    if (typeof force === 'boolean') {
      if (force) {
        this.classes.add(name);
        return true;
      }

      this.classes.delete(name);
      return false;
    }

    if (this.classes.has(name)) {
      this.classes.delete(name);
      return false;
    }

    this.classes.add(name);
    return true;
  }

  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class FakeElement {
  public readonly id: string;

  public textContent = '';

  public classList = new FakeClassList();

  public children: FakeElement[] = [];

  public className = '';

  public focused = false;

  public innerHTML = '';

  constructor(id: string) {
    this.id = id;
  }

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) {
      return null;
    }

    const className = selector.slice(1);
    return this.children.find((child) => child.classList.contains(className)) ?? null;
  }

  focus(): void {
    this.focused = true;
  }
}

describe('uiFeature DOM behavior', () => {
  const originalDocument = global.document;

  afterEach(() => {
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  it('toggleCommentPanel opens and closes panel while updating icon and expanded state', () => {
    const panel = new FakeElement('wp-comment-panel');
    panel.classList.add('hidden');

    const toggleIcon = new FakeElement('wp-toggle-icon-node');
    toggleIcon.classList.add('wp-toggle-icon');
    toggleIcon.textContent = '‹';

    const toggleButton = new FakeElement('wp-toggle-comment');
    toggleButton.appendChild(toggleIcon);

    const commentRoot = new FakeElement('wp-comment-input');

    const commentInput = new FakeElement('wp-comment-text');

    const elements = new Map<string, FakeElement>([
      ['wp-comment-panel', panel],
      ['wp-toggle-comment', toggleButton],
      ['wp-comment-input', commentRoot],
      ['wp-comment-text', commentInput],
    ]);

    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        getElementById: (id: string) => elements.get(id) ?? null,
      },
    });

    const context = {
      getInput: (id: string) => (id === 'wp-comment-text' ? commentInput : null),
      applyChatHistoryExpansion: jest.fn(),
    };

    uiFeature.toggleCommentPanel.call(context as never);

    expect(panel.classList.contains('hidden')).toBe(false);
    expect(toggleButton.classList.contains('open')).toBe(true);
    expect(toggleIcon.textContent).toBe('›');
    expect(commentRoot.classList.contains('expanded')).toBe(true);
    expect(commentInput.focused).toBe(true);

    uiFeature.toggleCommentPanel.call(context as never);

    expect(panel.classList.contains('hidden')).toBe(true);
    expect(toggleButton.classList.contains('open')).toBe(false);
    expect(toggleIcon.textContent).toBe('‹');
    expect(commentRoot.classList.contains('expanded')).toBe(false);
    expect(context.applyChatHistoryExpansion).toHaveBeenCalledTimes(2);
  });

  it('updateMembers renders member rows with online and offline labels', () => {
    const createdElements: FakeElement[] = [];
    const membersList = new FakeElement('wp-members-list');

    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        getElementById: (id: string) => (id === 'wp-members-list' ? membersList : null),
        createElement: (_tagName: string) => {
          const element = new FakeElement('generated');
          createdElements.push(element);
          return element;
        },
      },
    });

    const context = { members: [] as RoomMember[] };

    uiFeature.updateMembers.call(context as never, [
      { id: 'u-1', username: 'Alice', joinedAt: Date.now(), status: 'online', lastHeartbeatAt: Date.now() },
      { id: 'u-2', username: 'Bob', joinedAt: Date.now(), status: 'offline', lastHeartbeatAt: Date.now() },
    ]);

    expect(context.members).toHaveLength(2);
    expect(context.members[0].status).toBe('online');
    expect(context.members[1].status).toBe('offline');
    expect(membersList.children).toHaveLength(2);

    const onlineStatusSpan = createdElements[2];
    const offlineStatusSpan = createdElements[5];

    expect(onlineStatusSpan.textContent).toBe('オンライン');
    expect(offlineStatusSpan.textContent).toBe('オフライン');
  });
});
