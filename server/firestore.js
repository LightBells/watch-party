const { Firestore } = require('@google-cloud/firestore');

const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
});

const COLLECTIONS = {
  ROOMS: 'rooms',
  USERS: 'users',
  MESSAGES: 'messages'
};

class FirestoreService {
  async createRoom(roomData) {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomData.id);
    await roomRef.set({
      ...roomData,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return roomData;
  }

  async getRoom(roomId) {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    const doc = await roomRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    return { id: doc.id, ...doc.data() };
  }

  async updateRoom(roomId, updateData) {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    await roomRef.update({
      ...updateData,
      updatedAt: new Date()
    });
  }

  async deleteRoom(roomId) {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    await roomRef.delete();
  }

  async addMessage(roomId, messageData) {
    const messagesRef = firestore.collection(COLLECTIONS.MESSAGES);
    const messageRef = await messagesRef.add({
      roomId,
      ...messageData,
      createdAt: new Date()
    });
    return messageRef.id;
  }

  async getMessages(roomId, limit = 50) {
    const messagesRef = firestore.collection(COLLECTIONS.MESSAGES)
      .where('roomId', '==', roomId)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    
    const snapshot = await messagesRef.get();
    const messages = [];
    
    snapshot.forEach(doc => {
      messages.push({ id: doc.id, ...doc.data() });
    });
    
    return messages.reverse();
  }

  async createUser(userData) {
    const userRef = firestore.collection(COLLECTIONS.USERS).doc(userData.id);
    await userRef.set({
      ...userData,
      createdAt: new Date(),
      lastActiveAt: new Date()
    });
    return userData;
  }

  async updateUserActivity(userId) {
    const userRef = firestore.collection(COLLECTIONS.USERS).doc(userId);
    await userRef.update({
      lastActiveAt: new Date()
    });
  }

  async getRoomMembers(roomId) {
    const roomRef = firestore.collection(COLLECTIONS.ROOMS).doc(roomId);
    const room = await this.getRoom(roomId);
    
    if (!room || !room.members) {
      return [];
    }
    
    const userPromises = room.members.map(userId => 
      firestore.collection(COLLECTIONS.USERS).doc(userId).get()
    );
    
    const userDocs = await Promise.all(userPromises);
    const members = userDocs
      .filter(doc => doc.exists)
      .map(doc => ({ id: doc.id, ...doc.data() }));
    
    return members;
  }
}

module.exports = new FirestoreService();