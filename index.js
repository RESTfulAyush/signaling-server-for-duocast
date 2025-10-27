const express = require("express");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const http = require("http");

const app = express();
app.use(bodyParser.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const emailToSocketMap = new Map();
const socketToEmailMap = new Map();
const messageQueue = new Map();
const readyUsers = new Set(); // Track who's ready

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;

    emailToSocketMap.set(emailId, socket.id);
    socketToEmailMap.set(socket.id, emailId);

    // Initialize queue for this user
    if (!messageQueue.has(emailId)) {
      messageQueue.set(emailId, []);
    }

    socket.join(roomId);
    socket.emit("joined-room", { roomId });
    socket.broadcast.to(roomId).emit("user-joined", { emailId });
  });

  socket.on("ready-to-receive", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (!emailId) return;

    // Mark as ready
    readyUsers.add(emailId);

    // Deliver all queued messages
    const queuedMessages = messageQueue.get(emailId) || [];
    if (queuedMessages.length > 0) {
      console.log(
        `Delivering ${queuedMessages.length} queued messages to ${emailId}`
      );
      queuedMessages.forEach((msg) => {
        socket.emit(msg.event, msg.data);
      });
      messageQueue.set(emailId, []); // Clear queue
    }
  });

  socket.on("call-user", (data) => {
    const { emailId, offer } = data;
    const fromEmail = socketToEmailMap.get(socket.id);
    const targetSocketId = emailToSocketMap.get(emailId);

    console.log("Call from:", fromEmail, "to:", emailId);

    if (!targetSocketId || !readyUsers.has(emailId)) {
      // Queue it - either socket doesn't exist or user not ready
      console.log("Queueing message for", emailId);
      const queue = messageQueue.get(emailId) || [];
      queue.push({ event: "incoming-call", data: { from: fromEmail, offer } });
      messageQueue.set(emailId, queue);
      return;
    }

    io.to(targetSocketId).emit("incoming-call", { from: fromEmail, offer });
  });

  socket.on("call-accepted", (data) => {
    const { emailId, ans } = data;
    const socketId = emailToSocketMap.get(emailId);
    socket.to(socketId).emit("call-accepted", { ans });
  });

  socket.on("disconnect", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (emailId) {
      emailToSocketMap.delete(emailId);
      socketToEmailMap.delete(socket.id);
      readyUsers.delete(emailId);
      messageQueue.delete(emailId);
    }
  });
});

server.listen(8000, () => {
  console.log("Signaling server running on 8000");
});
