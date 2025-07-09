// // const socket = io();
// const socket = io("https://v-call-nb7m.onrender.com", {
//   transports: ["polling", "websocket"], // allow fallback
//   withCredentials: true, // only if your server uses credentials
//   path: "/socket.io", // optional unless custom path
// });
// // If still not connected after 5 seconds, show an error or retry
// setTimeout(() => {
//   if (!socket.connected) {
//     console.error("Failed to connect to WebSocket after 5 seconds.");
//     // Optionally show a message to the user
//   }
// }, 5000);



// const socket = io();
const socket = io();


let localStream;
let peerConnection;
const roomId = window.location.pathname.split('/').pop();

// Add this at the top of your main.js
let currentParticipants = 0;

// State tracking variables
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
        <div class="card-header">Remote</div>
        <div class="card-content">
            <div class="l1">
            <div class="avatar">
                <img src="${profileImgUrl}"  alt="Avatar">
            </div>
            <div class="name">Waiting....</div>
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

// Update status message
// function updateStatus(iconClass, text, colorClass = 'text-indigo-400') {
//     status.innerHTML = `
//         <div class="flex items-center justify-center space-x-2 hidden">
//             <i class="${iconClass} ${colorClass}"></i>
//             <span>${text}</span>
//         </div>
//     `;
// }

// Create remote audio element
// function createRemoteAudioElement(stream, userId) {
//     const audioElement = document.createElement('audio');
//     audioElement.srcObject = stream;
//     audioElement.autoplay = true;
//     audioElement.controls = false;
//     audioElement.setAttribute('playsinline', 'true');
    
//     const container = document.getElementById("remort-card-content");

//     container.id = `remote-${userId}`;
    
//     container.innerHTML = `

//                 <div class="l1">
//                 <div class="avatar">
//                     <img src="${profileImgUrl}"   alt="Avatar">
//                 </div>
//                 <div class="name">${userId.slice(0, 4)}</div>
//                 </div>
//                 <div class="audio-meter">
//                 <div class="audio-level" id="localAudioLevel" style="width: 70%;"></div>
//                 </div>

//     `;
    
//     container.appendChild(audioElement);
//     audioElement.play().catch(e => console.log('Audio play error:', e));
//     visualizeAudio(audioElement, container);
//     return container;
// }


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
                <span>Participant</span>
                <span>${userId.slice(0, 4)}</span>
            </div>
            <div class="card-content">
                <div class="l1">
                    <div class="avatar">
                        <img src="${profileImgUrl}" alt="Avatar">
                    </div>
                    <div class="name">${userId.slice(0, 4)}</div>
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
            // updateStatus('fas fa-microphone', 'Transmitting...', 'text-green-400');
        }
    };

    const stopTransmitting = () => {
        if (pushToTalkActive && peerConnection && localStream) {
            pushToTalkActive = false;
            toggleMute(true);
            pushToTalkBtn.classList.remove('active');
            // updateStatus('fas fa-microphone-slash', 'Listening...', 'text-yellow-400');
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
        <div class="card-header">Remote</div>
        <div class="card-content">
            <div class="l1">
            <div class="avatar">
                <img src="${profileImgUrl}"  alt="Avatar">
            </div>
            <div class="name">Roomfull....</div>
            </div>
            <div class="audio-meter">
            <div class="audio-level" id="localAudioLevel" style="width: 0%;"></div>
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
        };

        // Add local tracks
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Set up local audio visualization
        // localAudioContainer.innerHTML = `
        //     <div class="w-full h-full flex flex-col justify-center items-center">
        //         <div class="flex items-center space-x-3 mb-2">
        //             <i class="fas fa-microphone text-green-400"></i>
        //             <span>You</span>
        //         </div>
        //         <div class="w-full bg-gray-600 rounded-full h-2">
        //             <div class="bg-green-400 h-2 rounded-full local-audio-level"></div>
        //         </div>
        //     </div>
        // `;
        
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
            console.log('Local audio level:', level);
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
        // updateStatus('fas fa-microphone-slash', 'Ready - Push to talk', 'text-yellow-400');
        
    } catch (err) {
        console.error('Error initializing call:', err);
        // updateStatus('fas fa-exclamation-circle', 'Error accessing microphone', 'text-red-400');
    }
}


// Add this handler for room full event
socket.on('room_full', () => {
    // updateStatus('fas fa-users', 'Room is full (2/2 participants)', 'text-red-400');
    remoteAudioContainer.innerHTML = `
        <div class="text-center p-4 bg-gray-700 rounded-lg">
            <i class="fas fa-users-slash text-red-400 text-4xl mb-2"></i>
            <p class="text-lg">This room is already full with 2 participants.</p>
            <p class="text-sm text-gray-300">Try creating a new room or join later.</p>
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
        <div class="card-header">Remote</div>
        <div class="card-content">
            <div class="l1">
            <div class="avatar">
                <img src="${profileImgUrl}"  alt="Avatar">
            </div>
            <div class="name">Waiting....</div>
            </div>  
            <div class="audio-meter">
            <div class="audio-level" id="localAudioLevel" style="width: 0%;"></div>
            </div>
        </div>
        </div>
        `;
    }

    // document.getElementById('roomStatus').textContent = `Participants: ${currentParticipants}/2`;
});


// Handle incoming offers
socket.on('offer', async (data) => {
    if (data.sender === socket.id) return;
    
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
});

// Handle incoming answers
socket.on('answer', async (data) => {
    if (data.sender === socket.id || !peerConnection) return;
    
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
});

// Handle ICE candidates
socket.on('candidate', async (data) => {
    if (data.sender === socket.id || !peerConnection) return;
    
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
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
window.addEventListener('beforeunload', () => {
    if (peerConnection) {
        peerConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    socket.emit('leave', { room: roomId });
});