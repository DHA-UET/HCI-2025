import {
  GestureRecognizer,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const seed = Math.round(Math.random() * 775_775_775)
console.log(seed)

// let messages = []
let messages = [
    { from: "bot", message: "Xin chào! Tôi là trợ lý ảo của bạn. Tôi có thể giúp gì cho bạn hôm nay?" },
    { from: "user", message: "Chào bạn, hôm nay trời thế nào nhỉ?" }
  ];
let sessions = []

function toggleVoiceOverlay(show) {
  const overlay = document.getElementById("voice-overlay");
  if (show) {
    overlay.classList.add("active");
  } else {
    overlay.classList.remove("active");
  }
}

// function renderMessages() {
//   const list = document.getElementById("message-list");

//   list.innerHTML = messages.map(message => {
//     return `<div class="message ${message.from === "user" ? "me" : ""}">
//       ${message.message}
//     </div>`;
//   }).join("");

//   list.scrollTo({
//     top: list.scrollHeight,
//     behavior: "smooth"
//   });
// }

// renderMessages()

function renderMessages() {
  const list = document.getElementById("message-list");

  const botAvatar = "./public/voicon.jpg";

  const userAvatar = "./public/avatar_user.jpg"

  list.innerHTML = messages.map(message => {
      const isUser = message.from === "user";
      
      const currentAvatar = isUser ? userAvatar : botAvatar;
      const rowClass = isUser ? "message-row me" : "message-row";
      const bubbleClass = isUser ? "message-bubble me" : "message-bubble";

      return `
          <div class="${rowClass}">
              <div class="avatar">
                  <img src="${currentAvatar}" alt="${message.from} avatar" onerror="this.src='${userAvatar}'">
              </div>
              <div class="${bubbleClass}">
                  ${message.message}
              </div>
          </div>
      `;
  }).join("");

  list.scrollTo({
      top: list.scrollHeight,
      behavior: "smooth"
  });
}

renderMessages()

async function uploadAudioToServer(blob) {
  const formData = new FormData();
  formData.append("file", blob, "recording.webm");
  formData.append("session_id", seed)

  try {
    const res = await fetch("http://127.0.0.1:8000/api/voice-chat", {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    console.log("Server response:", data);
    return data
  } catch (err) {
    console.error("Upload failed:", err);
  }
}

async function getAllSessions() {
  try {
    const res = await fetch("http://127.0.0.1:8000/api/sessions", {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      console.error("Failed to fetch sessions:", res.status, res.statusText);
      return null;
    }

    const data = await res.json();
    console.log("Sessions:", data);
    return data;
  } catch (err) {
    console.error("getAllSessions error:", err);
    return null;
  }
}

;(async () => {
  sessions = await getAllSessions()
  console.log(sessions)
  renderSessions()
})()

function renderSessions() {
  document.getElementById("histories").innerHTML = sessions.map(session => {
    return `<a href="#${session}">Session ${session}</a>`
  }).join("")
}

function tts(text, {
  lang = "vi-VN",
  rate = 1.2,
  pitch = 0.9,
  volume = 2
} = {}) {
  if (!("speechSynthesis" in window)) {
    console.error("Trình duyệt không hỗ trợ TTS");
    return;
  }

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = rate;
  utter.pitch = pitch;
  utter.volume = volume;

  const voices = window.speechSynthesis.getVoices();
  const viVoice = voices.find(v => v.lang.startsWith("vi"));
  if (viVoice) utter.voice = viVoice;

  window.speechSynthesis.speak(utter);
}

/* ================== DOM ================== */
const video = document.getElementById("webcam");
const canvas = document.getElementById("output_canvas");
const ctx = canvas.getContext("2d");

/* ================== BEEP AUDIO ================== */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playBeep({
  frequency = 800,
  duration = 150,
  type = "sine",
  volume = 0.2
}) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration / 1000);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration / 1000);
}

function beepStartRecording() {
  playBeep({
    frequency: 1000, // cao
    duration: 120
  });
}

function beepStopRecording() {
  playBeep({
    frequency: 400, // thấp
    duration: 250
  });
}


/* ================== STATE ================== */
let recognizer = null;
let lastVideoTime = -1;

let currentGesture = "";
let gestureStartTime = 0;
let gestureTriggered = false;

const HOLD_TIME = 1000; // ms

/* ================== AUDIO ================== */
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

/* ================== INIT ================== */
async function init() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );

  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });

  console.log("GestureRecognizer ready");
  startCamera();
}

/* ================== CAMERA ================== */
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 640, height: 480 }
  });

  video.srcObject = stream;
  await video.play();
  requestAnimationFrame(loop);
}

/* ================== AUDIO CONTROL ================== */
async function startRecording() {
  if (isRecording) return;

  beepStartRecording()
  toggleVoiceOverlay(true); 

  messages.push({message: "...", from: "user"})
  renderMessages()

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    console.log("Audio ready:", blob);
  };

  mediaRecorder.start();
  isRecording = true;
  console.log("START RECORDING");
}

function stopRecording() {
  if (!isRecording) return;

  beepStopRecording()
  toggleVoiceOverlay(false);

  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    console.log("Audio ready:", blob);

    const res = await uploadAudioToServer(blob);
    console.log(res)


    messages = [...messages.slice(0, -1)]
    messages.push(res.user)
    messages.push(res.bot)
    renderMessages()

    tts(res.bot.message)

    // Play the audio
    // const audioUrl = URL.createObjectURL(blob);
    // const audio = new Audio(audioUrl);
    // audio.play().catch(err => console.error("Playback failed:", err));
    // console.log("Playing recorded audio");
  };

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  isRecording = false;
  console.log("STOP RECORDING");
}

function cancelRecording() {
  if (!isRecording) return;

  beepStopRecording();
  toggleVoiceOverlay(false);

  mediaRecorder.onstop = null;

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());

  audioChunks = [];
  isRecording = false;

  console.log("RECORDING CANCELED");
}


/* ================== ACTION ================== */
function triggerAction(gesture) {
  switch (gesture) {
    case "Open_Palm":
      startRecording();
      break;

    case "Closed_Fist":
      stopRecording();
      break;

    case "Thumb_Up":
      console.log("CONFIRM YES");
      break;

    case "Thumb_Down":
      if (isRecording) {
        cancelRecording();
      }
      console.log("CONFIRM NO");
      break;

    case "Victory":
      break;

    case "Pointing_Up":
      break;
  }
}

/* ================== MAIN LOOP ================== */
function loop() {
  if (!recognizer || video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }

  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const now = performance.now();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const results = recognizer.recognizeForVideo(video, now);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const draw = new DrawingUtils(ctx);

    /* ===== DRAW HAND ===== */
    if (results.landmarks?.length) {
      for (const lm of results.landmarks) {
        draw.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS);
        draw.drawLandmarks(lm);
      }
    }

    /* ===== HOLD GESTURE LOGIC ===== */
    if (results.gestures?.length) {
      const g = results.gestures[0][0];

      if (g.score > 0.6) {
        if (g.categoryName !== currentGesture) {
          currentGesture = g.categoryName;
          gestureStartTime = performance.now();
          gestureTriggered = false;
        } else if (
          !gestureTriggered &&
          performance.now() - gestureStartTime >= HOLD_TIME
        ) {
          console.log("TRIGGER:", currentGesture);
          triggerAction(currentGesture);
          gestureTriggered = true;
        }
      }
    } else {
      currentGesture = "";
      gestureTriggered = false;
    }
  }

  requestAnimationFrame(loop);
}

/* ================== START ================== */
init();
