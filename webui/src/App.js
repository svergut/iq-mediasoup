import React, { useEffect, useState } from 'react';
import logo from './logo.svg';
import './App.css';
import { Device } from 'mediasoup-client'
import io from 'socket.io-client'

const getLocalVideo = () => document.getElementById('local_video');
const getRemoteContainer = () => document.getElementById('remote_container');
const getStateSpan = () => document.getElementById('state_span');
let localStream = null;
let clientId = null;
let device = null;
let producerTransport = null;
let videoProducer = null;
let audioProducer = null;
let consumerTransport = null;
let videoConsumers = {};
let audioConsumers = {};
let socket = null;

function connectSocket() {
  if (socket) {
    socket.close();
    socket = null;
    clientId = null;
  }

  return new Promise((resolve, reject) => {
    console.log('connetiong to localhost')
    socket = io('ws://localhost:8080/');

    socket.on('connect', function (evt) {
      console.log('socket.io connected()');
    });
    socket.on('error', function (err) {
      console.error('socket.io ERROR:', err);
      reject(err);
    });
    socket.on('disconnect', function (evt) {
      console.log('socket.io disconnect:', evt);
    });
    socket.on('message', function (message) {
      console.log('socket.io message:', message);
      if (message.type === 'welcome') {
        if (socket.id !== message.id) {
          console.warn('WARN: something wrong with clientID', socket.io, message.id);
        }

        clientId = message.id;
        console.log('connected to server. clientId=' + clientId);
        resolve();
      }
      else {
        console.error('UNKNOWN message from server:', message);
      }
    });
    socket.on('newProducer', function (message) {
      console.log('socket.io newProducer:', message);
      const remoteId = message.socketId;
      const prdId = message.producerId;
      const kind = message.kind;
      if (kind === 'video') {
        console.log('--try consumeAdd remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
        consumeAdd(consumerTransport, remoteId, prdId, kind);
      }
      else if (kind === 'audio') {
        //console.warn('-- audio NOT SUPPORTED YET. skip remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
        console.log('--try consumeAdd remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
        consumeAdd(consumerTransport, remoteId, prdId, kind);
      }
    });

    socket.on('producerClosed', function (message) {
      console.log('socket.io producerClosed:', message);
      const localId = message.localId;
      const remoteId = message.remoteId;
      const kind = message.kind;
      console.log('--try removeConsumer remoteId=%s, localId=%s, track=%s', remoteId, localId, kind);
      removeConsumer(remoteId, kind);
      removeRemoteVideo(remoteId);
    })
  });
}

function disconnectSocket() {
  if (socket) {
    socket.close();
    socket = null;
    clientId = null;
    console.log('socket.io closed..');
  }
}

function isSocketConnected() {
  if (socket) {
    return true;
  }
  else {
    return false;
  }
}

function sendRequest(type, data) {
  return new Promise((resolve, reject) => {
    socket.emit(type, data, (err, response) => {
      if (!err) {
        // Success response, so pass the mediasoup response to the local Room.
        resolve(response);
      } else {
        reject(err);
      }
    });
  });
}

// =========== media handling ========== 
function stopLocalStream(stream) {
  let tracks = stream.getTracks();
  if (!tracks) {
    console.warn('NO tracks');
    return;
  }

  tracks.forEach(track => track.stop());
}

// return Promise
function playVideo(element, stream) {
  if (element.srcObject) {
    console.warn('element ALREADY playing, so ignore');
    return;
  }

  
  element.srcObject = stream;
  element.volume = 0;
  return element.play();
}

function pauseVideo(element) {
  element.pause();
  element.srcObject = null;
}

function addRemoteTrack(id, track) {
  let video = findRemoteVideo(id);
  if (!video) {
    video = addRemoteVideo(id);
    video.controls = '1';
  }

  if (video.srcObject) {
    video.srcObject.addTrack(track);
    return;
  }

  const newStream = new MediaStream();
  newStream.addTrack(track);
  playVideo(video, newStream)
    .then(() => { video.volume = 1.0 })
    .catch(err => { console.error('media ERROR:', err) });
}

function addRemoteVideo(id) {
  let existElement = findRemoteVideo(id);
  if (existElement) {
    console.warn('remoteVideo element ALREADY exist for id=' + id);
    return existElement;
  }

  let element = document.createElement('video');
  getRemoteContainer().appendChild(element);
  element.id = 'remote_' + id;
  element.width = 240;
  element.height = 180;
  element.volume = 0;
  //element.controls = true;
  element.style = 'border: solid black 1px;';
  return element;
}

function findRemoteVideo(id) {
  let element = document.getElementById('remote_' + id);
  return element;
}

function removeRemoteVideo(id) {
  console.log(' ---- removeRemoteVideo() id=' + id);
  let element = document.getElementById('remote_' + id);
  if (element) {
    element.pause();
    element.srcObject = null;
    getRemoteContainer().removeChild(element);
  }
  else {
    console.log('child element NOT FOUND');
  }
}

function removeAllRemoteVideo() {
  while (getRemoteContainer().firstChild) {
    getRemoteContainer().firstChild.pause();
    getRemoteContainer().firstChild.srcObject = null;
    getRemoteContainer().removeChild(getRemoteContainer().firstChild);
  }
}

function checkUseVideo() {
  return true;

  const useVideo = document.getElementById('use_video').checked;
  return useVideo;
}

function checkUseAudio() {
  return true;

  const useAudio = document.getElementById('use_audio').checked;
  return useAudio;
}

function startMedia() {  
  if (localStream) {
    console.warn('WARN: local media ALREADY started');
    return;
  }

  const useVideo = checkUseVideo();
  const useAudio = checkUseAudio();

  navigator.mediaDevices.getUserMedia({ audio: useAudio, video: useVideo })
    .then((stream) => {
      localStream = stream;
      playVideo(getLocalVideo(), localStream);
      updateButtons();
    })
    .catch(err => {
      console.error('media ERROR:', err);
    });
}

function stopMedia() {
  if (localStream) {
    pauseVideo(getLocalVideo());
    stopLocalStream(localStream);
    localStream = null;
  }
  updateButtons();
}

async function connect() {
  if (!localStream) {
    console.warn('WARN: local media NOT READY');
    return;
  }

  // --- connect socket.io ---
  await connectSocket().catch(err => {
    console.error(err);
    return;
  });

  updateButtons();

  // --- get capabilities --
  const data = await sendRequest('getRouterRtpCapabilities', {});
  console.log('getRouterRtpCapabilities:', data);
  await loadDevice(data);

  // --- get transport info ---
  console.log('--- createProducerTransport --');
  const params = await sendRequest('createProducerTransport', {});
  console.log('transport params:', params);
  producerTransport = device.createSendTransport(params);
  console.log('createSendTransport:', producerTransport);

  // --- join & start publish --
  producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    console.log('--trasnport connect');
    sendRequest('connectProducerTransport', { dtlsParameters: dtlsParameters })
      .then(callback)
      .catch(errback);
  });

  producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
    console.log('--trasnport produce');
    try {
      const { id } = await sendRequest('produce', {
        transportId: producerTransport.id,
        kind,
        rtpParameters,
      });
      callback({ id });
      console.log('--produce requested, then subscribe ---');
      subscribe();
    } catch (err) {
      errback(err);
    }
  });

  producerTransport.on('connectionstatechange', (state) => {
    switch (state) {
      case 'connecting':
        console.log('publishing...');
        break;

      case 'connected':
        console.log('published');
        break;

      case 'failed':
        console.log('failed');
        producerTransport.close();
        break;

      default:
        break;
    }
  });

  const useVideo = checkUseVideo();
  const useAudio = checkUseAudio();
  if (useVideo) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const trackParams = { track: videoTrack };
      videoProducer = await producerTransport.produce(trackParams);
    }
  }
  if (useAudio) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const trackParams = { track: audioTrack };
      audioProducer = await producerTransport.produce(trackParams);
    }
  }

  updateButtons();
}

