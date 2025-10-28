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
const readyUsers = new Set();
const roomToUsers = new Map(); // ✅ Track users in each room

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;

    emailToSocketMap.set(emailId, socket.id);
    socketToEmailMap.set(socket.id, emailId);

    if (!messageQueue.has(emailId)) {
      messageQueue.set(emailId, []);
    }

    socket.join(roomId);

    // ✅ Track room membership
    if (!roomToUsers.has(roomId)) {
      roomToUsers.set(roomId, new Set());
    }
    roomToUsers.get(roomId).add(emailId);

    console.log(`${emailId} joined room ${roomId}`);

    // Get existing users in the room (excluding current user)
    const existingUsers = Array.from(roomToUsers.get(roomId)).filter(
      (email) => email !== emailId
    );

    // Notify current user about existing users
    if (existingUsers.length > 0) {
      console.log(`Notifying ${emailId} about existing users:`, existingUsers);
      existingUsers.forEach((existingEmail) => {
        socket.emit("user-joined", { emailId: existingEmail });
      });
    }

    socket.emit("joined-room", { roomId });

    // Notify others about new user
    socket.broadcast.to(roomId).emit("user-joined", { emailId });
  });

  socket.on("ready-to-receive", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (!emailId) return;

    readyUsers.add(emailId);
    console.log(`${emailId} is ready to receive messages`);

    const queuedMessages = messageQueue.get(emailId) || [];
    if (queuedMessages.length > 0) {
      console.log(
        `Delivering ${queuedMessages.length} queued messages to ${emailId}`
      );
      queuedMessages.forEach((msg) => socket.emit(msg.event, msg.data));
      messageQueue.set(emailId, []);
    }
  });

  socket.on("call-user", (data) => {
    const { emailId, offer } = data;
    const fromEmail = socketToEmailMap.get(socket.id);
    const targetSocketId = emailToSocketMap.get(emailId);

    console.log("Call from:", fromEmail, "to:", emailId);

    if (!targetSocketId || !readyUsers.has(emailId)) {
      console.log("Queueing call for", emailId);
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

    console.log("Call accepted, sending answer to:", emailId);

    if (socketId) {
      io.to(socketId).emit("call-accepted", { ans });
    }
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    console.log("Relaying ICE candidate to:", to);
    const targetSocketId = emailToSocketMap.get(to);

    if (!targetSocketId || !readyUsers.has(to)) {
      console.log("Queueing ICE candidate for", to);
      const queue = messageQueue.get(to) || [];
      queue.push({ event: "ice-candidate", data: { candidate } });
      messageQueue.set(to, queue);
      return;
    }

    io.to(targetSocketId).emit("ice-candidate", { candidate });
  });

  socket.on("disconnect", () => {
    const emailId = socketToEmailMap.get(socket.id);
    console.log("Socket disconnected:", socket.id, emailId);

    if (emailId) {
      emailToSocketMap.delete(emailId);
      socketToEmailMap.delete(socket.id);
      readyUsers.delete(emailId);
      messageQueue.delete(emailId);

      // Remove from all rooms
      roomToUsers.forEach((users, roomId) => {
        if (users.has(emailId)) {
          users.delete(emailId);
          // Notify others in the room
          socket.broadcast.to(roomId).emit("user-left", { emailId });
        }
      });
    }
  });
});

server.listen(8000, () => {
  console.log("Signaling server running on 8000");
});
