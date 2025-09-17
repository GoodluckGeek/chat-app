const socket = io();
const chatBox = document.getElementById("chat-box");
const input = document.getElementById("messageInput");
const usernameInput = document.getElementById("username");

function sendMessage() {
    const text = input.value.trim();
    const username = usernameInput.value.trim() || "Anonymous";
    if (text === "") return;
    socket.emit("chatMessage", { user: username, text });
// send to server
    input.value = "";
}

// Listen for old messages
socket.on("loadMessages", (messages) => {
    messages.forEach((msg) => {
        const message = document.createElement("div");
        message.className = "message";
        message.textContent = `${msg.user}: ${msg.text}`;
        chatBox.appendChild(message);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
});

// Listen for new messages
socket.on("chatMessage", (msg) => {
    const message = document.createElement("div");
    message.className = "message";
    message.textContent = `${msg.user}: ${msg.text}`;
    chatBox.appendChild(message);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// Listen for "Enter" key press to send message
input.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
        sendMessage();
    }
});