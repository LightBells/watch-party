# Watch Party

リアルタイム動画視聴同期アプリケーション
BackendにはGoogle App Engineを利用し、永続化にはFirestoreのデータストアを使います。
Frontendには、Google Chromeの拡張を利用し、Prime Video, dアニメストアの動画に対応しましょう.


### 主な機能

1. **ルーム管理**
   - ルーム作成
   - ホスト自動選択
   - メンバー管理

2. **リアルタイム同期**
   - 動画の再生/停止同期
   - コメント配信
   - 接続状態管理

3. **認証・セキュリティ**
   - JWT認証
   - ユーザーID管理
   - セッション管理

### サポートするメッセージタイプ

- **Join**: ルーム参加
- **Leave**: ルーム離脱
- **Comment**: コメント送信
- **Play**: 再生開始
- **Stop**: 再生停止
- **Sync**: 時間同期
- **Navigate**: ページ移動同期
- **DeepLink**: 共有URLからの自動ルーム参加 (例: `...#watchparty-room=ROOMID`)

### 認証フロー

1. クライアント接続
2. サーバーがJWTトークン生成
3. 以降のリクエストでJWTトークンを検証
4. トークンからユーザーIDとルーム権限を取得

## 改善点・拡張案

- [ ] メンバーリスト表示
- [ ] プライベートルーム（パスワード保護）
- [ ] 動画URL共有機能
- [ ] ユーザープロフィール
- [ ] モバイル対応
- [ ] 負荷分散対応

## ライセンス

MIT License

## 技術スタックアップデート

- バックエンドは TypeScript + Express + Socket.IO で構成され、`npm run build:server` で `dist/server` にトランスパイルされます。
- Chrome 拡張機能も TypeScript 化され、Webpack で `extension/dist` にバンドルされます。
- 開発時は `npm run dev` (サーバー) や `npm run build:extension -- --watch` を利用すると効率的です。
