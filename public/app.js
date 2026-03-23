/* ═══════════════════════════════════════════════════
   NEXCHAT — Complete Client Logic (app.js)
   ═══════════════════════════════════════════════════ */

const socket = io();

// ─── STATE ────────────────────────────────────────
let myName       = '';
let mySocketId   = '';
let activeUser   = null;   // { id, name, color }
let localStream  = null;
let currentPeer  = null;
let isScreenSharing = false;
let isRecording  = false;
let isMuted      = false;
let isCameraOff  = false;
let isCaptionsOn = false;
let mediaRecorder = null;
let recordedChunks = [];
let callTimerInterval = null;
let callSeconds = 0;
let speechRecognition = null;
let incomingCallData = null;
let allUsers = [];

// Avatar colors pool
const COLORS = ['#1D9E75','#534AB7','#D85A30','#D4537E','#185FA5','#854F0B','#639922','#993C1D'];
function colorFor(name) {
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[Math.abs(h)];
}
function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── JOIN APP ─────────────────────────────────────
function joinApp() {
  const input = document.getElementById('usernameInput');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  myName = name;

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');

  const selfAvatar = document.getElementById('selfAvatarIcon');
  selfAvatar.textContent = initials(name);
  selfAvatar.style.background = colorFor(name);

  socket.emit('register', name);

  // Init whiteboard
  initWhiteboard();
}

// Allow Enter key on login
document.getElementById('usernameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinApp();
});

// ─── SOCKET: MY ID ────────────────────────────────
socket.on('connect', () => { mySocketId = socket.id; });

// ─── USER LIST ────────────────────────────────────
socket.on('userList', (users) => {
  allUsers = users.filter(u => u.id !== mySocketId);
  renderUserList(allUsers);
});

function renderUserList(users) {
  const list = document.getElementById('userList');
  if (users.length === 0) {
    list.innerHTML = '<div class="no-users">No other users online yet</div>';
    return;
  }
  list.innerHTML = '';
  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item' + (activeUser?.id === u.id ? ' active' : '');
    div.onclick = () => selectUser(u);

    const focusMap = {
      online:  { dot: 'dot-online',  label: 'Online' },
      coding:  { dot: 'dot-coding',  label: '💻 Coding' },
      meeting: { dot: 'dot-meeting', label: '📅 In meeting' },
      dnd:     { dot: 'dot-dnd',     label: '🔴 Do not disturb' },
      away:    { dot: 'dot-away',    label: '🌙 Away' },
    };
    const fm = focusMap[u.focusMode] || focusMap.online;

    div.innerHTML = `
      <div class="u-avatar" style="background:${colorFor(u.name)};color:#fff;">
        ${initials(u.name)}
        <div class="u-online-dot ${fm.dot}"></div>
      </div>
      <div class="u-info">
        <div class="u-name">${u.name}</div>
        <div class="u-status">${fm.label}</div>
      </div>
      <div class="u-actions">
        <button class="ua-btn" onclick="event.stopPropagation();startVoiceCall('${u.id}','${u.name}')" title="Voice call">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 2h2.5l1 3L5 6.5c.8 1.6 2 2.8 3.5 3.5L10 8.5l3 1V12c0 .8-.7 1-1.5.8C5.5 11.2 2 7 2 3.5 1.8 2.7 2.2 2 3 2z" fill="currentColor"/></svg>
        </button>
        <button class="ua-btn" onclick="event.stopPropagation();startVideoCall('${u.id}','${u.name}')" title="Video call">
          <svg viewBox="0 0 16 16" fill="none"><rect x="1" y="4" width="9" height="8" rx="1.5" fill="currentColor"/><path d="M10 7l4-2v6l-4-2V7z" fill="currentColor"/></svg>
        </button>
      </div>
    `;
    list.appendChild(div);
  });
}

function filterUsers() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  renderUserList(allUsers.filter(u => u.name.toLowerCase().includes(q)));
}

