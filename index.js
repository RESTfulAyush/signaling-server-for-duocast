const express = require("express");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const http = require("http");
const app = express();
app.use(bodyParser.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Maps for user lookup
const emailToSocketMap = new Map();
const socketToEmailMap = new Map();
const messageQueue = new Map();

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  // User joins a room
  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;
    emailToSocketMap.set(emailId, socket.id);
    socketToEmailMap.set(socket.id, emailId);

    // Ensure a queue exists for this user
    if (!messageQueue.has(emailId)) messageQueue.set(emailId, []);

    console.log(
      "🧭 Current emailToSocketMap:",
      Array.from(emailToSocketMap.entries())
    );

    socket.join(roomId);
    socket.emit("joined-room", { roomId });
    socket.broadcast.to(roomId).emit("user-joined", { emailId });
  });

  // NEW: Client signals they're ready to receive queued messages
  socket.on("ready-to-receive", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (!emailId) return;

    const queuedMessages = messageQueue.get(emailId);
    if (queuedMessages && queuedMessages.length > 0) {
      console.log(
        `📬 Delivering ${queuedMessages.length} queued messages to ${emailId}`
      );
      queuedMessages.forEach((msg) => {
        socket.emit(msg.event, msg.data);
      });
      messageQueue.set(emailId, []);
    }
  });

  socket.on("call-user", (data) => {
    const { emailId, offer } = data;
    const fromEmail = socketToEmailMap.get(socket.id);
    const socketId = emailToSocketMap.get(emailId);

    console.log(
      "☎️ fromEmail:",
      fromEmail,
      "| to:",
      emailId,
      "| socketId:",
      socketId
    );

    if (!socketId) {
      console.log("⚠️ Target not ready, queuing message for", emailId);
      const queue = messageQueue.get(emailId) || [];
      queue.push({ event: "incoming-call", data: { from: fromEmail, offer } });
      messageQueue.set(emailId, queue);
      return;
    }

    socket.to(socketId).emit("incoming-call", { from: fromEmail, offer });
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (emailId) {
      emailToSocketMap.delete(emailId);
      socketToEmailMap.delete(socket.id);
      // Optionally clear queue
      messageQueue.delete(emailId);
    }
    console.log("🔌 Socket disconnected:", socket.id);
  });
});

server.listen(8000, () => {
  console.log("App + Socket server running on 8000");
});
