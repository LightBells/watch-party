class WatchPartyUsernamePopup {
  private username: string | null = null;

  private chatDisplayMode: 'overlay' | 'sidebar' = 'overlay';

  private usernameInput: HTMLInputElement;

  private saveButton: HTMLButtonElement;

  private charCount: HTMLElement;

  private statusElement: HTMLElement;

  private overlayModeInput: HTMLInputElement;

  private sidebarModeInput: HTMLInputElement;

  constructor() {
    this.usernameInput = this.queryElement<HTMLInputElement>('username');
    this.saveButton = this.queryElement<HTMLButtonElement>('save-username');
    this.charCount = this.queryElement<HTMLElement>('char-count');
    this.statusElement = this.queryElement<HTMLElement>('username-status');
    this.overlayModeInput = this.queryElement<HTMLInputElement>('chat-display-overlay');
    this.sidebarModeInput = this.queryElement<HTMLInputElement>('chat-display-sidebar');

    this.bindEvents();
    void this.loadSettings();
  }

  private queryElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id ${id} not found`);
    }
    return element as T;
  }

  private bindEvents(): void {
    this.usernameInput.addEventListener('input', () => this.updateInputState());
    this.overlayModeInput.addEventListener('change', () => this.updateInputState());
    this.sidebarModeInput.addEventListener('change', () => this.updateInputState());
    this.saveButton.addEventListener('click', () => {
      void this.saveSettings();
    });
    this.usernameInput.addEventListener('keypress', (event) => {
      if (event.isComposing) {
        return;
      }

      if (event.key === 'Enter' && !this.saveButton.disabled) {
        void this.saveSettings();
      }
    });
  }

  private async loadSettings(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['globalUsername', 'chatDisplayMode']);
      if (result.globalUsername) {
        this.username = result.globalUsername as string;
        this.usernameInput.value = this.username;
      }
      this.chatDisplayMode =
        result.chatDisplayMode === 'sidebar' || result.chatDisplayMode === 'overlay'
          ? (result.chatDisplayMode as 'overlay' | 'sidebar')
          : 'overlay';
      this.overlayModeInput.checked = this.chatDisplayMode === 'overlay';
      this.sidebarModeInput.checked = this.chatDisplayMode === 'sidebar';
      this.updateInputState();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load settings:', error);
    }
  }

  private getSelectedChatDisplayMode(): 'overlay' | 'sidebar' {
    return this.sidebarModeInput.checked ? 'sidebar' : 'overlay';
  }

  private updateInputState(): void {
    const length = this.usernameInput.value.length;
    this.charCount.textContent = String(length);

    const hasInput = length > 0;
    const isDifferent = this.usernameInput.value !== this.username;
    const modeChanged = this.getSelectedChatDisplayMode() !== this.chatDisplayMode;
    this.saveButton.disabled = !hasInput || (!isDifferent && !modeChanged);

    if (length > 15) {
      this.charCount.style.color = '#dc3545';
    } else if (length > 10) {
      this.charCount.style.color = '#ffc107';
    } else {
      this.charCount.style.color = '#666';
    }
  }

  private async saveSettings(): Promise<void> {
    const username = this.usernameInput.value.trim();
    const selectedMode = this.getSelectedChatDisplayMode();

    if (!username) {
      this.showStatus('ユーザーネームを入力してください', 'error');
      return;
    }

    if (username.length > 20) {
      this.showStatus('ユーザーネームは20文字以内で入力してください', 'error');
      return;
    }

    try {
      await chrome.storage.local.set({
        globalUsername: username,
        chatDisplayMode: selectedMode,
      });
      this.username = username;
      this.chatDisplayMode = selectedMode;
      this.saveButton.disabled = true;
      this.showStatus('設定が保存されました', 'success');

      await this.updateTabSpecificUsernames(username);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to save settings:', error);
      this.showStatus('保存に失敗しました', 'error');
    }
  }

  private async updateTabSpecificUsernames(username: string): Promise<void> {
    try {
      const allData = (await chrome.storage.local.get(null)) as unknown as Record<string, unknown>;
      const updates: Record<string, string> = {};

      Object.keys(allData).forEach((key) => {
        if (key.endsWith('_username')) {
          updates[key] = username;
        }
      });

      if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to update tab-specific usernames:', error);
    }
  }

  private showStatus(message: string, type: 'success' | 'error' = 'success'): void {
    this.statusElement.textContent = message;
    this.statusElement.className = `status ${type}`;
    this.statusElement.style.display = 'block';

    window.setTimeout(() => {
      this.statusElement.style.display = 'none';
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // eslint-disable-next-line no-new
  new WatchPartyUsernamePopup();
});
