class WatchPartyUsernamePopup {
    constructor() {
        this.username = null;
        
        this.initializeElements();
        this.bindEvents();
        this.loadUsername();
    }
    
    initializeElements() {
        this.usernameInput = document.getElementById('username');
        this.saveButton = document.getElementById('save-username');
        this.charCount = document.getElementById('char-count');
        this.statusElement = document.getElementById('username-status');
    }
    
    bindEvents() {
        this.usernameInput.addEventListener('input', () => this.updateCharCount());
        this.saveButton.addEventListener('click', () => this.saveUsername());
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.saveButton.disabled) {
                this.saveUsername();
            }
        });
    }
    
    async loadUsername() {
        try {
            const result = await chrome.storage.local.get(['globalUsername']);
            if (result.globalUsername) {
                this.username = result.globalUsername;
                this.usernameInput.value = this.username;
                this.updateCharCount();
            }
        } catch (error) {
            console.log('Failed to load username:', error);
        }
    }
    
    updateCharCount() {
        const length = this.usernameInput.value.length;
        this.charCount.textContent = length;
        
        // 入力があり、現在保存されているものと異なる場合のみ保存ボタンを有効化
        const hasInput = length > 0;
        const isDifferent = this.usernameInput.value !== this.username;
        this.saveButton.disabled = !hasInput || !isDifferent;
        
        // 文字数によって色を変更
        if (length > 15) {
            this.charCount.style.color = '#dc3545';
        } else if (length > 10) {
            this.charCount.style.color = '#ffc107';
        } else {
            this.charCount.style.color = '#666';
        }
    }
    
    async saveUsername() {
        const username = this.usernameInput.value.trim();
        
        if (!username) {
            this.showStatus('ユーザーネームを入力してください', 'error');
            return;
        }
        
        if (username.length > 20) {
            this.showStatus('ユーザーネームは20文字以内で入力してください', 'error');
            return;
        }
        
        try {
            await chrome.storage.local.set({ globalUsername: username });
            this.username = username;
            this.saveButton.disabled = true;
            this.showStatus('ユーザーネームが保存されました', 'success');
            
            // 既存のタブ固有のユーザーネームも更新
            this.updateTabSpecificUsernames(username);
            
        } catch (error) {
            console.log('Failed to save username:', error);
            this.showStatus('保存に失敗しました', 'error');
        }
    }
    
    async updateTabSpecificUsernames(username) {
        try {
            // 現在のストレージからタブ固有のキーを取得
            const allData = await chrome.storage.local.get(null);
            const updates = {};
            
            // tab_*_username キーを見つけて更新
            Object.keys(allData).forEach(key => {
                if (key.endsWith('_username')) {
                    updates[key] = username;
                }
            });
            
            if (Object.keys(updates).length > 0) {
                await chrome.storage.local.set(updates);
            }
        } catch (error) {
            console.log('Failed to update tab-specific usernames:', error);
        }
    }
    
    showStatus(message, type = 'success') {
        this.statusElement.textContent = message;
        this.statusElement.className = `status ${type}`;
        this.statusElement.style.display = 'block';
        
        setTimeout(() => {
            this.statusElement.style.display = 'none';
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new WatchPartyUsernamePopup();
});