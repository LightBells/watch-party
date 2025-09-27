import { Firestore } from '@google-cloud/firestore';

type Timestamp = Date;

export interface RoomRecord {
  id: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  members?: string[];
  [key: string]: unknown;
}

export interface MessageRecord {
  id?: string;
  roomId: string;
  message: string;
  userId: string;
  createdAt?: Timestamp;
  [key: string]: unknown;
}

export interface UserRecord {
  id: string;
  createdAt?: Timestamp;
  lastActiveAt?: Timestamp;
  [key: string]: unknown;
}

const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
});

const COLLECTIONS = {
  ROOMS: 'rooms',
  USERS: 'users',
  MESSAGES: 'messages',
} as const;

class FirestoreService {
  async createRoom(roomData: RoomRecord): Promise<RoomRecord> {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomData.id);
    await roomRef.set({
      ...roomData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return roomData;
  }

  async getRoom(roomId: string): Promise<RoomRecord | null> {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    const doc = await roomRef.get();

    if (!doc.exists) {
      return null;
    }

    return { id: doc.id, ...(doc.data() as Omit<RoomRecord, 'id'>) };
  }

  async updateRoom(roomId: string, updateData: Partial<RoomRecord>): Promise<void> {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    await roomRef.update({
      ...updateData,
      updatedAt: new Date(),
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    await roomRef.delete();
  }

  async addMessage(roomId: string, messageData: Omit<MessageRecord, 'roomId' | 'createdAt'>): Promise<string> {
    const messagesRef = firestore.collection(COLLECTIONS.MESSAGES);
    const messageRef = await messagesRef.add({
      roomId,
      ...messageData,
      createdAt: new Date(),
    });
    return messageRef.id;
  }

  async getMessages(roomId: string, limit = 50): Promise<MessageRecord[]> {
    const messagesRef = firestore
      .collection(COLLECTIONS.MESSAGES)
      .where('roomId', '==', roomId)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    const snapshot = await messagesRef.get();
    const messages: MessageRecord[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data() as MessageRecord;
      messages.push({ ...data, id: doc.id });
    });

    return messages.reverse();
  }

  async createUser(userData: UserRecord): Promise<UserRecord> {
    const userRef = firestore.collection(COLLECTIONS.USERS).doc(userData.id);
    await userRef.set({
      ...userData,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });
    return userData;
  }

  async updateUserActivity(userId: string): Promise<void> {
    const userRef = firestore.collection(COLLECTIONS.USERS).doc(userId);
    await userRef.update({
      lastActiveAt: new Date(),
    });
  }

  async getRoomMembers(roomId: string): Promise<UserRecord[]> {
    const room = await this.getRoom(roomId);

    if (!room || !room.members?.length) {
      return [];
    }

    const userPromises = room.members.map((userId) => firestore.collection(COLLECTIONS.USERS).doc(userId).get());

    const userDocs = await Promise.all(userPromises);
    return userDocs
      .filter((doc) => doc.exists)
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<UserRecord, 'id'>) }));
  }
}

const firestoreService = new FirestoreService();
export default firestoreService;
