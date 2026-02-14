# Test Implementation Checklist

## 1. Server
- [x] join-room API normal/error cases
- [x] socket play/pause/sync propagation
- [x] socket comment/comment-history behavior
- [x] host navigate and member-navigate behavior
- [x] disconnect host reassignment behavior
- [x] heartbeat/member-status behavior

## 2. Frontend Content Features
- [x] coreFeature tests
- [x] storageFeature tests
- [x] navigationFeature tests
- [x] roomFeature tests
- [x] chatFeature tests
- [x] uiFeature missing tests
- [x] videoFeature missing tests

## 3. Extension Entry Points
- [x] background.ts tests
- [x] popup.ts tests
- [x] content.ts bootstrap test

## 4. Server Firestore Service
- [x] firestore create/get/update/delete room tests
- [x] firestore add/get comments tests
- [x] firestore user/member tests
