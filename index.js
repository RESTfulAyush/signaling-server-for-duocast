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
const roomToUsers = new Map();

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // --- EXISTING JOIN LOGIC ---
  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;
    emailToSocketMap.set(emailId, socket.id);
    socketToEmailMap.set(socket.id, emailId);

    if (!messageQueue.has(emailId)) {
      messageQueue.set(emailId, []);
    }

    socket.join(roomId);

    if (!roomToUsers.has(roomId)) {
      roomToUsers.set(roomId, new Set());
    }
    roomToUsers.get(roomId).add(emailId);

    console.log(`${emailId} joined room ${roomId}`);

    const existingUsers = Array.from(roomToUsers.get(roomId)).filter(
      (email) => email !== emailId
    );

    if (existingUsers.length > 0) {
      existingUsers.forEach((existingEmail) => {
        socket.emit("user-joined", { emailId: existingEmail });
      });
    }

    socket.emit("joined-room", { roomId });
    socket.broadcast.to(roomId).emit("user-joined", { emailId });
  });

  // --- RECORDING SYNCHRONIZATION (NEW) ---

  /**
   * When any user triggers the recording, the server generates a
   * master timestamp and broadcasts it to everyone in the room.
   */
  socket.on("start-recording-trigger", ({ roomId }) => {
    const serverTimestamp = Date.now();
    const fromEmail = socketToEmailMap.get(socket.id);

    console.log(
      `[REC] Start signal from ${fromEmail} in room ${roomId}. Timestamp: ${serverTimestamp}`
    );

    // Use io.to(roomId) to send to EVERYONE in the room including the sender.
    // This ensures both clients start at the EXACT same server-side millisecond.
    io.to(roomId).emit("start-recording-trigger", {
      startTime: serverTimestamp,
      triggeredBy: fromEmail,
    });
  });

  socket.on("stop-recording-trigger", ({ roomId }) => {
    const fromEmail = socketToEmailMap.get(socket.id);
    console.log(`[REC] Stop signal from ${fromEmail} in room ${roomId}`);

    // Notify everyone to stop and finalize chunks
    io.to(roomId).emit("stop-recording-trigger");
  });

  // --- EXISTING CALL LOGIC ---
  socket.on("ready-to-receive", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (!emailId) return;
    readyUsers.add(emailId);
    const queuedMessages = messageQueue.get(emailId) || [];
    if (queuedMessages.length > 0) {
      queuedMessages.forEach((msg) => socket.emit(msg.event, msg.data));
      messageQueue.set(emailId, []);
    }
  });

  socket.on("call-user", (data) => {
    const { emailId, offer } = data;
    const fromEmail = socketToEmailMap.get(socket.id);
    const targetSocketId = emailToSocketMap.get(emailId);
    if (!targetSocketId || !readyUsers.has(emailId)) {
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
    if (socketId) {
      io.to(socketId).emit("call-accepted", { ans });
    }
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    const targetSocketId = emailToSocketMap.get(to);
    if (!targetSocketId || !readyUsers.has(to)) {
      const queue = messageQueue.get(to) || [];
      queue.push({ event: "ice-candidate", data: { candidate } });
      messageQueue.set(to, queue);
      return;
    }
    io.to(targetSocketId).emit("ice-candidate", { candidate });
  });

  socket.on("disconnect", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (emailId) {
      emailToSocketMap.delete(emailId);
      socketToEmailMap.delete(socket.id);
      readyUsers.delete(emailId);
      messageQueue.delete(emailId);
      roomToUsers.forEach((users, roomId) => {
        if (users.has(emailId)) {
          users.delete(emailId);
          socket.broadcast.to(roomId).emit("user-left", { emailId });
        }
      });
    }
  });
});

server.listen(8000, () => {
  console.log("Signaling server running on 8000");
});
