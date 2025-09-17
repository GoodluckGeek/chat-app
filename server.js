// =============================
// server.js (Express 5.1.0 + Socket.IO + OpenAI v4)
// =============================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const OpenAI = require('openai');

// Create app & server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Config

const JWT_SECRET = jwt.sign({ userId: 123 },
   process.env.JWT_SECRET, { expiresIn: '7d' });

   jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('Invalid token');
    } else {
      console.log('Token valid:', decoded);
    }
  });

// ✅ Correct env var for OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Multer upload config
const upload = multer({ dest: path.join(__dirname, 'public', 'uploads') });

// In-memory storage
const users = [];
const privateMessages = {};

// Helpers
function generateChatAppNumber() {
  let num;
  do {
    num = '0' + Math.floor(1e9 + Math.random() * 9e9);
  } while (users.find(u => u.chatAppNumber === num));
  return num;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// JWT auth middleware
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  jwt.verify(auth.split(' ')[1], JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ========== AUTH & PROFILE ==========

// Signup
app.post('/signup', upload.single('avatar'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (users.find(u => u.username === username))
    return res.status(409).json({ error: 'Username taken' });

  const hash = await bcrypt.hash(password, 10);
  const avatar = req.file ? '/uploads/' + req.file.filename : '/default.png';
  const chatAppNumber = generateChatAppNumber();

  users.push({ username, password: hash, avatar, chatAppNumber, friends: [] });
  res.json({ success: true });
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber },
  });
});

// Update profile
app.put('/me', authenticate, upload.single('avatar'), (req, res) => {
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let token = null;
  if (req.body.username && req.body.username !== user.username) {
    if (users.find(u => u.username === req.body.username))
      return res.status(409).json({ error: 'Username taken' });
    user.username = req.body.username;
    token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  }
  if (req.file) user.avatar = '/uploads/' + req.file.filename;

  res.json({ username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber, token });
});

// Get current user
app.get('/me', authenticate, (req, res) => {
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber });
});

// Logout
app.post('/logout', (req, res) => res.json({ success: true }));

app.get('/', (req, res) => {
  res.send('ChatAp Server is running');
});

// ========== FRIENDS & CHAT ==========

// Friend list
app.get('/friends', authenticate, (req, res) => {
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const friends = user.friends
    .map(num => users.find(u => u.chatAppNumber === num))
    .filter(Boolean)
    .map(u => ({ username: u.username, avatar: u.avatar, chatAppNumber: u.chatAppNumber }));

  res.json(friends);
});

// Add friend
app.post('/add-friend', authenticate, (req, res) => {
  const { chatAppNumber } = req.body;
  const user = users.find(u => u.username === req.user.username);
  const friend = users.find(u => u.chatAppNumber === chatAppNumber);
  if (!user || !friend) return res.status(404).json({ error: 'User not found' });
  if (user.chatAppNumber === chatAppNumber) return res.status(400).json({ error: 'Cannot add yourself' });

  if (!user.friends.includes(chatAppNumber)) user.friends.push(chatAppNumber);
  if (!friend.friends.includes(user.chatAppNumber)) friend.friends.push(user.chatAppNumber);

  res.json({ success: true });
});

// Get user by number
app.get('/user/:number', authenticate, (req, res) => {
  const user = users.find(u => u.chatAppNumber === req.params.number);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber });
});

// Chat history
app.get('/chat/:number', authenticate, (req, res) => {
  const user = users.find(u => u.username === req.user.username);
  const friend = users.find(u => u.chatAppNumber === req.params.number);
  if (!user || !friend) return res.status(404).json({ error: 'User not found' });

  const key = [user.chatAppNumber, friend.chatAppNumber].sort().join('-');
  res.json(privateMessages[key] || []);
});

// ========== OPENAI DEMO ==========


// ========== ROUTES ==========

// Root
app.get('/', (req, res) => {
  res.send('✅ ChatApp Server is running');
});

// SPA fallback (Express 5 requires `app.use`)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== SOCKET.IO ==========
io.on('connection', socket => {
  let user = null;

  // When user joins, save their username
  socket.on('join', data => {
    user = data;
    if (user.chatAppNumber) {
      socket.join(user.chatAppNumber);
    }
  });

  // Private message handler
  socket.on('privateMessage', msg => {
    if (!user) return;
    const from = user.chatAppNumber;
    const to = msg.to;

    const key = [from, to].sort().join('-');
    const message = {
      from: from,
      to: to,
      text: msg.text || '',
      image: msg.image || null,
      timestamp: new Date().toISOString()
    };

    // Save message
    if (!privateMessages[key]) privateMessages[key] = [];
    privateMessages[key].push(message);

    // Emit to sender and receiver
    io.to(from).emit('privateMessage', msg);
    io.to(to).emit('privateMessage', msg);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUser.delete(socket.username);
      console.log('${socket.username} disconnected');
    }
  });
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log('🚀 Server running on http://localhost:${PORT}');
});