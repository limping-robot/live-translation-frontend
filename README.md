# Realtime English to Tagalog Translation

Real-time speech-to-speech translation from English to Tagalog using push-to-talk.

## Overview

A web application that transcribes English speech and translates it to Tagalog. Uses a push-to-talk button to control recording, with automatic voice activity detection (VAD) and real-time WebSocket communication.

## Features

- **Push-to-Talk Interface**: Hold the button to record; release to send
- **Real-time Translation**: WebSocket-based streaming for low-latency results
- **Voice Activity Detection**: Custom VAD processor detects speech start/end
- **JWT Authentication**: Secure login with token-based auth
- **Mobile Optimized**: Touch-friendly controls and responsive design
- **Automatic Connection Management**: WebSocket and microphone initialized after login

## Tech Stack

- **React 18.3.1** - UI framework
- **Vite** - Build tool and dev server
- **Web Audio API** - Audio processing and VAD
- **AudioWorklet** - Custom VAD processor for real-time speech detection
- **WebSocket** - Real-time bidirectional communication

## Architecture

### Frontend Components

- **Main App Component**: Single-page React application with authentication and translation UI
- **VAD Processor**: Custom AudioWorklet processor that:
  - Detects speech using adaptive noise floor
  - Processes audio in 30ms frames
  - Emits utterances when speech ends or is force-ended
  - Converts audio to PCM16 format for transmission

### Data Flow

1. User logs in → JWT token stored → WebSocket connection established
2. Microphone access requested automatically
3. User presses button → Audio captured and processed by VAD
4. Speech detected → Utterance sent to server (JSON + binary PCM)
5. Server responds → Translation displayed in real-time
6. User releases button → Current utterance force-ended and sent

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- Modern browser with Web Audio API and WebSocket support

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Configuration

The frontend proxies API requests to the backend. Update `vite.config.js` if your backend runs on a different port:

```javascript
server: {
  proxy: {
    "/login": { target: "http://localhost:5000" },
    "/ws": { target: "ws://localhost:5000", ws: true }
  }
}
```

## Usage

1. Enter username and password to log in
2. Grant microphone permissions when prompted
3. Hold the circular button to start recording
4. Speak in English
5. Release the button to send the utterance
6. View translations in the results list below

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx          # Main application component
│   └── main.jsx         # React entry point
├── public/
│   └── vad-processor.js # Custom VAD AudioWorklet processor
├── package.json
└── vite.config.js       # Vite configuration with proxy settings
```

## Key Features Explained

### Push-to-Talk

The button controls when audio is sent:
- Press and hold: Audio captured and processed
- Release: Current utterance force-ended and sent immediately
- Only audio recorded while pressed is transmitted

### Voice Activity Detection

The custom VAD processor:
- Uses adaptive noise floor detection
- Requires 5 consecutive speech frames to start
- Waits for 500ms silence to end (or force-end on button release)
- Filters out utterances shorter than 200ms
- Supports utterances up to 20 seconds

### Connection Management

- WebSocket opens automatically after login
- Stays connected to receive delayed translation results
- Microphone initialized early for smoother UX
- Automatic cleanup on logout

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari (with fallback UUID generation)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Development

The app uses Vite for fast development with HMR. The VAD processor is loaded as an AudioWorklet module from the public directory.