function selectUser(u) {
  activeUser = { id: u.id, name: u.name, color: colorFor(u.name) };
  renderUserList(allUsers);

  // Update chat top bar
  document.getElementById('chatTop').innerHTML = `
    <div class="chat-top-bar">
      <div class="ct-av" style="background:${activeUser.color};color:#fff;">${initials(u.name)}</div>
      <div>
        <div class="ct-name">${u.name}</div>
        <div class="ct-status-text">● Online</div>
      </div>
      <div class="ct-action-group">
        <button class="ct-act" onclick="startVoiceCall('${u.id}','${u.name}')" title="Voice call">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 2h2.5l1 3L5 6.5c.8 1.6 2 2.8 3.5 3.5L10 8.5l3 1V12c0 .8-.7 1-1.5.8C5.5 11.2 2 7 2 3.5 1.8 2.7 2.2 2 3 2z" fill="currentColor"/></svg>
        </button>
        <button class="ct-act" onclick="startVideoCall('${u.id}','${u.name}')" title="Video call">
          <svg viewBox="0 0 16 16" fill="none"><rect x="1" y="4" width="9" height="8" rx="1.5" fill="currentColor"/><path d="M10 7l4-2v6l-4-2V7z" fill="currentColor"/></svg>
        </button>
        <button class="ct-act" onclick="openScheduleModal()" title="Schedule call">
          <svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
  `;

  document.getElementById('chatBottom').style.display = 'block';
  document.getElementById('chatArea').innerHTML = '';
  appendSystemMsg(`Start of your conversation with ${u.name}`);
}

// ─── MESSAGING ────────────────────────────────────
function sendMessage() {
  if (!activeUser) return;
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text) return;

  socket.emit('sendMessage', { text, to: activeUser.id });
  appendMessage({ fromName: myName, text, sent: true });
  input.value = '';
  socket.emit('stopTyping', { to: activeUser.id });
}

function handleKey(e) {
  if (e.key === 'Enter') sendMessage();
}

let typingTimeout;
function handleTyping() {
  if (!activeUser) return;
  socket.emit('typing', { to: activeUser.id });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stopTyping', { to: activeUser.id });
  }, 1500);
}

socket.on('receiveMessage', (data) => {
  if (!activeUser || data.from !== activeUser.id) return;
  appendMessage({ fromName: data.fromName, text: data.text, sent: false });
});

socket.on('userTyping', ({ from }) => {
  const ind = document.getElementById('typingIndicator');
  ind.textContent = `${from} is typing...`;
  ind.classList.remove('hidden');
});

socket.on('userStopTyping', () => {
  document.getElementById('typingIndicator').classList.add('hidden');
});

function appendMessage({ fromName, text, sent }) {
  const area = document.getElementById('chatArea');
  const color = colorFor(fromName);
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const wrap = document.createElement('div');
  wrap.className = 'msg-wrapper';
  wrap.innerHTML = `
    <div class="msg-row ${sent ? 'sent' : ''}">
      ${!sent ? `<div class="msg-av" style="background:${color};color:#fff;">${initials(fromName)}</div>` : ''}
      <div class="bubble ${sent ? 'b-sent' : 'b-recv'}">
        ${text}
        <div class="b-time">${now}${sent ? ' <span class="b-tick">✓✓</span>' : ''}</div>
      </div>
    </div>
  `;
  area.appendChild(wrap);
  area.scrollTop = area.scrollHeight;
}

