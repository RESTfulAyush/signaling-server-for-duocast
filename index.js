const express = require("express");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const http = require("http");

// Create Express app
const app = express();
app.use(bodyParser.json());

// Create HTTP server from Express
const server = http.createServer(app);

// Attach Socket.IO to the same server
const io = new Server(server, {
  cors: { origin: "*" },
});

// Maps to track users
const emailToSocketMap = new Map();
const socketToEmailMap = new Map();

// Socket.IO connection
io.on("connection", (socket) => {
  console.log("New Connection");

  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;
    console.log("User", emailId, "Joined room", roomId);
    emailToSocketMap.set(emailId, socket.id);
    socketToEmailMap.set(socket.id, emailId);
    socket.join(roomId);
    socket.emit("joined-room", { roomId });
    socket.broadcast.to(roomId).emit("user-joined", { emailId });
  });

  socket.on("call-user", (data) => {
    const { emailId, offer } = data;
    const fromEmail = socketToEmailMap.get(socket.id);
    const socketId = emailToSocketMap.get(emailId);
    console.log("fromEmail", fromEmail);
    console.log("Calling:", emailId, "socketId:", socketId);
    socket.to(socketId).emit("incoming-call", { from: fromEmail, offer });
  });
});

// Start the HTTP server (both Express + Socket.IO)
server.listen(8000, () => {
  console.log("App + Socket server running on 8000");
});
