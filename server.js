const express = require("express");
const http = require("http");
const { Server } =
require("socket.io");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files (html, css, js)
app.use(express.static(path.join(__dirname)));

// ---- DATABASE SETUP ----
const db = new sqlite3.Database("./chat.db", (err) => {
    if (err) console.error(err.message);
    else console.log("Connected to the SQLite database.");
});

// Create messages table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ---- SOCKET.IO SETUP ----
io.on("connection", (socket) => {
    console.log("A user connected");
    // Load last 20 messages from DB
    db.all("SELECT * FROM messages ORDER BY id DESC LIMIT 20", (err, rows) => {
        if (!err) {
            socket.emit("loadMessages", rows.reverse()); // Send to new client
        }
    });
    // When a message is sent
    socket.on("chatMessage", (msg) => {
        // Save message to DB
        db.run("INSERT INTO messages (user, text) VALUES (?, ?)", [msg.user, msg.text], (err) => {
            if (err) return console.error(err.message);

            // Broadcast message to all clients
            io.emit("chatMessage", msg); 
        });
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected");
    });
});

// ---- START SERVER ----
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