function appendSystemMsg(text) {
  const area = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'call-log-msg';
  div.textContent = text;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

// ─── TAB SWITCHING ────────────────────────────────
function switchTab(tab) {
  var panels = { chat: 'panelChat', calls: 'panelCalls', whiteboard: 'panelWhiteboard' };
  Object.entries(panels).forEach(function([key, id]) {
    var panel = document.getElementById(id);
    var tabEl = document.getElementById('tab-' + key);
    if (key === tab) {
      panel.style.display = 'flex';
      panel.classList.add('active');
      if (tabEl) tabEl.classList.add('active');
    } else {
      panel.style.display = 'none';
      panel.classList.remove('active');
      if (tabEl) tabEl.classList.remove('active');
    }
  });
  if (tab === 'whiteboard') setTimeout(function() { resizeWhiteboard(); }, 50);
}

// ─── FOCUS STATUS ─────────────────────────────────
function setFocus(val) {
  socket.emit('setFocusStatus', val);
}

// ─── VOICE CALL ───────────────────────────────────
async function startVoiceCall(toId, toName) {
  activeUser = { id: toId, name: toName, color: colorFor(toName) };
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  showCallUI(false, toName, 'Calling...');
  initPeer(true, toId, false);
}

// ─── VIDEO CALL ───────────────────────────────────
async function startVideoCall(toId, toName) {
  activeUser = { id: toId, name: toName, color: colorFor(toName) };
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  showCallUI(true, toName, 'Calling...');
  initPeer(true, toId, true);
}

// ─── WEBRTC PEER (SimplePeer via CDN) ─────────────
function loadSimplePeer(cb) {
  if (window.SimplePeer) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/simple-peer@9.11.1/simplepeer.min.js';
  s.onload = cb;
  document.head.appendChild(s);
}

function initPeer(initiator, toId, isVideo) {
  loadSimplePeer(() => {
    currentPeer = new SimplePeer({ initiator, trickle: false, stream: localStream });

    currentPeer.on('signal', (signal) => {
      socket.emit('callUser', { to: toId, signal, isVideo });
    });

    currentPeer.on('stream', (remoteStream) => {
      const remoteVideo = document.getElementById('remoteVideo');
      remoteVideo.srcObject = remoteStream;
      startCallTimer();
      document.getElementById('callStatusText').textContent = isVideo ? 'Video call' : 'Voice call';
      if (!isVideo) {
        document.getElementById('voiceStatus').textContent = 'Connected';
      }
      addCallHistory(activeUser.name, isVideo ? 'Video call' : 'Voice call');
    });

    currentPeer.on('error', (err) => console.error('Peer error:', err));
    currentPeer.on('close', () => cleanupCall());

    if (!initiator) {
      currentPeer.signal(incomingCallData.signal);
    }

    if (isVideo) {
      document.getElementById('localVideo').srcObject = localStream;
    }
  });
}

// ─── INCOMING CALL ────────────────────────────────
socket.on('incomingCall', (data) => {
  incomingCallData = data;
  document.getElementById('icAvatar').textContent = initials(data.fromName);
  document.getElementById('icAvatar').style.background = colorFor(data.fromName);
  document.getElementById('icName').textContent = data.fromName;
  document.getElementById('icType').textContent = data.isVideo ? '📹 Video call' : '📞 Voice call';
  document.getElementById('incomingCallModal').classList.remove('hidden');
});

async function acceptCall() {
  document.getElementById('incomingCallModal').classList.add('hidden');
  const isVideo = incomingCallData.isVideo;
  activeUser = { id: incomingCallData.from, name: incomingCallData.fromName, color: colorFor(incomingCallData.fromName) };

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true, video: isVideo
  });

  showCallUI(isVideo, incomingCallData.fromName, 'Connecting...');
  initPeer(false, incomingCallData.from, isVideo);
}

function rejectCall() {
  socket.emit('rejectCall', { to: incomingCallData.from });
  document.getElementById('incomingCallModal').classList.add('hidden');
  incomingCallData = null;
}

socket.on('callAccepted', (signal) => {
  currentPeer.signal(signal);
});

socket.on('callRejected', () => {
  cleanupCall();
  alert('Call was declined.');
});

socket.on('callEnded', () => {
  cleanupCall();
  appendSystemMsg('Call ended');
});

