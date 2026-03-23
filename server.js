const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const users = {};
const scheduledCalls = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (username) => {
    users[socket.id] = { id: socket.id, name: username, status: 'online', focusMode: 'online' };
    io.emit('userList', Object.values(users));
  });

  socket.on('sendMessage', (data) => {
    io.emit('receiveMessage', {
      from: socket.id,
      fromName: users[socket.id]?.name || 'Unknown',
      text: data.text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('callUser', ({ to, signal, isVideo }) => {
    io.to(to).emit('incomingCall', {
      from: socket.id,
      fromName: users[socket.id]?.name || 'Unknown',
      signal, isVideo
    });
  });

  socket.on('answerCall', ({ to, signal }) => { io.to(to).emit('callAccepted', signal); });
  socket.on('rejectCall', ({ to }) => { io.to(to).emit('callRejected'); });
  socket.on('endCall',    ({ to }) => { io.to(to).emit('callEnded'); });

  socket.on('screenShareStarted', ({ to }) => {
    io.to(to).emit('peerScreenSharing', { sharing: true, from: socket.id });
  });
  socket.on('screenShareStopped', ({ to }) => {
    io.to(to).emit('peerScreenSharing', { sharing: false, from: socket.id });
  });

  socket.on('caption', ({ to, text }) => {
    io.to(to).emit('receiveCaption', { from: users[socket.id]?.name || 'Unknown', text });
  });

  socket.on('whiteboardDraw',  ({ to, drawData }) => { io.to(to).emit('whiteboardReceive', drawData); });
  socket.on('whiteboardClear', ({ to }) => { io.to(to).emit('whiteboardCleared'); });

  socket.on('scheduleCall', ({ to, time, message }) => {
    const delay = new Date(time) - Date.now();
    if (delay > 0) {
      const timer = setTimeout(() => {
        io.to(socket.id).emit('scheduledCallAlert', { to, message });
        io.to(to).emit('scheduledCallAlert', { from: socket.id, fromName: users[socket.id]?.name, message });
      }, delay);
      scheduledCalls[`${socket.id}-${to}`] = timer;
    }
  });

  socket.on('setFocusStatus', (status) => {
    if (users[socket.id]) { users[socket.id].focusMode = status; io.emit('userList', Object.values(users)); }
  });

  socket.on('typing',     ({ to }) => { io.to(to).emit('userTyping',    { from: users[socket.id]?.name }); });
  socket.on('stopTyping', ({ to }) => { io.to(to).emit('userStopTyping'); });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete users[socket.id];
    io.emit('userList', Object.values(users));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('NexChat running on port ' + PORT);
});