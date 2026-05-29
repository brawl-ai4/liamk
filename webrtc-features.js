/**
 * Villagesquare - Image & Video Calling Enhancements
 * WebRTC implementation for peer-to-peer video/audio calls and image sharing
 */

// ===== IMAGE SHARING =====
class ImageSharing {
  constructor() {
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    this.setupImageInput();
  }

  setupImageInput() {
    const imageInput = document.getElementById('image-input');
    if (!imageInput) {
      const input = document.createElement('input');
      input.id = 'image-input';
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', (e) => this.handleImageSelect(e));
    }
  }

  handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!this.supportedTypes.includes(file.type)) {
      showNotification('Unsupported image format. Use JPEG, PNG, WebP, or GIF.', 'error');
      return;
    }

    if (file.size > this.maxFileSize) {
      showNotification('Image too large. Maximum 10MB.', 'error');
      return;
    }

    this.compressAndSend(file);
  }

  compressAndSend(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const imageData = event.target.result;
              this.sendImage(imageData, file.name);
            };
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          0.85
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  sendImage(imageData, filename) {
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');

    if (!socket || !currentChatId) {
      showNotification('No active chat selected.', 'error');
      return;
    }

    socket.emit('send-image', {
      channel: currentChatId,
      image: imageData,
      filename: filename,
      timestamp: Date.now(),
    });

    messageInput.value = '';
  }

  triggerImageUpload() {
    document.getElementById('image-input').click();
  }

  displayImage(message) {
    const li = document.createElement('li');
    li.className = 'message';
    li.dataset.messageId = message.id;

    const avatarColor = stringToColor(message.author);
    const authorInitial = message.author.charAt(0).toUpperCase();

    li.innerHTML = `
      <div class="message-avatar" style="background: ${avatarColor};">${authorInitial}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-author ${message.isMe ? 'me' : ''}">${message.displayName || message.author}</span>
          ${message.title ? `<span class="message-title-badge">${message.title}</span>` : ''}
          <span class="message-time">${formatTime(message.timestamp)}</span>
        </div>
        <div class="message-image-wrapper">
          <img src="${message.image}" alt="Shared image" class="message-image" onclick="openImagePreview('${message.image}', '${message.filename || 'image'}')">
        </div>
        ${message.text ? `<div class="message-text">${escapeHtml(message.text)}</div>` : ''}
        <div class="message-actions">
          ${canDeleteMessage(message) ? `<button class="message-delete-btn" onclick="deleteMessage('${message.id}')">×</button>` : ''}
        </div>
      </div>
    `;

    return li;
  }
}

