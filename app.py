from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
from collections import defaultdict

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent", 
                  logger=True, ping_timeout=60, ping_interval=25)  # Prevents timeouts

room_participants = defaultdict(set)

@app.route('/ping')
def ping():
    return "WebSocket OK", 200

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/call/<room_id>')
def call(room_id):
    return render_template('call.html', room_id=room_id)

@app.route('/check_room/<room_id>')
def check_room(room_id):
    participants = len(room_participants.get(room_id, set()))
    return jsonify({
        'can_join': participants <= 2,
        'current_participants': participants
    })

@socketio.on('connect')
def handle_connect():
    print("[INFO] Client connected")

@socketio.on('disconnect')
def handle_disconnect():
    print("[INFO] Client disconnected")
    # Clean up any rooms this client was in
    for room in list(room_participants.keys()):
        if request.sid in room_participants[room]:
            room_participants[room].remove(request.sid)
            emit('participant_left', {'count': len(room_participants[room])}, room=room)
            if not room_participants[room]:
                del room_participants[room]

@socketio.on('join')
def handle_join(data):
    room = data['room']
    participants = room_participants.get(room, set())
    
    if len(participants) > 2:
        emit('room_full', {'room': room})
        return
    
    join_room(room)
    participants.add(request.sid)
    room_participants[room] = participants
    
    print(f"[INFO] Client joined room {room}. Current participants: {len(participants)}")
    emit('joined', {
        'room': room,
        'message': 'You have joined the room',
        'participant_count': len(participants)
    }, room=room)
    
    # Notify all in room about new participant count
    emit('participant_update', {'count': len(participants)}, room=room)

@socketio.on('leave')
def handle_leave(data):
    room = data['room']
    leave_room(room)
    
    if room in room_participants and request.sid in room_participants[room]:
        room_participants[room].remove(request.sid)
        print(f"[INFO] Client left room {room}. Remaining participants: {len(room_participants[room])}")
        
        emit('left', {
            'room': room,
            'message': 'You have left the room'
        }, room=room)
        
        # Notify remaining participants
        if room_participants[room]:
            emit('participant_left', {'count': len(room_participants[room])}, room=room)
        else:
            del room_participants[room]

@socketio.on('offer')
def handle_offer(data):
    room = data['room']
    print(f"[DEBUG] Received offer in room {room}:", data['offer'])
    emit('offer', {'offer': data['offer'], 'sender': request.sid}, 
         room=room, include_self=False)

@socketio.on('answer')
def handle_answer(data):
    room = data['room']
    print(f"[DEBUG] Received answer in room {room}:", data['answer'])
    emit('answer', {'answer': data['answer'], 'sender': request.sid}, 
         room=room, include_self=False)

@socketio.on('candidate')
def handle_candidate(data):
    room = data['room']
    print(f"[DEBUG] Received candidate in room {room}:", data['candidate'])
    emit('candidate', {'candidate': data['candidate'], 'sender': request.sid}, 
         room=room, include_self=False)

if __name__ == '__main__':
    print("[INFO] Starting server...")
    socketio.run(app, host="0.0.0.0", debug=False)