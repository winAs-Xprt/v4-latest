// const socket = io();
const socket = io("https://walkie.iniserve.com/", {
  transports: ["polling", "websocket"], // allow fallback
  withCredentials: true, // only if your server uses credentials
  path: "/socket.io", // optional unless custom path
});
// If still not connected after 5 seconds, show an error or retry
setTimeout(() => {
  if (!socket.connected) {
    console.error("Failed to connect to WebSocket after 5 seconds.");
    // Optionally show a message to the user
  }
}, 5000);



// const socket = io();
const socket = io();


let localStream;
let peerConnection;
const roomId = window.location.pathname.split('/').pop();
const userId = localStorage.getItem('userId') || crypto.randomUUID();
localStorage.setItem('userId', userId);

let currentParticipants = 0;

let isSettingRemoteAnswer = false;
let pendingAnswer = null;
let isNegotiating = false;

// DOM Elements
const status = document.getElementById('status');
const localAudioContainer = document.getElementById('localAudioLevel');
const remoteAudioContainer = document.getElementById('remoteAudioContainer');
const participantCount = document.getElementById('participantCount');

remoteAudioContainer.innerHTML = `
    <div class="participant-card">
        <div class="card-inner">
            <div class="card-header">Remote User</div>
                <div class="card-content">
                    <div class="l1">
                        <div class="avatar">
                            <img src="${profileImgUrl}"  alt="Avatar">
                        </div>
                    <div class="name">Not Connected...</div>
                </div>
                <div class="audio-meter">
                    <div class="audio-level" id="localAudioLevel" style="width: 0%;"></div>
                </div>
        </div>
    </div>`; // Clear remote audio container

let pushToTalkActive = false; // Track push-to-talk button state
// ICE Server Configuration
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.voipbuster.com" }  // Additional reliable STUN server
  ],
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle"
};


function createRemoteAudioElement(stream, userId) {
    const audioElement = document.createElement('audio');
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.controls = false;
    audioElement.setAttribute('playsinline', 'true');

    const container = document.createElement('div');
    container.className = 'participant-card';
    container.id = `remote-${userId}`;

    container.innerHTML = `
        <div class="card-inner">
            <div class="card-header">
                <span>Remote User</span>
            </div>
            <div class="card-content">
                <div class="l1">
                    <div class="avatar">
                        <img src="${profileImgUrl}" alt="Avatar">
                    </div>
                    <div class="name">Connected...</div>
                </div>
                <div class="audio-meter">
                    <div class="audio-level audio-level-${userId}" style="width: 0%; height: 8px; background-color: #22c55e;"></div>
                </div>
            </div>
        </div>
    `;

    audioElement.play().catch(e => console.log('Audio play error:', e));
    visualizeAudio(audioElement, container, userId);
    remoteAudioContainer.innerHTML = ''; // Clear previous content
    remoteAudioContainer.appendChild(container);
    return container;
}


// Visualize audio levels
function visualizeAudio(audioElement, container, userId) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(audioElement.srcObject);
        source.connect(analyser);
        analyser.fftSize = 32;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        function update() {
            if (!audioElement.srcObject || audioElement.srcObject.getTracks().length === 0) return;
            analyser.getByteFrequencyData(dataArray);
            const level = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
            const levelElement = container.querySelector(`.audio-level-${userId}`);
            if (levelElement) {
                levelElement.style.width = `${Math.min(100, level * 0.8)}%`;
            }
            requestAnimationFrame(update);
        }
        audioElement.onplaying = update;
    } catch (err) {
        console.error('Audio visualization error:', err);
    }
}

// Toggle mute state
function toggleMute(mute) {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !mute;
        });
    }
}