async function subscribe() {
  if (!isSocketConnected()) {
    await connectSocket().catch(err => {
      console.error(err);
      return;
    });

    // --- get capabilities --
    const data = await sendRequest('getRouterRtpCapabilities', {});
    console.log('getRouterRtpCapabilities:', data);
    await loadDevice(data);
  }


  // --- prepare transport ---
  console.log('--- createConsumerTransport --');
  if (!consumerTransport) {
    const params = await sendRequest('createConsumerTransport', {});
    console.log('transport params:', params);
    consumerTransport = device.createRecvTransport(params);
    console.log('createConsumerTransport:', consumerTransport);

    // --- join & start publish --
    consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      console.log('--consumer trasnport connect');
      sendRequest('connectConsumerTransport', { dtlsParameters: dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    consumerTransport.on('connectionstatechange', (state) => {
      switch (state) {
        case 'connecting':
          console.log('subscribing...');
          break;

        case 'connected':
          console.log('subscribed');
          //consumeCurrentProducers(clientId);
          break;

        case 'failed':
          console.log('failed');
          producerTransport.close();
          break;

        default:
          break;
      }
    });

    consumeCurrentProducers(clientId);
  }
}

async function consumeCurrentProducers(clientId) {
  console.log('-- try consuleAll() --');
  const remoteInfo = await sendRequest('getCurrentProducers', { localId: clientId })
    .catch(err => {
      console.error('getCurrentProducers ERROR:', err);
      return;
    });
  //console.log('remoteInfo.producerIds:', remoteInfo.producerIds);
  console.log('remoteInfo.remoteVideoIds:', remoteInfo.remoteVideoIds);
  console.log('remoteInfo.remoteAudioIds:', remoteInfo.remoteAudioIds);
  consumeAll(consumerTransport, remoteInfo.remoteVideoIds, remoteInfo.remoteAudioIds);
}

function disconnect() {
  if (localStream) {
    pauseVideo(getLocalVideo());
    stopLocalStream(localStream);
    localStream = null;
  }
  if (videoProducer) {
    videoProducer.close(); // localStream will stop
    videoProducer = null;
  }
  if (audioProducer) {
    audioProducer.close(); // localStream will stop
    audioProducer = null;
  }
  if (producerTransport) {
    producerTransport.close(); // localStream will stop
    producerTransport = null;
  }

  for (const key in videoConsumers) {
    const consumer = videoConsumers[key];
    consumer.close();
    delete videoConsumers[key];
  }
  for (const key in audioConsumers) {
    const consumer = audioConsumers[key];
    consumer.close();
    delete audioConsumers[key];
  }

  if (consumerTransport) {
    consumerTransport.close();
    consumerTransport = null;
  }

  removeAllRemoteVideo();

  disconnectSocket();
  updateButtons();
}

async function loadDevice(routerRtpCapabilities) {
  try {
    console.log('loadDevice')

    device = new Device();
  } catch (error) {
    console.error('error:', error)

    if (error.name === 'UnsupportedError') {
      console.error('browser not supported');
    }
  }
  await device.load({ routerRtpCapabilities });
}

function consumeAll(transport, remoteVideoIds, remotAudioIds) {
  console.log('----- consumeAll() -----')
  remoteVideoIds.forEach(rId => {
    consumeAdd(transport, rId, null, 'video');
  });
  remotAudioIds.forEach(rId => {
    consumeAdd(transport, rId, null, 'audio');
  });
};

async function consumeAdd(transport, remoteSocketId, prdId, trackKind) {
  console.log('--start of consumeAdd -- kind=%s', trackKind);
  const { rtpCapabilities } = device;
  //const data = await socket.request('consume', { rtpCapabilities });
  const data = await sendRequest('consumeAdd', { rtpCapabilities: rtpCapabilities, remoteId: remoteSocketId, kind: trackKind })
    .catch(err => {
      console.error('consumeAdd ERROR:', err);
    });
  const {
    producerId,
    id,
    kind,
    rtpParameters,
  } = data;
  if (prdId && (prdId !== producerId)) {
    console.warn('producerID NOT MATCH');
  }

  let codecOptions = {};
  const consumer = await transport.consume({
    id,
    producerId,
    kind,
    rtpParameters,
    codecOptions,
  });
  //const stream = new MediaStream();
  //stream.addTrack(consumer.track);

  addRemoteTrack(remoteSocketId, consumer.track);
  addConsumer(remoteSocketId, consumer, kind);
  consumer.remoteId = remoteSocketId;
  consumer.on("transportclose", () => {
    console.log('--consumer transport closed. remoteId=' + consumer.remoteId);
    //consumer.close();
    //removeConsumer(remoteId);
    //removeRemoteVideo(consumer.remoteId);
  });
  consumer.on("producerclose", () => {
    console.log('--consumer producer closed. remoteId=' + consumer.remoteId);
    consumer.close();
    removeConsumer(consumer.remoteId, kind);
    removeRemoteVideo(consumer.remoteId);
  });
  consumer.on('trackended', () => {
    console.log('--consumer trackended. remoteId=' + consumer.remoteId);
    //consumer.close();
    //removeConsumer(remoteId);
    //removeRemoteVideo(consumer.remoteId);
  });

  console.log('--end of consumeAdd');
  //return stream;

  if (kind === 'video') {
    console.log('--try resumeAdd --');
    sendRequest('resumeAdd', { remoteId: remoteSocketId, kind: kind })
      .then(() => {
        console.log('resumeAdd OK');
      })
      .catch(err => {
        console.error('resumeAdd ERROR:', err);
      });
  }
}


function getConsumer(id, kind) {
  if (kind === 'video') {
    return videoConsumers[id];
  }
  else if (kind === 'audio') {
    return audioConsumers[id];
  }
  else {
    console.warn('UNKNOWN consumer kind=' + kind);
  }
}

function addConsumer(id, consumer, kind) {
  if (kind === 'video') {
    videoConsumers[id] = consumer;
    console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
  }
  else if (kind === 'audio') {
    audioConsumers[id] = consumer;
    console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
  }
  else {
    console.warn('UNKNOWN consumer kind=' + kind);
  }
}

function removeConsumer(id, kind) {
  if (kind === 'video') {
    delete videoConsumers[id];
    console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
  }
  else if (kind === 'audio') {
    delete audioConsumers[id];
    console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
  }
  else {
    console.warn('UNKNOWN consumer kind=' + kind);
  }
}

// ---- UI control ----
function updateButtons() {
  if (localStream) {
    disableElement('start_video_button');
    disableElement('use_video');
    disableElement('use_audio');
    if (isSocketConnected()) {
      disableElement('stop_video_button');
      disableElement('connect_button');
      enabelElement('disconnect_button');
    }
    else {
      enabelElement('stop_video_button');
      enabelElement('connect_button');
      disableElement('disconnect_button');
    }
  }
  else {
    enabelElement('start_video_button');
    enabelElement('use_video');
    enabelElement('use_audio');
    disableElement('stop_video_button');
    disableElement('connect_button');
    disableElement('disconnect_button');
  }
}

function enabelElement(id) {
  let element = document.getElementById(id);
  if (element) {
    element.removeAttribute('disabled');
  }
}

function disableElement(id) {
  let element = document.getElementById(id);
  if (element) {
    element.setAttribute('disabled', '1');
  }
}

function App() {
  const [connectionState, setConnectionState] = useState('ws not connected')

  useEffect(() => {
    updateButtons()
  }, [])

  return (
    <div className="App">
      <header className="App-header">
        <p>
          Mediasoup tests
        </p>
        <a>connection state: {connectionState}</a>
      </header>
      <div>
        <button id="start_video_button" onClick={startMedia}>Start Media</button>
        <button id="stop_video_button" onClick={stopMedia}>Stop Media</button>
        &nbsp;
        <button id="connect_button" onClick={connect}>Connect</button>
        <button id="disconnect_button" onClick={disconnect}>Disconnect</button>
        <div>
          local video<br />
          <video id="local_video" autoPlay={true} style={{width: 120, height: 90, border: '1px solid black'}}></video>
          <span id="state_span"></span>
        </div>
        remote video<br />
        <div id="remote_container"></div>
      </div>
    </div>
  );
}

export default App;