// ===== VIDEO CALLING WITH WEBRTC =====
class VideoCalling {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.callState = 'idle'; // idle, calling, connecting, connected, ended
    this.callTimer = null;
    this.callStartTime = null;
    this.signalingChannel = null;
    this.iceServers = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      {
        urls: ['turn:turnserver.example.com:3478'],
        username: 'user',
        credential: 'password',
      },
    ];
  }

  async initializeCall(recipientHandle, isInitiator = true) {
    try {
      this.callState = 'calling';
      this.showCallModal(recipientHandle);

      // Get local media
      this.localStream = await this.getLocalMedia();
      this.displayLocalVideo(this.localStream);

      if (isInitiator) {
        await this.createPeerConnection();
        await this.createAndSendOffer(recipientHandle);
      }

      if (!socket) return;
      socket.emit('call-initiated', {
        to: recipientHandle,
        from: currentUser.handle,
        type: 'video',
      });
    } catch (error) {
      console.error('Error initializing call:', error);
      showNotification('Failed to start video call: ' + error.message, 'error');
      this.endCall();
    }
  }

  async getLocalMedia() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw new Error('Camera/microphone access denied');
    }
  }

  async createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle remote stream
    this.peerConnection.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (this.remoteStream !== event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.displayRemoteVideo(this.remoteStream);
      }
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', {
          to: this.currentRemoteUser,
          candidate: event.candidate,
        });
      }
    };

    // Monitor connection state
    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'disconnected') {
        this.handleConnectionLoss();
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.peerConnection.iceConnectionState);
      if (this.peerConnection.iceConnectionState === 'failed') {
        this.handleICEFailure();
      }
    };
  }

  async createAndSendOffer(recipientHandle) {
    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.peerConnection.setLocalDescription(offer);

      if (socket) {
        socket.emit('webrtc-offer', {
          to: recipientHandle,
          from: currentUser.handle,
          offer: this.peerConnection.localDescription,
        });
      }
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  async handleOffer(offer, fromHandle) {
    try {
      this.currentRemoteUser = fromHandle;
      this.callState = 'connecting';
      this.showCallModal(fromHandle);

      this.localStream = await this.getLocalMedia();
      this.displayLocalVideo(this.localStream);

      await this.createPeerConnection();
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      if (socket) {
        socket.emit('webrtc-answer', {
          to: fromHandle,
          from: currentUser.handle,
          answer: this.peerConnection.localDescription,
        });
      }

      this.updateCallStatus('Connecting...');
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  async handleAnswer(answer) {
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      this.callState = 'connected';
      this.updateCallStatus('Connected');
      this.startCallTimer();
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }

  async addIceCandidate(candidate) {
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }

  displayLocalVideo(stream) {
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
      localVideo.srcObject = stream;
      localVideo.play().catch((e) => console.error('Play error:', e));
    }
  }

  displayRemoteVideo(stream) {
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
      remoteVideo.srcObject = stream;
      remoteVideo.play().catch((e) => console.error('Play error:', e));
    }
  }

  startCallTimer() {
    this.callStartTime = Date.now();
    const timerDisplay = document.getElementById('call-timer');

    this.callTimer = setInterval(() => {
      if (timerDisplay && this.callState === 'connected') {
        const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }, 1000);
  }

  updateCallStatus(status) {
    const statusEl = document.getElementById('call-status');
    if (statusEl) {
      statusEl.textContent = status;
    }
  }

  toggleVideo(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }

  toggleAudio(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }

  handleConnectionLoss() {
    showNotification('Connection lost. Attempting to reconnect...', 'warning');
    this.updateCallStatus('Reconnecting...');
  }

  handleICEFailure() {
    showNotification('Connection failed. Please try again.', 'error');
    this.endCall();
  }

  endCall() {
    this.callState = 'ended';

    if (this.callTimer) {
      clearInterval(this.callTimer);
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.localStream = null;
    this.remoteStream = null;
    this.closeCallModal();

    if (socket && this.currentRemoteUser) {
      socket.emit('call-ended', {
        to: this.currentRemoteUser,
      });
    }
  }

  showCallModal(recipientHandle) {
    const modal = document.getElementById('video-call-modal') || this.createCallModal();
    document.getElementById('call-recipient').textContent = recipientHandle;
    document.getElementById('call-timer').textContent = '0:00';
    modal.classList.remove('hidden');
  }

  closeCallModal() {
    const modal = document.getElementById('video-call-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  createCallModal() {
    const modal = document.createElement('div');
    modal.id = 'video-call-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card video-call-modal-card">
        <div class="modal-head">
          <h2>📞 Video Call</h2>
          <button type="button" class="icon-btn" id="close-call-btn" aria-label="Close">×</button>
        </div>
        <div style="padding: 1.5rem;">
          <p class="modal-hint">Calling <strong id="call-recipient">...</strong></p>
          <div id="call-status" class="call-status">Connecting...</div>
          <div class="video-container">
            <div class="video-box">
              <video id="local-video" muted playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
              <div class="video-label">You</div>
            </div>
            <div class="video-box no-video" id="remote-video-box">
              <video id="remote-video" playsinline style="width: 100%; height: 100%; object-fit: cover; display: none;"></video>
              <div id="remote-label" style="text-align: center;">Waiting for video...</div>
              <div class="video-label">Caller</div>
            </div>
          </div>
          <div id="call-timer" class="call-timer">0:00</div>
          <div class="call-controls">
            <button id="toggle-audio-btn" type="button" class="call-controls button">🎤 Mute</button>
            <button id="toggle-video-btn" type="button" class="call-controls button">📹 Camera Off</button>
            <button id="end-call-btn" type="button" class="call-controls button danger-btn">End Call</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('close-call-btn').onclick = () => this.endCall();
    document.getElementById('end-call-btn').onclick = () => this.endCall();

    let audioEnabled = true;
    document.getElementById('toggle-audio-btn').onclick = () => {
      audioEnabled = !audioEnabled;
      this.toggleAudio(audioEnabled);
      document.getElementById('toggle-audio-btn').textContent = audioEnabled ? '🎤 Mute' : '🔇 Unmuted';
    };

    let videoEnabled = true;
    document.getElementById('toggle-video-btn').onclick = () => {
      videoEnabled = !videoEnabled;
      this.toggleVideo(videoEnabled);
      document.getElementById('toggle-video-btn').textContent = videoEnabled ? '📹 Camera Off' : '📸 Camera On';
    };

    return modal;
  }
}

// ===== UTILITY FUNCTIONS =====
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = (hash & 0xffffff).toString(16).padStart(6, '0');
  return '#' + color;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function openImagePreview(imageUrl, filename) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card image-preview-modal">
      <div class="modal-head">
        <h2>Image Preview</h2>
        <button type="button" class="icon-btn" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="image-preview-container">
        <img src="${imageUrl}" alt="${escapeHtml(filename)}" style="max-width: 100%; max-height: 500px; border-radius: 6px;">
        <p style="margin-top: 1rem; color: var(--text-muted);">${escapeHtml(filename)}</p>
        <a href="${imageUrl}" download="${filename}" style="display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: var(--accent); color: white; text-decoration: none; border-radius: 6px;">Download</a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--online)'};
    color: white;
    border-radius: 6px;
    z-index: 3000;
    animation: slideInLeft 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

function canDeleteMessage(message) {
  return message.isMe || isAdmin;
}

function deleteMessage(messageId) {
  if (!socket || !currentChatId) return;
  socket.emit('delete-message', {
    channel: currentChatId,
    messageId: messageId,
  });
}

// ===== GLOBAL INSTANCES =====
const imageSharing = new ImageSharing();
const videoCalling = new VideoCalling();

// ===== ADD BUTTONS TO CHAT FORM =====
function setupChatFormButtons() {
  const chatForm = document.getElementById('chat-form');
  if (!chatForm) return;

  // Check if buttons already exist
  if (document.getElementById('image-upload-btn')) return;

  const imageBtn = document.createElement('button');
  imageBtn.id = 'image-upload-btn';
  imageBtn.type = 'button';
  imageBtn.className = 'form-action-btn';
  imageBtn.title = 'Send image';
  imageBtn.innerHTML = '🖼️';
  imageBtn.onclick = () => imageSharing.triggerImageUpload();

  const videoBtn = document.createElement('button');
  videoBtn.id = 'video-call-btn';
  videoBtn.type = 'button';
  videoBtn.className = 'form-action-btn';
  videoBtn.title = 'Start video call';
  videoBtn.innerHTML = '📹';
  videoBtn.onclick = () => {
    if (currentChatId && currentChatId.startsWith('dm:')) {
      const recipientHandle = currentChatId.split(':')[1].split('|').find((h) => h !== currentUser.handle);
      videoCalling.initializeCall(recipientHandle, true);
    }
  };

  // Insert before the send button
  const submitBtn = chatForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    chatForm.insertBefore(videoBtn, submitBtn);
    chatForm.insertBefore(imageBtn, submitBtn);
  }
}

// Listen for call events
if (socket) {
  socket.on('call-initiated', (data) => {
    const msg = `${data.from} is calling you...`;
    if (confirm(`${msg}\n\nAccept call?`)) {
      videoCalling.initializeCall(data.from, false);
    }
  });

  socket.on('webrtc-offer', (data) => {
    videoCalling.handleOffer(data.offer, data.from);
  });

  socket.on('webrtc-answer', (data) => {
    videoCalling.handleAnswer(data.answer);
  });

  socket.on('ice-candidate', (data) => {
    videoCalling.addIceCandidate(data.candidate);
  });

  socket.on('call-ended', () => {
    if (videoCalling.callState === 'connected' || videoCalling.callState === 'connecting') {
      videoCalling.endCall();
    }
  });

  socket.on('message', (data) => {
    if (data.image) {
      const messageEl = imageSharing.displayImage(data);
      document.getElementById('messages').appendChild(messageEl);
    }
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', setupChatFormButtons);
window.addEventListener('load', setupChatFormButtons);
