const CACHE_NAME = "workout-tracker-v24";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./sync.js",
  "./chime.wav",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Do not intercept backend REST API calls
  if (
    url.pathname.startsWith("/exercises") ||
    url.pathname.startsWith("/sessions") ||
    url.pathname.startsWith("/sync") ||
    url.pathname.startsWith("/coach")
  ) {
    return;
  }

  // Network-First with Offline Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
      })
  );
});

let scheduledTimerId = null;
let scheduledTimerResolve = null;

// Handle background notification triggers from RestTimerManager
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SCHEDULE_REST_TIMER") {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    if (scheduledTimerResolve) {
      scheduledTimerResolve();
      scheduledTimerResolve = null;
    }

    const delayMs = Math.max(0, event.data.delayMs || 0);
    const exerciseName = event.data.exerciseName || "Exercise";

    const waitPromise = new Promise((resolve) => {
      scheduledTimerResolve = resolve;
      scheduledTimerId = setTimeout(async () => {
        try {
          await self.registration.showNotification("Rest Complete!", {
            body: `Time for your next set of ${exerciseName}`,
            icon: "./icon-192.png",
            badge: "./icon-192.png",
            vibrate: [500, 200, 500, 200, 500],
            tag: "rest-timer-finished",
            renotify: true,
            requireInteraction: true,
            silent: false
          });
        } catch (err) {
          console.error("[SW] Notification display error:", err);
        } finally {
          scheduledTimerId = null;
          scheduledTimerResolve = null;
          resolve();
        }
      }, delayMs);
    });

    if (event.waitUntil) {
      event.waitUntil(waitPromise);
    }
  } else if (event.data.type === "CANCEL_REST_TIMER") {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    if (scheduledTimerResolve) {
      scheduledTimerResolve();
      scheduledTimerResolve = null;
    }
  } else if (event.data.type === "REST_FINISHED_NOTIFICATION") {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    if (scheduledTimerResolve) {
      scheduledTimerResolve();
      scheduledTimerResolve = null;
    }
    const title = event.data.title || "Rest Complete!";
    const body = event.data.body || "Time for your next set";
    const p = self.registration.showNotification(title, {
      body: body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [500, 200, 500, 200, 500],
      tag: "rest-timer-finished",
      renotify: true,
      requireInteraction: true,
      silent: false
    });
    if (event.waitUntil) {
      event.waitUntil(p);
    }
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});
