// =============================
// server.js (Express 5.1.0 + Socket.IO + MongoDB)
// =============================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// =============================
// Middleware
// =============================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
app.use(express.static(path.join(__dirname, "public"))); // serve frontend

// =============================
// MongoDB Connection
// =============================
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// =============================
// Schemas & Models
// =============================
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  avatar: { type: String, default: "/default.png" },
  chatAppNumber: { type: String, unique: true },
  friends: [String]
});

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true }, // chatAppNumber
  to: { type: String, required: true },   // chatAppNumber
  text: { type: String, default: "" },
  image: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);

// =============================
// JWT Middleware
// =============================
const JWT_SECRET = process.env.JWT_SECRET;

function verifyToken(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(403).json({ message: "No token provided" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid token" });
    req.user = decoded;
    next();
  });
}

// =============================
// File Uploads (Multer)
// =============================
const upload = multer({ dest: "public/uploads/" });

// =============================
// Helpers
// =============================
function generateChatAppNumber() {
  return "0" + Math.floor(1e9 + Math.random() * 9e9);
}

// =============================
// Auth Routes
// =============================

// Signup
app.post("/signup", upload.single("avatar"), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: "Username taken" });

    const hash = await bcrypt.hash(password, 10);
    const avatar = req.file ? "/uploads/" + req.file.filename : "/default.png";
    const chatAppNumber = generateChatAppNumber();

    const user = new User({ username, password: hash, avatar, chatAppNumber, friends: [] });
    await user.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Signup failed", details: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber } });
});

// Logout
app.post("/logout", (req, res) => res.json({ success: true }));

// =============================
// Profile Routes
// =============================

// Get current user
app.get("/me", verifyToken, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ username: user.username, avatar: user.avatar, chatAppNumber: user.chatAppNumber });
});

// Update profile
app.put("/me", verifyToken, upload.single("avatar"), async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).json({ error: "User not found" });

  if (req.file) user.avatar = "/uploads/" + req.file.filename;
  await user.save();

  res.json({ message: "Profile updated", user });
});

// =============================
// Friends Routes
// =============================

// Get friend list
app.get("/friends", verifyToken, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).json({ error: "User not found" });

  const friends = await User.find({ chatAppNumber: { $in: user.friends } }, "username avatar chatAppNumber");
  res.json(friends);
});

// Add friend
app.post("/add-friend", verifyToken, async (req, res) => {
  const { chatAppNumber } = req.body;
  const user = await User.findOne({ username: req.user.username });
  const friend = await User.findOne({ chatAppNumber });

  if (!user || !friend) return res.status(404).json({ error: "User not found" });
  if (user.chatAppNumber === chatAppNumber) return res.status(400).json({ error: "Cannot add yourself" });

  if (!user.friends.includes(chatAppNumber)) user.friends.push(chatAppNumber);
  if (!friend.friends.includes(user.chatAppNumber)) friend.friends.push(user.chatAppNumber);

  await user.save();
  await friend.save();

  res.json({ success: true });
});

// =============================
// Chat Routes
// =============================

// Get chat history with a friend
app.get("/chat/:number", verifyToken, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  const friend = await User.findOne({ chatAppNumber: req.params.number });
  if (!user || !friend) return res.status(404).json({ error: "User not found" });

  const messages = await Message.find({
    $or: [
      { from: user.chatAppNumber, to: friend.chatAppNumber },
      { from: friend.chatAppNumber, to: user.chatAppNumber }
    ]
  }).sort({ timestamp: 1 });

  res.json(messages);
});

// =============================
// Socket.IO Chat
// =============================
io.on("connection", (socket) => {
  let user = null;

  socket.on("join", (data) => {
    user = data;
    if (user.chatAppNumber) {
      socket.join(user.chatAppNumber);
    }
  });

  socket.on("privateMessage", async (msg) => {
    if (!user) return;
    const from = user.chatAppNumber;
    const to = msg.to;

    const message = new Message({
      from,
      to,
      text: msg.text || "",
      image: msg.image || null
    });

    await message.save();

    io.to(from).emit("privateMessage", message);
    io.to(to).emit("privateMessage", message);
  });

  socket.on("disconnect", () => {
    console.log(`${user?.username || "Unknown"} disconnected`);
  });
});

// =============================
// Frontend Fallback
// =============================
app.get('*', (req, res) => {
  const indexPath = path.jion(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("index.html not found");
  }
});

// =============================
// Start Server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});