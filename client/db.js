// Local offline storage layer using browser IndexedDB

const DB_NAME = "WeightliftingTrackerDB";
const DB_VERSION = 2;

class LocalDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. exercises catalog
        if (!db.objectStoreNames.contains("exercises")) {
          db.createObjectStore("exercises", { keyPath: "id" });
        }

        // 2. workout_sessions
        if (!db.objectStoreNames.contains("workout_sessions")) {
          const sessionStore = db.createObjectStore("workout_sessions", { keyPath: "id" });
          sessionStore.createIndex("started_at", "started_at", { unique: false });
          sessionStore.createIndex("synced", "synced", { unique: false });
          sessionStore.createIndex("status", "status", { unique: false });
        }

        // 3. exercise_logs
        if (!db.objectStoreNames.contains("exercise_logs")) {
          const logStore = db.createObjectStore("exercise_logs", { keyPath: "id" });
          logStore.createIndex("workout_session_id", "workout_session_id", { unique: false });
        }

        // 4. set_entries
        if (!db.objectStoreNames.contains("set_entries")) {
          const setStore = db.createObjectStore("set_entries", { keyPath: "id" });
          setStore.createIndex("exercise_log_id", "exercise_log_id", { unique: false });
        }

        // 5. app_meta (tracks active draft session ID, settings)
        if (!db.objectStoreNames.contains("app_meta")) {
          db.createObjectStore("app_meta", { keyPath: "key" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject("IndexedDB error: " + event.target.errorCode);
      };
    });
  }

  async put(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], "readonly");
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // Assembles full session with nested logs and sets from local storage
  async getFullSession(sessionId) {
    const session = await this.get("workout_sessions", sessionId);
    if (!session) return null;

    const logs = await this.getByIndex("exercise_logs", "workout_session_id", sessionId);
    logs.sort((a, b) => a.order_index - b.order_index);

    for (const log of logs) {
      const sets = await this.getByIndex("set_entries", "exercise_log_id", log.id);
      sets.sort((a, b) => a.set_number - b.set_number);
      log.sets = sets;

      // Populate exercise name if available
      const exercise = await this.get("exercises", log.exercise_id);
      log.exercise_name = exercise ? exercise.name : (log.exercise_name || "Exercise");
    }

    session.exercise_logs = logs;
    return session;
  }
}

const localDB = new LocalDatabase();
