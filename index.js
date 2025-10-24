const express = require("express");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");

const io = new Server({
  cors: true,
});
const app = new express();

app.use(bodyParser.json());

const emailToSocketMap = new Map();

io.on("connection", (socket) => {
  console.log("New Connection");
  socket.on("join-room", (data) => {
    const { roomId, emailId } = data;
    console.log("User", emailId, "Joined room", roomId);
    emailToSocketMap.set(emailId, socket.id);
    socket.join(roomId);
    socket.emit("joined-room", { roomId });
    socket.broadcast.to(roomId).emit("user-joined", { emailId });
  });
});

app.listen(8000, () => {
  console.log("App server running at 8000");
});
io.listen(8001, () => {
  console.log("socket server running at 80001");
});
