require('dotenv').config();           // load .env in Windows or any OS

const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const multer = require('multer');
const fs = require('fs');
const { Configuration, OpenAIApi } = require('openai');  // new OpenAI import

// configure multer for file uploads
const upload = multer({ dest: path.join(__dirname, 'public', 'uploads') });

const PORT        = process.env.PORT        || 10000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'supersecretkey';
const OPENAI_KEY  = process.env.OPENAI_KEY;  

if (!OPENAI_KEY) {
  console.warn('Warning: OPENAI_KEY not set in your environment');
}

// initialize OpenAI client
const openai = new OpenAIApi(new Configuration({
  apiKey: OPENAI_KEY
}));

// in-memory storage (for demo purposes)
const users = [];
const privateMessages = {}; 
// helper to generate unique 10-digit chat numbers
function generateChatAppNumber() {
  let num;
  do {
    num = '0' + Math.floor(1e9 + Math.random() * 9e9);
  } while (users.find(u => u.chatAppNumber === num));
  return num;
}

// serve static assets and uploads
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(cors());
app.use(express.json());
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

// SIGNUP
app.post('/signup', upload.single('avatar'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (users.find(u => u.username === username))
    return res.status(409).json({ error: 'Username taken' });
  const hash = await bcrypt.hash(password, 10);
  let avatar = '/default.png';
  if (req.file) avatar = '/uploads/' + req.file.filename;
  const chatAppNumber = generateChatAppNumber();
  users.push({ username, password: hash, avatar, chatAppNumber, friends: [] });
  res.json({ success: true });
});

// UPDATE PROFILE
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

  res.json({
    username: user.username,
    avatar:   user.avatar,
    chatAppNumber: user.chatAppNumber,
    token
  });
});

// LOGIN
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      username: user.username,
      avatar:   user.avatar,
      chatAppNumber: user.chatAppNumber
    }
  });
});

// GET CURRENT USER
app.get('/me', authenticate, (req, res) => {
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber });
});

// FRIEND LIST
app.get('/friends', authenticate, (req, res) => {
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const friends = user.friends
    .map(num => users.find(u => u.chatAppNumber === num))
    .filter(Boolean)
    .map(u => ({ username: u.username, avatar: u.avatar, chatAppNumber: u.chatAppNumber }));
  res.json(friends);
});

// ADD FRIEND
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

// GET USER BY NUMBER
app.get('/user/:number', authenticate, (req, res) => {
  const user = users.find(u => u.chatAppNumber === req.params.number);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber });
});

// CHAT HISTORY
app.get('/chat/:number', authenticate, (req, res) => {
  const user   = users.find(u => u.username === req.user.username);
  const friend = users.find(u => u.chatAppNumber === req.params.number);
  if (!user || !friend) return res.status(404).json({ error: 'User not found' });
  const key = [user.chatAppNumber, friend.chatAppNumber].sort().join('-');
  res.json(privateMessages[key] || []);
});

// LOGOUT
app.post('/logout', (req, res) => {
  res.json({ success: true });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SOCKET.IO PRIVATE CHAT
io.on('connection', socket => {
  let user = null;

  socket.on('join', data => {
    user = data;
    socket.join(user.chatAppNumber);
  });

  socket.on('privateMessage', msg => {
    if (!user) return;
    const from = user.chatAppNumber;
    const to   = msg.to;
    const key  = [from, to].sort().join('-');
    const message = {
      from,
      to,
      text:      msg.text || '',
      image:     msg.image || null,
      timestamp: Date.now()
    };
    privateMessages[key] = privateMessages[key] || [];
    privateMessages[key].push(message);

    io.to(from).emit('privateMessage', message);
    io.to(to).emit('privateMessage', message);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});