// ─── CALL UI ──────────────────────────────────────
function showCallUI(isVideo, name, status) {
  document.getElementById('callOverlay').classList.remove('hidden');

  if (isVideo) {
    document.getElementById('videoArea').classList.remove('hidden');
    document.getElementById('voiceArea').classList.add('hidden');
  } else {
    document.getElementById('videoArea').classList.add('hidden');
    document.getElementById('voiceArea').classList.remove('hidden');
    document.getElementById('voiceAvatar').textContent = initials(name);
    document.getElementById('voiceAvatar').style.background = colorFor(name);
    document.getElementById('voiceName').textContent = name;
    document.getElementById('voiceStatus').textContent = status;
  }

  document.getElementById('callStatusText').textContent = status;
}

function endCall() {
  if (activeUser) socket.emit('endCall', { to: activeUser.id });
  cleanupCall();
  appendSystemMsg('Call ended');
}

function cleanupCall() {
  if (currentPeer) { currentPeer.destroy(); currentPeer = null; }
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (mediaRecorder && isRecording) { mediaRecorder.stop(); }
  if (speechRecognition) { speechRecognition.stop(); }

  stopCallTimer();
  isScreenSharing = false;
  isRecording = false;
  isMuted = false;
  isCameraOff = false;
  isCaptionsOn = false;

  document.getElementById('callOverlay').classList.add('hidden');
  document.getElementById('screenBanner').classList.add('hidden');
  document.getElementById('captionsBox').classList.add('hidden');
  document.getElementById('btnMute').classList.remove('active');
  document.getElementById('btnCamera').classList.remove('active');
  document.getElementById('btnScreen').classList.remove('active');
  document.getElementById('btnRecord').classList.remove('active');
  document.getElementById('btnCaptions').classList.remove('active');

  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('localVideo').srcObject = null;
}

// ─── CALL TIMER ───────────────────────────────────
function startCallTimer() {
  callSeconds = 0;
  const timerEl   = document.getElementById('callTimer');
  const timerBig  = document.getElementById('callTimerBig');
  timerEl.classList.remove('hidden');
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = Math.floor(callSeconds / 60).toString().padStart(2,'0');
    const s = (callSeconds % 60).toString().padStart(2,'0');
    const t = `${m}:${s}`;
    timerEl.textContent = t;
    timerBig.textContent = t;
  }, 1000);
}

function stopCallTimer() {
  clearInterval(callTimerInterval);
  document.getElementById('callTimer').classList.add('hidden');
  document.getElementById('callTimerBig').textContent = '00:00';
}

// ─── MUTE ─────────────────────────────────────────
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('btnMute').classList.toggle('active', isMuted);
}

// ─── CAMERA ───────────────────────────────────────
function toggleCamera() {
  if (!localStream) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff);
  document.getElementById('btnCamera').classList.toggle('active', isCameraOff);
}

// ─── SCREEN SHARE ─────────────────────────────────
async function toggleScreenShare() {
  if (!currentPeer) return;

  if (!isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      const sender = currentPeer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);

      document.getElementById('localVideo').srcObject = screenStream;
      document.getElementById('screenBanner').classList.remove('hidden');
      document.getElementById('btnScreen').classList.add('active');
      document.getElementById('pillScreen').classList.add('on');

      socket.emit('screenShareStarted', { to: activeUser.id });
      isScreenSharing = true;

      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.error('Screen share error:', err);
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (!currentPeer || !localStream) return;
  const cameraTrack = localStream.getVideoTracks()[0];
  const sender = currentPeer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender && cameraTrack) sender.replaceTrack(cameraTrack);

  document.getElementById('localVideo').srcObject = localStream;
  document.getElementById('screenBanner').classList.add('hidden');
  document.getElementById('btnScreen').classList.remove('active');
  document.getElementById('pillScreen').classList.remove('on');

  socket.emit('screenShareStopped', { to: activeUser.id });
  isScreenSharing = false;
}

socket.on('peerScreenSharing', ({ sharing }) => {
  document.getElementById('screenBanner').textContent = sharing
    ? `${activeUser?.name} is sharing their screen`
    : '';
  document.getElementById('screenBanner').classList.toggle('hidden', !sharing);
});

