# ユーザーネーム機能仕様

**実装日**: 2025-01-05  
**バージョン**: 1.0  
**最終更新**: 2025-01-05

## 概要
Watch Party Extensionにユーザーネーム設定機能を追加し、ユーザーの識別性を向上させる。

## 機能仕様

### 1. ユーザーネーム入力
- **場所**: ポップアップのルーム参加画面
- **制限**: 最大20文字
- **必須**: ルーム参加時に入力必須
- **保存**: 一度設定したユーザーネームは次回も自動で入力される

### 2. ユーザーネーム保存
- **グローバル保存**: `globalUsername`キーでChrome storageに保存
- **タブ固有保存**: `tab_{tabId}_username`キーでタブごとに保存
- **永続化**: 拡張機能を再起動しても保持される

### 3. 表示機能
- **チャット**: ユーザーネームでメッセージ送信者を識別
- **メンバーリスト**: 参加者一覧でユーザーネームを表示
- **画面上コメント**: 動画上に表示されるコメントでユーザーネームを使用

## 実装詳細

### Frontend (Extension)

#### popup.html
```html
<div class="input-group">
    <label for="username">ユーザーネーム</label>
    <input type="text" id="username" placeholder="ユーザーネームを入力" maxlength="20">
</div>
```

#### popup.js
- `this.username`: 現在のユーザーネーム
- `loadStoredData()`: グローバルユーザーネームの読み込み
- `joinRoom()`: ユーザーネーム必須チェック & 保存
- `updateMembers()`: メンバーリストでのユーザーネーム表示
- `setupMessageListener()`: チャットメッセージでのユーザーネーム表示

#### content.js
- `this.username`: 現在のユーザーネーム
- `loadStoredData()`: タブ固有ユーザーネームの読み込み
- `showComment()`: 画面上コメントでのユーザーネーム表示

### Backend (Server)

#### server/index.js
- `/api/join-room`: ユーザーネームを受け取り、メンバー情報に保存
- `room.members`: ユーザーネーム情報を含むメンバーデータ構造
- `comment`イベント: コメント送信時にユーザーネームを付与

## データ構造

### Chrome Storage
```javascript
{
  "globalUsername": "ユーザーネーム",
  "tab_12345_username": "ユーザーネーム",
  "tab_12345_roomId": "ABC123",
  "tab_12345_token": "jwt_token",
  "tab_12345_userId": "uuid"
}
```

### Server Room Data
```javascript
{
  id: "roomId",
  host: "userId",
  members: Map {
    "userId" => {
      id: "userId",
      username: "ユーザーネーム",
      joinedAt: timestamp
    }
  },
  videoState: {...}
}
```

### Socket Events
```javascript
// Comment event
{
  userId: "userId",
  username: "ユーザーネーム",
  message: "メッセージ",
  timestamp: timestamp
}
```

## UI/UX改善点

### 表示優先度
1. **自分**: "あなた"
2. **システム**: "システム"
3. **ユーザーネーム設定済み**: 実際のユーザーネーム
4. **ユーザーネーム未設定**: "ユーザー{userIdの先頭8文字}"

### 入力検証
- 空文字チェック
- 最大長チェック（20文字）
- HTML特殊文字のエスケープ

## 今後の拡張可能性

1. **ユーザーネーム重複チェック**
2. **ユーザーアバター機能**
3. **ユーザーネーム変更機能**
4. **ユーザーネーム履歴管理**
5. **絵文字サポート**

## 互換性

- **既存データ**: ユーザーネーム未設定の場合は従来通りuserIdベースで表示
- **サーバー**: 新旧クライアント混在環境でも動作
- **拡張機能**: Chrome拡張機能の標準的なstorage APIを使用

## テスト項目

1. ユーザーネーム入力・保存・読み込み
2. ルーム参加時のユーザーネーム必須チェック
3. チャットでのユーザーネーム表示
4. メンバーリストでのユーザーネーム表示
5. 画面上コメントでのユーザーネーム表示
6. 複数タブでの独立したユーザーネーム管理
7. 拡張機能再起動後のユーザーネーム保持