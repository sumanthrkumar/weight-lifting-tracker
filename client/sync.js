// Network Synchronization Manager for Offline-First Data Ingestion

const API_BASE_URL = window.location.origin;

function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const config = { ...options, signal: controller.signal };
  return fetch(url, config).finally(() => clearTimeout(id));
}
window.fetchWithTimeout = fetchWithTimeout;

class SyncManager {
  constructor(db) {
    this.db = db;
    this.isOnline = navigator.onLine;
    this.serverReachable = null;
    this.isSyncing = false;
    this.syncQueued = false;
    this.pollInterval = null;
  }

  init() {
    window.addEventListener("online", () => this.handleNetworkChange(true));
    window.addEventListener("offline", () => this.handleNetworkChange(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.syncNow().catch(console.warn);
      }
    });

    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => {
        this.checkAndSyncPending();
      }, 10000);
    }

    this.updateStatusBadge();
  }

  async checkAndSyncPending() {
    try {
      const allSessions = await this.db.getAll("workout_sessions");
      const hasUnsynced = allSessions.some(
        (s) => s.status === "completed" && s.synced === false
      );
      if (hasUnsynced && !this.isSyncing) {
        await this.syncNow();
      }
    } catch (e) {
      // Ignore background check errors
    }
  }

  handleNetworkChange(isOnline) {
    this.isOnline = isOnline;
    this.updateStatusBadge();
    if (isOnline) {
      this.syncNow();
    }
  }

  updateStatusBadge(statusText = null, isDraft = false) {
    const badge = document.getElementById("status-badge");
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");

    if (!badge || !text) return;

    if (this.isSyncing) {
      text.textContent = "Syncing...";
      if (dot) dot.className = "status-dot syncing";
      return;
    }

    if (isDraft) {
      text.textContent = "Local (Draft Mode)";
      if (dot) dot.className = "status-dot draft";
      return;
    }

    if (statusText) {
      text.textContent = statusText;
      if (dot) {
        if (statusText.includes("Online") || statusText.includes("Synced")) {
          dot.className = "status-dot online";
        } else if (statusText.includes("Pending")) {
          dot.className = "status-dot draft";
        } else {
          dot.className = "status-dot offline";
        }
      }
      return;
    }

    if (this.isOnline && this.serverReachable === true) {
      text.textContent = "Online (Synced)";
      if (dot) dot.className = "status-dot online";
    } else if (this.isOnline && this.serverReachable === null) {
      text.textContent = "Connecting...";
      if (dot) dot.className = "status-dot syncing";
    } else {
      text.textContent = "Offline (Local)";
      if (dot) dot.className = "status-dot offline";
    }
  }

  // Pull exercise library from server into local IndexedDB and deduplicate by normalized name
  async pullExercises() {
    if (!this.isOnline) {
      this.serverReachable = false;
      this.updateStatusBadge();
      return { success: false, reachable: false, reason: "offline" };
    }

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/exercises`, {}, 3000);
      if (!response.ok) throw new Error("Failed to fetch exercises");
      this.serverReachable = true;
      this.updateStatusBadge();

      const serverExercises = await response.json();
      const localExercises = await this.db.getAll("exercises");
      const localLogs = await this.db.getAll("exercise_logs");

      for (const serverEx of serverExercises) {
        const normName = (serverEx.name || "").trim().toLowerCase();

        // Identify any local exercises with identical normalized names but differing IDs
        const duplicates = localExercises.filter(
          (lx) => (lx.name || "").trim().toLowerCase() === normName && lx.id !== serverEx.id
        );

        for (const dup of duplicates) {
          // Remap local exercise_logs referencing the duplicate to the canonical server ID
          for (const log of localLogs) {
            if (log.exercise_id === dup.id) {
              log.exercise_id = serverEx.id;
              log.exercise_name = serverEx.name;
              log.target_muscle_group = serverEx.target_muscle_group || log.target_muscle_group;
              await this.db.put("exercise_logs", log);
            }
          }
          // Remove duplicate local exercise record
          await this.db.delete("exercises", dup.id);
        }

        // Store canonical exercise record
        await this.db.put("exercises", serverEx);
      }
      return { success: true, reachable: true, count: serverExercises.length };
    } catch (error) {
      this.serverReachable = false;
      this.updateStatusBadge();
      console.warn("Could not pull exercises from server (laptop may be off):", error);
      return { success: false, reachable: false, error };
    }
  }

  // Pull past workout history from server into local IndexedDB
  async pullHistory() {
    if (!this.isOnline) {
      this.serverReachable = false;
      this.updateStatusBadge();
      return { success: false, reachable: false, reason: "offline" };
    }

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/sessions`, {}, 3000);
      if (!response.ok) throw new Error("Failed to fetch sessions");
      this.serverReachable = true;
      this.updateStatusBadge();

      const sessions = await response.json();
      const localSessions = await this.db.getAll("workout_sessions");

      const parseUtcTime = (dt) => {
        if (!dt) return 0;
        const s = (typeof dt === "string" && !dt.endsWith("Z") && !dt.includes("+") && !dt.includes("-", 10))
          ? dt + "Z"
          : dt;
        return new Date(s).getTime();
      };

      // Self-healing: check for any local completed sessions that are missing on the server
      const serverSessionIds = new Set(sessions.map((s) => s.id));
      let needsRestore = false;
      for (const ls of localSessions) {
        if (ls.status === "completed" && !serverSessionIds.has(ls.id)) {
          ls.synced = false;
          await this.db.put("workout_sessions", ls);
          needsRestore = true;
        }
      }
      if (needsRestore) {
        console.log("[SYNC] Detected missing server session(s). Queued local sessions for sync.");
        this.syncNow().catch(console.warn);
      }

      for (const session of sessions) {
        const serverTime = parseUtcTime(session.started_at);
        const serverName = (session.name || "").trim().toLowerCase();

        // Find if an existing local completed session has a different ID but matches this server session's timestamp and name
        const matchingLocal = localSessions.find((ls) =>
          ls.id !== session.id &&
          ls.status === "completed" &&
          (ls.name || "").trim().toLowerCase() === serverName &&
          Math.abs(parseUtcTime(ls.started_at) - serverTime) < 60000
        );

        if (matchingLocal) {
          await this.db.delete("workout_sessions", matchingLocal.id);
          const oldLogs = await this.db.getByIndex("exercise_logs", "workout_session_id", matchingLocal.id);
          for (const ol of oldLogs) {
            await this.db.delete("exercise_logs", ol.id);
            const oldSets = await this.db.getByIndex("set_entries", "exercise_log_id", ol.id);
            for (const os of oldSets) {
              await this.db.delete("set_entries", os.id);
            }
          }
        }

        const normalizedStartedAt = (session.started_at && typeof session.started_at === "string" && !session.started_at.endsWith("Z") && !session.started_at.includes("+") && !session.started_at.includes("-", 10))
          ? session.started_at + "Z"
          : session.started_at;

        const normalizedCompletedAt = (session.completed_at && typeof session.completed_at === "string" && !session.completed_at.endsWith("Z") && !session.completed_at.includes("+") && !session.completed_at.includes("-", 10))
          ? session.completed_at + "Z"
          : session.completed_at;

        await this.db.put("workout_sessions", {
          id: session.id,
          name: session.name,
          started_at: normalizedStartedAt,
          completed_at: normalizedCompletedAt,
          session_notes: session.session_notes,
          routine_id: session.routine_id,
          synced: true,
          status: "completed"
        });

        if (session.exercise_logs) {
          for (const log of session.exercise_logs) {
            const resolvedMuscle = (log.target_muscle_group && log.target_muscle_group !== "Other")
              ? log.target_muscle_group
              : ((this.db && this.db.inferMuscleGroup) ? this.db.inferMuscleGroup(log.exercise_name) : "Other");

            await this.db.put("exercise_logs", {
              id: log.id,
              workout_session_id: session.id,
              exercise_id: log.exercise_id,
              exercise_name: log.exercise_name || "Exercise",
              target_muscle_group: resolvedMuscle || "Other",
              order_index: log.order_index,
              notes: log.notes
            });

            if (log.sets) {
              for (const set of log.sets) {
                await this.db.put("set_entries", {
                  id: set.id,
                  exercise_log_id: log.id,
                  set_number: set.set_number,
                  set_type: set.set_type,
                  weight: set.weight,
                  reps: set.reps,
                  rir: set.rir,
                  completed: set.completed,
                  notes: set.notes
                });
              }
            }
          }
        }
      }
      return { success: true, reachable: true, count: sessions.length };
    } catch (error) {
      this.serverReachable = false;
      this.updateStatusBadge();
      console.warn("Could not pull history from server (laptop may be off):", error);
      return { success: false, reachable: false, error };
    }
  }

  // Push unsynced sessions to POST /sync
  async syncNow() {
    if (this.isSyncing) {
      this.syncQueued = true;
      return { success: false, inProgress: true };
    }

    try {
      this.isSyncing = true;
      this.updateStatusBadge();

      // Find all completed sessions that are not marked synced
      const allSessions = await this.db.getAll("workout_sessions");
      const unsyncedSessions = allSessions.filter(
        (s) => s.status === "completed" && s.synced === false
      );

      if (unsyncedSessions.length === 0) {
        if (this.serverReachable === false) {
          this.updateStatusBadge("Offline (Local)");
          return { success: false, reachable: false, syncedCount: 0 };
        } else if (this.serverReachable === true) {
          this.updateStatusBadge("Online (Synced)");
          return { success: true, reachable: true, syncedCount: 0 };
        } else {
          try {
            const probe = await fetchWithTimeout(`${API_BASE_URL}/server-info`, {}, 1500);
            this.serverReachable = probe.ok;
          } catch {
            this.serverReachable = false;
          }
          this.updateStatusBadge();
          return { success: this.serverReachable, reachable: this.serverReachable, syncedCount: 0 };
        }
      }

      // Assemble full nested payload for each session
      const payloadSessions = [];
      for (const s of unsyncedSessions) {
        const full = await this.db.getFullSession(s.id);
        if (full) {
          payloadSessions.push({
            id: full.id,
            name: full.name,
            started_at: full.started_at,
            completed_at: full.completed_at,
            session_notes: full.session_notes,
            routine_id: full.routine_id,
            exercise_logs: full.exercise_logs.map((log) => ({
              id: log.id,
              exercise_id: log.exercise_id,
              exercise_name: log.exercise_name || null,
              target_muscle_group: log.target_muscle_group || null,
              order_index: log.order_index,
              notes: log.notes,
              sets: log.sets.map((set) => ({
                id: set.id,
                set_number: set.set_number,
                set_type: set.set_type || "normal",
                weight: set.weight,
                reps: set.reps,
                rir: set.rir,
                completed: set.completed,
                notes: set.notes
              }))
            }))
          });
        }
      }

      const response = await fetchWithTimeout(`${API_BASE_URL}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: payloadSessions })
      }, 4000);

      if (!response.ok) {
        throw new Error(`Sync failed with status: ${response.status}`);
      }

      this.serverReachable = true;

      // Mark local sessions as synced
      for (const s of unsyncedSessions) {
        s.synced = true;
        await this.db.put("workout_sessions", s);
      }

      window.dispatchEvent(new CustomEvent("workout-sync-complete"));
      this.updateStatusBadge("Online (Synced)");
      return { success: true, reachable: true, syncedCount: unsyncedSessions.length };
    } catch (error) {
      this.serverReachable = false;
      console.warn("Background sync error (laptop may be off):", error);
      this.updateStatusBadge("Sync Pending");
      return { success: false, reachable: false, error };
    } finally {
      this.isSyncing = false;
      if (this.syncQueued) {
        this.syncQueued = false;
        setTimeout(() => this.syncNow(), 500);
      }
    }
  }
}

const syncManager = new SyncManager(localDB);