// ─── RECORDING ────────────────────────────────────
function toggleRecording() {
  if (!localStream) return;

  if (!isRecording) {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(localStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexchat-call-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    mediaRecorder.start();
    isRecording = true;
    document.getElementById('btnRecord').classList.add('active');
    document.getElementById('btnRecord').style.background = '#E24B4A';
  } else {
    mediaRecorder.stop();
    isRecording = false;
    document.getElementById('btnRecord').classList.remove('active');
    document.getElementById('btnRecord').style.background = '';
  }
}

// ─── LIVE CAPTIONS ────────────────────────────────
function toggleCaptions() {
  isCaptionsOn = !isCaptionsOn;
  document.getElementById('btnCaptions').classList.toggle('active', isCaptionsOn);
  document.getElementById('pillCaptions').classList.toggle('on', isCaptionsOn);

  if (isCaptionsOn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Live captions not supported in this browser. Use Chrome.'); isCaptionsOn = false; return; }

    speechRecognition = new SR();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onresult = (e) => {
      const text = Array.from(e.results)
        .map(r => r[0].transcript).join('');
      document.getElementById('captionText').textContent = text;
      document.getElementById('captionsBox').classList.remove('hidden');

      if (e.results[e.results.length - 1].isFinal && activeUser) {
        socket.emit('caption', { to: activeUser.id, text });
      }
    };

    speechRecognition.start();
  } else {
    if (speechRecognition) speechRecognition.stop();
    document.getElementById('captionsBox').classList.add('hidden');
  }
}

socket.on('receiveCaption', ({ from, text }) => {
  document.getElementById('captionText').textContent = `${from}: ${text}`;
  document.getElementById('captionsBox').classList.remove('hidden');
  setTimeout(() => document.getElementById('captionsBox').classList.add('hidden'), 4000);
});

// ─── SCHEDULE CALL ────────────────────────────────
function openScheduleModal() {
  if (!activeUser) { alert('Select a user first.'); return; }
  document.getElementById('scheduleWith').textContent = `with ${activeUser.name}`;
  document.getElementById('scheduleModal').classList.remove('hidden');
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').classList.add('hidden');
}

function confirmSchedule() {
  const time    = document.getElementById('scheduleTime').value;
  const message = document.getElementById('scheduleMessage').value || 'Scheduled call';
  if (!time) { alert('Pick a date and time.'); return; }

  socket.emit('scheduleCall', { to: activeUser.id, time, message });
  closeScheduleModal();
  appendSystemMsg(`Call scheduled with ${activeUser.name} at ${new Date(time).toLocaleString()}`);
}

socket.on('scheduledCallAlert', (data) => {
  const name = data.fromName || activeUser?.name || 'Someone';
  if (confirm(`Scheduled call with ${name}! Join now?`)) {
    if (data.from) {
      // We're the recipient — incoming call
      incomingCallData = { from: data.from, fromName: name, isVideo: true };
      acceptCall();
    } else {
      // We're the initiator
      startVideoCall(data.to, activeUser?.name || 'User');
    }
  }
});

// ─── CALL HISTORY ─────────────────────────────────
function addCallHistory(name, type) {
  const hist = document.getElementById('callHistory');
  const empty = hist.querySelector('.ch-empty');
  if (empty) empty.remove();

  const color = colorFor(name);
  const div = document.createElement('div');
  div.className = 'ch-item';
  div.innerHTML = `
    <div class="ch-icon" style="background:${color};">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        ${type === 'Video call'
          ? '<rect x="1" y="4" width="9" height="8" rx="1.5" fill="#fff"/><path d="M10 7l4-2v6l-4-2V7z" fill="#fff"/>'
          : '<path d="M3 2h2.5l1 3L5 6.5c.8 1.6 2 2.8 3.5 3.5L10 8.5l3 1V12c0 .8-.7 1-1.5.8C5.5 11.2 2 7 2 3.5 1.8 2.7 2.2 2 3 2z" fill="#fff"/>'}
      </svg>
    </div>
    <div>
      <div class="ch-name">${name}</div>
      <div class="ch-detail">${type}</div>
    </div>
    <div class="ch-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  `;
  hist.prepend(div);
}

// ─── WHITEBOARD ───────────────────────────────────
let wb = { canvas: null, ctx: null, drawing: false, lastX: 0, lastY: 0 };

function initWhiteboard() {
  wb.canvas = document.getElementById('whiteboardCanvas');
  wb.ctx = wb.canvas.getContext('2d');

  wb.canvas.addEventListener('mousedown',  (e) => { wb.drawing = true; [wb.lastX, wb.lastY] = getPos(e); });
  wb.canvas.addEventListener('mousemove',  (e) => { if (wb.drawing) draw(e); });
  wb.canvas.addEventListener('mouseup',    ()  => { wb.drawing = false; });
  wb.canvas.addEventListener('mouseleave', ()  => { wb.drawing = false; });

  wb.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); wb.drawing = true; [wb.lastX, wb.lastY] = getPos(e.touches[0]); });
  wb.canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); if (wb.drawing) draw(e.touches[0]); });
  wb.canvas.addEventListener('touchend',   ()  => { wb.drawing = false; });
}

