const express = require("express");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const http = require("http");

const app = express();
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// State Management
const emailToSocketMap = new Map();
const socketToEmailMap = new Map();
const messageQueue = new Map(); // Stores signals (offers/ice) if target isn't ready
const readyUsers = new Set(); // Users who have finished setting up their local media
const roomToUsers = new Map(); // Tracks emails present in each roomId

io.on("connection", (socket) => {
  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;

    // 1. Room Capacity Check (Max 2)
    const existingUsers = roomToUsers.get(roomId);
    if (
      existingUsers &&
      existingUsers.size >= 2 &&
      !existingUsers.has(emailId)
    ) {
      console.log(`Join rejected: Room ${roomId} is full`);
      return socket.emit("room-full", { roomId });
    }

    // 2. Map Identity
    emailToSocketMap.set(emailId, socket.id);
    socketToEmailMap.set(socket.id, emailId);

    // 3. Initialize Signaling Queue
    if (!messageQueue.has(emailId)) {
      messageQueue.set(emailId, []);
    }

    // 4. Handle Room Entry
    socket.join(roomId);
    if (!roomToUsers.has(roomId)) {
      roomToUsers.set(roomId, new Set());
    }
    roomToUsers.get(roomId).add(emailId);

    // 5. Sync Participants
    // Tell the new user who is already there
    const others = Array.from(roomToUsers.get(roomId)).filter(
      (email) => email !== emailId,
    );
    others.forEach((existingEmail) => {
      socket.emit("user-joined", { emailId: existingEmail });
    });

    // Notify room and confirm join
    socket.emit("joined-room", { roomId });
    socket.broadcast.to(roomId).emit("user-joined", { emailId });

    console.log(
      `${emailId} joined ${roomId} (${roomToUsers.get(roomId).size}/2)`,
    );
  });

  // --- RECORDING CONTROLS ---

  socket.on("start-recording-trigger", ({ roomId }) => {
    const serverTimestamp = Date.now(); // Central authority for video synchronization
    const fromEmail = socketToEmailMap.get(socket.id);

    // Broadcast to EVERYONE (including sender) so all start at the same ms
    io.to(roomId).emit("start-recording-trigger", {
      startTime: serverTimestamp,
      triggeredBy: fromEmail,
    });
  });

  socket.on("stop-recording-trigger", ({ roomId }) => {
    io.to(roomId).emit("stop-recording-trigger");
  });

  // --- WEBRTC SIGNALING ---

  socket.on("ready-to-receive", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (!emailId) return;

    readyUsers.add(emailId);

    // Flush any signals (offers/ICE) that arrived while user was still initializing
    const queuedMessages = messageQueue.get(emailId) || [];
    queuedMessages.forEach((msg) => socket.emit(msg.event, msg.data));
    messageQueue.set(emailId, []);
  });

  socket.on("call-user", ({ emailId, offer }) => {
    const fromEmail = socketToEmailMap.get(socket.id);
    const targetSocketId = emailToSocketMap.get(emailId);

    // If peer isn't ready, queue the offer to prevent WebRTC "race conditions"
    if (!targetSocketId || !readyUsers.has(emailId)) {
      const queue = messageQueue.get(emailId) || [];
      queue.push({ event: "incoming-call", data: { from: fromEmail, offer } });
      messageQueue.set(emailId, queue);
      return;
    }
    io.to(targetSocketId).emit("incoming-call", { from: fromEmail, offer });
  });

  socket.on("call-accepted", ({ emailId, ans }) => {
    const socketId = emailToSocketMap.get(emailId);
    if (socketId) io.to(socketId).emit("call-accepted", { ans });
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

  // --- CLEANUP ---

  socket.on("disconnect", () => {
    const emailId = socketToEmailMap.get(socket.id);
    if (!emailId) return;

    emailToSocketMap.delete(emailId);
    socketToEmailMap.delete(socket.id);
    readyUsers.delete(emailId);
    messageQueue.delete(emailId);

    roomToUsers.forEach((users, roomId) => {
      if (users.has(emailId)) {
        users.delete(emailId);
        // Force stop recording if one participant leaves
        io.to(roomId).emit("stop-recording-trigger");
        socket.broadcast.to(roomId).emit("user-left", { emailId });
      }
    });
  });
});

server.listen(8000, () => console.log("Signaling server running on 8000"));