// Setup push-to-talk
function setupPushToTalk() {
    const pushToTalkBtn = document.getElementById('pushToTalkBtn');
    if (!pushToTalkBtn) return;
    let pushToTalkActive = false;
    let alwaysTransmit = false;
    let lastTap = 0;
    const startTransmitting = () => {
        if (!pushToTalkActive && peerConnection && localStream) {
            pushToTalkActive = true;
            toggleMute(false);
            pushToTalkBtn.classList.add('active');
        }
    };

    const stopTransmitting = () => {
        if (pushToTalkActive && peerConnection && localStream) {
            pushToTalkActive = false;
            toggleMute(true);
            pushToTalkBtn.classList.remove('active');
        }
    };

    const enableAlwaysTransmit = () => {
        alwaysTransmit = true;
        startTransmitting();
        console.log("Always Transmit Mode ON");
    };

    const disableAlwaysTransmit = () => {
        alwaysTransmit = false;
        stopTransmitting();
        console.log("Always Transmit Mode OFF");
    };

    // Handle double tap to enable, single tap to disable
    pushToTalkBtn.addEventListener('click', (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 300 && tapLength > 0) {
            // Double tap: enable always transmit
            if (!alwaysTransmit) {
                enableAlwaysTransmit();
            }
        } else {
            // Single tap: disable always transmit (if active)
            setTimeout(() => {
                if (new Date().getTime() - lastTap >= 300 && alwaysTransmit) {
                    disableAlwaysTransmit();
                }
            }, 300);
        }

        lastTap = currentTime;
    });


    // Mouse events (only if not in always transmit mode)
    pushToTalkBtn.addEventListener('mousedown', () => {
        if (!alwaysTransmit) startTransmitting();
    });
    pushToTalkBtn.addEventListener('mouseup', () => {
        if (!alwaysTransmit) stopTransmitting();
    });
    pushToTalkBtn.addEventListener('mouseleave', () => {
        if (!alwaysTransmit) stopTransmitting();
    });

    // Touch events (only if not in always transmit mode)

    let lastTapTime = 0;
    let tapTimeout;
    const handleTap = () => {
        const currentTime = new Date().getTime();
        const tapGap = currentTime - lastTapTime;
        if (tapGap < 300 && tapGap > 0) {
            // Double tap detected
            clearTimeout(tapTimeout); // Cancel single-tap timeout
            if (!alwaysTransmit) enableAlwaysTransmit();
        } else {
            // Delay single-tap action to check for double tap
            tapTimeout = setTimeout(() => {
                if (alwaysTransmit) disableAlwaysTransmit();
            }, 300);
        }
        lastTapTime = currentTime;
    };
    

    // Touch events (hold to talk if not always transmit)
    pushToTalkBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!alwaysTransmit) startTransmitting();
    });

    // Handle single/double tap on mobile (touchend)
    pushToTalkBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (!alwaysTransmit) stopTransmitting(); // keep your original logic
        handleTap();
    });

    // Also support desktop (click)
    pushToTalkBtn.addEventListener('click', (e) => {
        // On desktop, click is reliable
        handleTap();
    });

    // Handle window blur (stop transmitting if not always transmit mode)
    window.addEventListener('blur', () => {
        if (!alwaysTransmit) stopTransmitting();
    });
}


