/* Cagómetro · Service worker de Firebase Cloud Messaging
   Recibe los push en segundo plano (app cerrada / sin foco) y muestra el banner. */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAPDB_Jw8JePerKkaTlPzNx5NC8AXK2qhc",
  authDomain: "cagometro-app.firebaseapp.com",
  projectId: "cagometro-app",
  storageBucket: "cagometro-app.firebasestorage.app",
  messagingSenderId: "877322489104",
  appId: "1:877322489104:web:5db0fa4edaec9f8a886995",
});

const messaging = firebase.messaging();

// Mensajes "data" (sin notification): los pintamos nosotros para controlar el aspecto.
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  const title = d.title || "El Cagómetro 💩";
  self.registration.showNotification(title, {
    body: d.body || "",
    icon: "icon-192.png",   // logo a color (cuerpo de la notificación)
    badge: "badge.png",     // silueta monocroma (barra de estado Android)
    tag: d.tag || ("cagometro-" + Date.now()),
    data: { url: "./" },
  });
});

// Al tocar la notificación, abre/enfoca la app.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow("./");
  }));
});
