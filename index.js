const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3001 });
const rooms = new Map();

wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (err) {
      console.error("❌ Invalid message:", data);
      return;
    }

    const { type, roomId, payload } = message;

    if (type === "join") {
      if (!rooms.has(roomId)) {
        rooms.set(roomId, []);
      }

      const clients = rooms.get(roomId);

      if (!clients.includes(socket)) {
        if (clients.length >= 2) {
          socket.send(
            JSON.stringify({ type: "error", payload: "Room is full" })
          );
          return;
        }
        clients.push(socket);
        socket.roomId = roomId;
      }

      return;
    }

    // Forward only valid signaling messages
    const allowedTypes = ["offer", "answer", "ice-candidate", "peer-left"];
    if (!allowedTypes.includes(type)) return;

    const clients = rooms.get(roomId) || [];
    clients.forEach((client) => {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, payload }));
      }
    });
  });

  socket.on("close", () => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const clients = rooms.get(roomId);
      const index = clients.indexOf(socket);
      if (index !== -1) {
        clients.splice(index, 1);
        if (clients.length === 0) {
          rooms.delete(roomId);
        }
      }
    }
  });
});

console.log("✅ WebSocket signaling server running on ws://localhost:3001");
