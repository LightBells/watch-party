import { Firestore } from '@google-cloud/firestore';

type Timestamp = Date;

export interface RoomRecord {
  id: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  members?: string[];
  [key: string]: unknown;
}

export interface CommentRecord {
  id?: string;
  roomId: string;
  message: string;
  userId: string;
  username?: string;
  commands?: string | null;
  url?: string | null;
  playbackTime?: number | null;
  mediaInfo?: string | null;
  createdAt?: Timestamp;
  [key: string]: unknown;
}

export interface UserRecord {
  id: string;
  createdAt?: Timestamp;
  lastActiveAt?: Timestamp;
  [key: string]: unknown;
}

let firestoreInstance: Firestore | null = null;

const getFirestore = (): Firestore => {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  const options = process.env.FIRESTORE_PROJECT_ID
    ? { projectId: process.env.FIRESTORE_PROJECT_ID }
    : undefined;

  firestoreInstance = options ? new Firestore(options) : new Firestore();
  return firestoreInstance;
};

const COLLECTIONS = {
  ROOMS: 'rooms',
  USERS: 'users',
  COMMENTS: 'comments',
} as const;

class FirestoreService {
  async createRoom(roomData: RoomRecord): Promise<RoomRecord> {
    const roomRef = getFirestore().collection(COLLECTIONS.ROOMS).doc(roomData.id);
    await roomRef.set({
      ...roomData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return roomData;
  }

  async getRoom(roomId: string): Promise<RoomRecord | null> {
    const roomRef = getFirestore().collection(COLLECTIONS.ROOMS).doc(roomId);
    const doc = await roomRef.get();

    if (!doc.exists) {
      return null;
    }

    return { id: doc.id, ...(doc.data() as Omit<RoomRecord, 'id'>) };
  }

  async updateRoom(roomId: string, updateData: Partial<RoomRecord>): Promise<void> {
    const roomRef = getFirestore().collection(COLLECTIONS.ROOMS).doc(roomId);
    await roomRef.update({
      ...updateData,
      updatedAt: new Date(),
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    const roomRef = getFirestore().collection(COLLECTIONS.ROOMS).doc(roomId);
    await roomRef.delete();
  }

  async addComment(
    roomId: string,
    commentData: Omit<CommentRecord, 'roomId' | 'createdAt'>,
  ): Promise<string> {
    const commentsRef = getFirestore().collection(COLLECTIONS.COMMENTS);
    const commentRef = await commentsRef.add({
      roomId,
      ...commentData,
      createdAt: new Date(),
    });
    return commentRef.id;
  }

  async getComments(roomId: string, limit = 50): Promise<CommentRecord[]> {
    const commentsRef = getFirestore()
      .collection(COLLECTIONS.COMMENTS)
      .where('roomId', '==', roomId)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    const snapshot = await commentsRef.get();
    const comments: CommentRecord[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data() as CommentRecord & { createdAt?: unknown };
      const createdAtRaw = data.createdAt;
      let createdAt: Date | undefined;

      if (createdAtRaw instanceof Date) {
        createdAt = createdAtRaw;
      } else if (
        createdAtRaw &&
        typeof createdAtRaw === 'object' &&
        'toDate' in createdAtRaw &&
        typeof (createdAtRaw as { toDate?: unknown }).toDate === 'function'
      ) {
        createdAt = (createdAtRaw as { toDate: () => Date }).toDate();
      }

      const playbackTime = typeof data.playbackTime === 'number' ? data.playbackTime : null;

      comments.push({ ...data, id: doc.id, createdAt, playbackTime });
    });

    return comments.reverse();
  }

  async createUser(userData: UserRecord): Promise<UserRecord> {
    const userRef = getFirestore().collection(COLLECTIONS.USERS).doc(userData.id);
    await userRef.set({
      ...userData,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });
    return userData;
  }

  async updateUserActivity(userId: string): Promise<void> {
    const userRef = getFirestore().collection(COLLECTIONS.USERS).doc(userId);
    await userRef.update({
      lastActiveAt: new Date(),
    });
  }

  async getRoomMembers(roomId: string): Promise<UserRecord[]> {
    const room = await this.getRoom(roomId);

    if (!room || !room.members?.length) {
      return [];
    }

    const userPromises = room.members.map((userId) => getFirestore().collection(COLLECTIONS.USERS).doc(userId).get());

    const userDocs = await Promise.all(userPromises);
    return userDocs
      .filter((doc) => doc.exists)
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<UserRecord, 'id'>) }));
  }
}

const firestoreService = new FirestoreService();
export default firestoreService;
