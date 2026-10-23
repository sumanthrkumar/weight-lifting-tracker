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

    const allExercises = (await this.getAll("exercises")) || [];
    const exerciseMap = new Map();
    const nameMap = new Map();
    for (const ex of allExercises) {
      if (ex.id) {
        exerciseMap.set(String(ex.id), ex);
        exerciseMap.set(String(ex.id).replace(/-/g, "").toLowerCase(), ex);
      }
      if (ex.name) {
        nameMap.set(ex.name.trim().toLowerCase(), ex);
      }
    }

    for (const log of logs) {
      const sets = await this.getByIndex("set_entries", "exercise_log_id", log.id);
      sets.sort((a, b) => a.set_number - b.set_number);
      log.sets = sets;

      // Populate exercise name and category if available
      let exercise = null;
      if (log.exercise_id) {
        exercise = exerciseMap.get(String(log.exercise_id)) ||
                   exerciseMap.get(String(log.exercise_id).replace(/-/g, "").toLowerCase());
      }
      if (!exercise && log.exercise_name) {
        const norm = log.exercise_name.trim().toLowerCase();
        exercise = nameMap.get(norm);
        if (!exercise) {
          for (const [name, ex] of nameMap.entries()) {
            if (norm.includes(name) || name.includes(norm)) {
              exercise = ex;
              break;
            }
          }
        }
      }

      if (exercise && (!log.exercise_name || log.exercise_name === "Exercise")) {
        log.exercise_name = exercise.name;
      } else {
        log.exercise_name = log.exercise_name || (exercise ? exercise.name : "Exercise");
      }

      let muscle = (exercise && exercise.target_muscle_group && exercise.target_muscle_group !== "Other")
        ? exercise.target_muscle_group
        : (log.target_muscle_group && log.target_muscle_group !== "Other" ? log.target_muscle_group : null);

      if (!muscle || muscle === "Other") {
        muscle = this.inferMuscleGroup(log.exercise_name || (exercise ? exercise.name : ""));
      }
      log.target_muscle_group = muscle || "Other";
    }

    session.exercise_logs = logs;
    return session;
  }

  // Heuristic muscle group inference from exercise names
  inferMuscleGroup(name) {
    if (!name) return "Other";
    const n = name.toLowerCase().trim();

    // Shoulders
    if (
      n.includes("overhead") ||
      n.includes("shoulder") ||
      /\bohps?\b/.test(n) ||
      n.includes("lateral") ||
      n.includes("delt") ||
      n.includes("military") ||
      n.includes("front raise") ||
      n.includes("rear delt") ||
      n.includes("face pull") ||
      n.includes("face-pull") ||
      n.includes("arnold") ||
      n.includes("upright row") ||
      n.includes("shrug")
    ) {
      return "Shoulders";
    }

    // Quads / Squats
    if (
      n.includes("squat") ||
      n.includes("leg press") ||
      n.includes("quad") ||
      n.includes("lunge") ||
      n.includes("hack") ||
      n.includes("leg extension") ||
      n.includes("step up") ||
      n.includes("step-up") ||
      n.includes("sissy")
    ) {
      return "Quads";
    }

    // Hamstrings
    if (
      n.includes("deadlift") ||
      /\brdls?\b/.test(n) ||
      n.includes("hamstring") ||
      n.includes("leg curl") ||
      n.includes("good morning") ||
      n.includes("glute ham")
    ) {
      return "Hamstrings";
    }

    // Glutes
    if (
      n.includes("glute") ||
      n.includes("hip thrust") ||
      n.includes("kickback") ||
      n.includes("abductor") ||
      n.includes("hip abduction") ||
      n.includes("bridge")
    ) {
      return "Glutes";
    }

    // Back
    if (
      n.includes("row") ||
      /\blats?\b/.test(n) ||
      /pull[\s-]?down/.test(n) ||
      /pull[\s-]?ups?/.test(n) ||
      /chin[\s-]?ups?/.test(n) ||
      n.includes("back") ||
      n.includes("t-bar") ||
      n.includes("t bar")
    ) {
      return "Back";
    }

    // Chest
    if (
      n.includes("bench") ||
      n.includes("chest") ||
      /push[\s-]?ups?/.test(n) ||
      n.includes("fly") ||
      n.includes("flye") ||
      n.includes("pec") ||
      n.includes("incline") ||
      n.includes("decline") ||
      n.includes("press")
    ) {
      return "Chest";
    }

    // Biceps
    if (
      n.includes("bicep") ||
      n.includes("curl") ||
      n.includes("preacher") ||
      n.includes("hammer")
    ) {
      return "Biceps";
    }

    // Triceps
    if (
      n.includes("tricep") ||
      n.includes("pushdown") ||
      n.includes("skull") ||
      n.includes("extension") ||
      n.includes("close-grip") ||
      n.includes("close grip") ||
      /\bdips?\b/.test(n)
    ) {
      return "Triceps";
    }

    // Calves
    if (n.includes("calf") || n.includes("calves")) {
      return "Calves";
    }

    // Core / Abs
    if (
      n.includes("abs") ||
      /\babs?\b/.test(n) ||
      n.includes("crunch") ||
      n.includes("plank") ||
      n.includes("core") ||
      n.includes("sit-up") ||
      n.includes("sit up") ||
      n.includes("leg raise")
    ) {
      return "Core";
    }

    return "Other";
  }
}

const localDB = new LocalDatabase();