// Initialize call
async function initializeCall() {
    try {
        // First check room status
        const response = await fetch(`/check_room/${roomId}`);
        const roomStatus = await response.json();
        
        if (!roomStatus.can_join) {
            // updateStatus('fas fa-users', 'Room is full (2/2 participants)', 'text-red-400');
             remoteAudioContainer.innerHTML = `
            <div class="participant-card">
                <div class="card-inner">
                    <div class="card-header">Remote User</div>
                    <div class="card-content">
                        <div class="l1">
                            <div class="avatar">
                                <img src="${profileImgUrl}"  alt="Avatar">
                            </div>
                            <div class="name">Not Connected....</div>
                        </div>
                        <div class="audio-meter">
                            <div class="audio-level" id="localAudioLevel" style="width: 0%;"></div>
                        </div>
                    </div>
                </div>
            </div>
            `;
            return;
        }
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        peerConnection = new RTCPeerConnection(config);
        // State change handlers
        peerConnection.onsignalingstatechange = () => {
            console.log('Signaling state:', peerConnection.signalingState);
            if (peerConnection.signalingState === 'stable' && pendingAnswer) {
                const answer = pendingAnswer;
                pendingAnswer = null;
                setTimeout(() => {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
                        .catch(e => console.error('Pending answer error:', e));
                }, 100);
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (peerConnection.iceConnectionState === 'disconnected') {
                // updateStatus('fas fa-exclamation-triangle', 'Disconnected', 'text-red-400');
                endCall();
                location.reload();
            }
        };

        peerConnection.onicecandidate = e => {
            if (e.candidate) {
                socket.emit('candidate', {
                    candidate: e.candidate,
                    room: roomId
                });
            }
        };

        peerConnection.ontrack = e => {
            const existing = document.getElementById(`remote-${e.streams[0].id}`);
            if (existing) {
                existing.remove(); // Remove any stale copy
            }
            const container = createRemoteAudioElement(e.streams[0], e.streams[0].id);
            monitorConnectionQuality();
        };

        // Add local tracks
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(localStream);
        source.connect(analyser);
        analyser.fftSize = 32;
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        function updateLocalAudio() {
            analyser.getByteFrequencyData(dataArray);
            const level = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
            const levelElement = document.getElementById('localAudioLevel');
            // console.log('Local audio level:', level);
            if (levelElement) {
                levelElement.style.width = `${Math.min(100, level * 0.8)}%`;
            }
            requestAnimationFrame(updateLocalAudio);
        }
        updateLocalAudio();

        // Create and send offer
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            iceRestart: false
        });
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            offer: offer,
            room: roomId
        });

        // Initialize push-to-talk
        setupPushToTalk();
        toggleMute(true);
        
    } catch (err) {
        console.error('Error initializing call:', err);
    }
}


// Add this handler for room full event
socket.on('room_full', () => {
    remoteAudioContainer.innerHTML = `
            <div class="participant-card">
                <div class="card-inner">
                    <div class="card-header">Remote User</div>
                    <div class="card-content">
                        <div class="l1">
                            <div class="avatar">
                                <img src="${profileImgUrl}"  alt="Avatar">
                            </div>
                            <div class="name">Not Connected....</div>
                        </div>
                        <div class="audio-meter">
                            <div class="audio-level" id="localAudioLevel" style="width: 0%;"></div>
                        </div>
                    </div>
                </div>
            </div>
    `;
    // Clean up if already started
    endCall();
});

socket.on('participant_update', (data) => {
    currentParticipants = data.count;
    updateParticipantCount(currentParticipants);
    console.log('Participant count updated!!:', currentParticipants);
    if (currentParticipants >= 2) {
        // Update UI to show room is full
        // document.getElementById('roomStatus').textContent = 'Room is full (2/2)';
    }
});


socket.on('participant_left', (data) => {
    currentParticipants = data.count;
    updateParticipantCount(currentParticipants);

    // Remove the participant card
    const remoteCard = document.getElementById(`remote-${data.userId}`);
    console.log(remoteCard, currentParticipants, 'Remote card removed');
    if (remoteCard) remoteCard.remove();

    // Show a message if no remote participants remain
    if (currentParticipants === 1) {
 remoteAudioContainer.innerHTML = `
    <div class="participant-card">
        <div class="card-inner">
            <div class="card-header">Remote User</div>
            <div class="card-content">
                <div class="l1">
                    <div class="avatar">
                        <img src="${profileImgUrl}"  alt="Avatar">
                    </div>
                    <div class="name">Not Connected...</div>
                </div>  
                <div class="audio-meter">
                    <div class="audio-level" id="localAudioLevel" style="width: 0%;"></div>
                </div>
            </div>
        </div>
    </div>
        `;
    }

});


// Handle incoming offers
socket.on('offer', async (data) => {


    if (data.sender === socket.id) return;
    const response = await fetch(`/check_room/${roomId}`);
    const roomStatus = await response.json();
    
    if (roomStatus.can_join) {
    
    try {
        if (!peerConnection) {
            await initializeCall();
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            answer: answer,
            room: roomId
        });
    } catch (err) {
        console.error('Error handling offer:', err);
        // updateStatus('fas fa-exclamation-circle', 'Error handling call', 'text-red-400');
    }
}
});

