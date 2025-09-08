# Chat App

A simple chat app with authentication, ready for deployment on Render.

## Deploy on Render

1. Push this repo to GitHub.
2. Create a new Web Service on [Render](https://render.com/).
3. Set the build and start command to `npm install && npm start`.
4. Add an environment variable: `JWT_SECRET`.
5. Done!

## Features

- Responsive design (works on Android and PC)
- JWT authentication
- In-memory user store (for demo; use DB for production)
- Ready for static hosting and API on Render

## To run locally

```sh
npm install
npm start
```
Visit [http://localhost:10000](http://localhost:10000)