function resizeWhiteboard() {
  if (!wb.canvas) return;
  const mainContent = document.querySelector('.main-content');
  const header = document.querySelector('#panelWhiteboard .panel-header');
  const hint   = document.querySelector('#panelWhiteboard .wb-hint');
  const totalH = mainContent.clientHeight;
  const headerH = header ? header.offsetHeight : 56;
  const hintH   = hint   ? hint.offsetHeight   : 28;

  // Save current drawing before resize
  let imgData = null;
  if (wb.canvas.width > 0 && wb.canvas.height > 0) {
    imgData = wb.ctx.getImageData(0, 0, wb.canvas.width, wb.canvas.height);
  }

  wb.canvas.width  = mainContent.clientWidth;
  wb.canvas.height = totalH - headerH - hintH;

  // Restore drawing after resize
  if (imgData) wb.ctx.putImageData(imgData, 0, 0);
}

function getPos(e) {
  const rect = wb.canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function draw(e) {
  const [x, y] = getPos(e);
  const color = document.getElementById('wbColor').value;
  const size  = parseInt(document.getElementById('wbSize').value);

  wb.ctx.beginPath();
  wb.ctx.moveTo(wb.lastX, wb.lastY);
  wb.ctx.lineTo(x, y);
  wb.ctx.strokeStyle = color;
  wb.ctx.lineWidth   = size;
  wb.ctx.lineCap     = 'round';
  wb.ctx.lineJoin    = 'round';
  wb.ctx.stroke();

  const drawData = { x, y, lx: wb.lastX, ly: wb.lastY, color, size };
  [wb.lastX, wb.lastY] = [x, y];

  if (activeUser) socket.emit('whiteboardDraw', { to: activeUser.id, drawData });
}

socket.on('whiteboardReceive', (d) => {
  if (!wb.ctx) return;
  wb.ctx.beginPath();
  wb.ctx.moveTo(d.lx, d.ly);
  wb.ctx.lineTo(d.x, d.y);
  wb.ctx.strokeStyle = d.color;
  wb.ctx.lineWidth   = d.size;
  wb.ctx.lineCap     = 'round';
  wb.ctx.lineJoin    = 'round';
  wb.ctx.stroke();
});

function clearWhiteboard() {
  wb.ctx.clearRect(0, 0, wb.canvas.width, wb.canvas.height);
  if (activeUser) socket.emit('whiteboardClear', { to: activeUser.id });
}

socket.on('whiteboardCleared', () => {
  wb.ctx.clearRect(0, 0, wb.canvas.width, wb.canvas.height);
});

function downloadWhiteboard() {
  const link = document.createElement('a');
  link.download = `nexchat-whiteboard-${Date.now()}.png`;
  link.href = wb.canvas.toDataURL();
  link.click();
}

window.addEventListener('resize', resizeWhiteboard);