// Handle incoming answers
socket.on('answer', async (data) => {
    if (data.sender === socket.id || !peerConnection) return;

    const response = await fetch(`/check_room/${roomId}`);
    const roomStatus = await response.json();
    
    if (roomStatus.can_join) {
    
    try {
        if (peerConnection.signalingState !== 'have-local-offer') {
            console.warn('Wrong state for answer:', peerConnection.signalingState);
            pendingAnswer = data.answer;
            return;
        }

        isSettingRemoteAnswer = true;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        isSettingRemoteAnswer = false;
        
        if (pendingAnswer) {
            const answer = pendingAnswer;
            pendingAnswer = null;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
        
        // updateStatus('fas fa-check-circle', 'Connected! Push to talk', 'text-green-400');
    } catch (err) {
        console.error('Error handling answer:', err);
        // updateStatus('fas fa-exclamation-circle', 'Error connecting', 'text-red-400');
    }
}
});

// Handle ICE candidates
socket.on('candidate', async (data) => {
    if (data.sender === socket.id || !peerConnection) return;
    
    const response = await fetch(`/check_room/${roomId}`);
    const roomStatus = await response.json();
    
    if (roomStatus.can_join) {

    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
}
});

// Update participant count
function updateParticipantCount(count) {
    currentParticipants = count;
    // participantCount.textContent = `${count}/2`;
    console.log('updated Participant count:', count);
    
    // You might want to add this to your HTML:
    // <div id="roomStatus" class="text-sm text-gray-300">Participants: 1/2</div>
}
// End call
function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Reset push-to-talk state
    pushToTalkActive = false;
    const pushToTalkBtn = document.getElementById('pushToTalkBtn');
    if (pushToTalkBtn) {
        pushToTalkBtn.classList.remove('active');
    }
    
    // ... rest of your existing endCall code ...
}
// Initialize call when socket connects
socket.on('connect', () => {
    socket.emit('join', { room: roomId });
    initializeCall();
});

// Handle page refresh or close
window.addEventListener('beforeunload', (e) => {


    if (peerConnection) {
        peerConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (socket.connected) {
            socket.emit('leave', { 
                room: roomId
            });
        }
      if (performance.navigation.type === performance.navigation.TYPE_RELOAD) {
    alert("You refreshed the page! Connection will be disrupted.");
  }

    const confirmationMessage = "The connection will be disrupted. Do you really want to leave?";

    e.preventDefault();  // Required for Chrome
    e.returnValue = confirmationMessage; // Required for other browsers

    return confirmationMessage;

});


const DEBUG = true;
const DEBUG_PREFIX = "[WebRTC]";

let connectionStartTime = null;

function monitorConnectionQuality() {
  if (!peerConnection) return;

  peerConnection.getStats().then(stats => {
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.nominated) {
        const rtt = report.currentRoundTripTime * 1000 || 0;
        const packetsLost = report.packetsLost || 0;
        const packetsSent = report.packetsSent || 1;
        const packetLoss = (packetsLost / packetsSent * 100).toFixed(1);
        
        if (DEBUG) console.log(`${DEBUG_PREFIX} Stats - RTT: ${rtt.toFixed(1)}ms, Loss: ${packetLoss}%`);
        
        // Update UI with connection stats
        
        // Log quality warnings
        if (rtt > 300) {
          console.warn(`${DEBUG_PREFIX} High latency: ${rtt.toFixed(1)}ms`);
        }
        if (packetLoss > 5) {
          console.warn(`${DEBUG_PREFIX} High packet loss: ${packetLoss}%`);
        }
      }
    });
    
    // Continue monitoring if connected
    if (peerConnection.iceConnectionState === 'connected') {
      setTimeout(monitorConnectionQuality, 2000);
    }
  }).catch(err => {
    console.error(`${DEBUG_PREFIX} Stats error:`, err);
  });
}

// Calculate and log connection time
function logConnectionTime() {
  if (connectionStartTime) {
    const connectionTime = (Date.now() - connectionStartTime) / 1000;
    console.log(`${DEBUG_PREFIX} Connection established in ${connectionTime.toFixed(2)} seconds`);
    connectionStartTime = null;
  }
}
