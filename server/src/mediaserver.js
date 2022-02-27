const http = require("http");
const https = require("https");
const mediasoup = require("mediasoup");
const mediasoupOptions = {
  // Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      // 'rtx',
      // 'bwe',
      // 'score',
      // 'simulcast',
      // 'svc'
    ],
  },
  // Router settings
  router: {
    mediaCodecs:
      [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters:
          {
            'x-google-start-bitrate': 1000
          }
        },
      ]
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      { ip: '127.0.0.1', announcedIp: null }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  }
};

let worker = null;
let router = null;

async function startWorker() {
    const mediaCodecs = mediasoupOptions.router.mediaCodecs;
    worker = await mediasoup.createWorker();
    router = await worker.createRouter({ mediaCodecs });
    //producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
    console.log('-- mediasoup worker start. --')
}
  

function initListeners(socket) {
    socket.on('getRouterCapabilities', (data, callback) => {
        console.log('getRouterCapabilities')

        if (router) {
            socket.emit('getRouterCapabilities:answer', { 
                    routerRtpCapabilities: router.rtpCapabilities 
                }
            )
        }
        else {
          console.log('error')
        }
    });

    socket.on('createTransport', async (data, callback) => {
        console.log('-- createTransport ---');
        const { transport, params } = await createTransport();
        addProducerTrasport(socket.id, transport);
        transport.observer.on('close', () => {
          const id = socket.id;
          const videoProducer = getProducer(id, 'video');
          if (videoProducer) {
            videoProducer.close();
            removeProducer(id, 'video');
          }
          const audioProducer = getProducer(id, 'audio');
          if (audioProducer) {
            audioProducer.close();
            removeProducer(id, 'audio');
          }
          removeProducerTransport(id);
        });
        //console.log('-- createProducerTransport params:', params);
        socket.emit('createTransport:answer', params)
      });

    socket.on('connectProducerTransport', async (data, callback) => {
        console.log('--trasnport connect');

        const transport = getProducerTrasnport(socket.id);
        await transport.connect({ dtlsParameters: data.dtlsParameters });
    });
    
    socket.on('newProducer', function (message) {
        console.log('socket.io newProducer:', message);
        const remoteId = message.socketId;
        const prdId = message.producerId;
        const kind = message.kind;
        if (kind === 'video') {
          console.log('--try consumeAdd remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
        }
        else if (kind === 'audio') {
          //console.warn('-- audio NOT SUPPORTED YET. skip remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
          console.log('--try consumeAdd remoteId=' + remoteId + ', prdId=' + prdId + ', kind=' + kind);
        }
      });

    socket.on('produce', async (data, callback) => {
        const { kind, rtpParameters } = data;
        console.log('-- produce --- kind=' + kind);
        const id = socket.id;
        const transport = getProducerTrasnport(id);
        if (!transport) {
          console.error('transport NOT EXIST for id=' + id);
          return;
        }
        const producer = await transport.produce({ kind, rtpParameters });
        addProducer(id, producer, kind);
        producer.observer.on('close', () => {
          console.log('producer closed --- kind=' + kind);
        })
        sendResponse({ id: producer.id }, callback);
    
        // inform clients about new producer
        console.log('--broadcast newProducer ---');
        socket.broadcast.emit('newProducer', { socketId: id, producerId: producer.id, kind: producer.kind });
      });
}

let producerTransports = {};
let videoProducers = {};
let audioProducers = {};

function getProducerTrasnport(id) {
  return producerTransports[id];
}

function addProducerTrasport(id, transport) {
  producerTransports[id] = transport;
  console.log('producerTransports count=' + Object.keys(producerTransports).length);
}

function removeProducerTransport(id) {
  delete producerTransports[id];
  console.log('producerTransports count=' + Object.keys(producerTransports).length);
}

function getProducer(id, kind) {

  if (kind === 'video') {
    return videoProducers[id];
  }
  else if (kind === 'audio') {
    return audioProducers[id];
  }
  else {
    console.warn('UNKNOWN producer kind=' + kind);
  }
}

/*
function getProducerIds(clientId) {
  let producerIds = [];
  for (const key in producers) {
    if (key !== clientId) {
      producerIds.push(key);
    }
  }
  return producerIds;
}
*/

function getRemoteIds(clientId, kind) {
  let remoteIds = [];
  if (kind === 'video') {
    for (const key in videoProducers) {
      if (key !== clientId) {
        remoteIds.push(key);
      }
    }
  }
  else if (kind === 'audio') {
    for (const key in audioProducers) {
      if (key !== clientId) {
        remoteIds.push(key);
      }
    }
  }
  return remoteIds;
}


function addProducer(id, producer, kind) {
  if (kind === 'video') {
    videoProducers[id] = producer;
    console.log('videoProducers count=' + Object.keys(videoProducers).length);
  }
  else if (kind === 'audio') {
    audioProducers[id] = producer;
    console.log('audioProducers count=' + Object.keys(audioProducers).length);
  }
  else {
    console.warn('UNKNOWN producer kind=' + kind);
  }
}

function removeProducer(id, kind) {
  if (kind === 'video') {
    delete videoProducers[id];
    console.log('videoProducers count=' + Object.keys(videoProducers).length);
  }
  else if (kind === 'audio') {
    delete audioProducers[id];
    console.log('audioProducers count=' + Object.keys(audioProducers).length);
  }
  else {
    console.warn('UNKNOWN producer kind=' + kind);
  }
}


// --- multi-consumers --
let consumerTransports = {};
let videoConsumers = {};
let audioConsumers = {};

function getConsumerTrasnport(id) {
  return consumerTransports[id];
}

function addConsumerTrasport(id, transport) {
  consumerTransports[id] = transport;
  console.log('consumerTransports count=' + Object.keys(consumerTransports).length);
}

function removeConsumerTransport(id) {
  delete consumerTransports[id];
  console.log('consumerTransports count=' + Object.keys(consumerTransports).length);
}

function getConsumerSet(localId, kind) {
  if (kind === 'video') {
    return videoConsumers[localId];
  }
  else if (kind === 'audio') {
    return audioConsumers[localId];
  }
  else {
    console.warn('WARN: getConsumerSet() UNKNWON kind=%s', kind);
  }
}
function getConsumer(localId, remoteId, kind) {
  const set = getConsumerSet(localId, kind);
  if (set) {
    return set[remoteId];
  }
  else {
    return null;
  }
}

function addConsumer(localId, remoteId, consumer, kind) {
  const set = getConsumerSet(localId, kind);
  if (set) {
    set[remoteId] = consumer;
    console.log('consumers kind=%s count=%d', kind, Object.keys(set).length);
  }
  else {
    console.log('new set for kind=%s, localId=%s', kind, localId);
    const newSet = {};
    newSet[remoteId] = consumer;
    addConsumerSet(localId, newSet, kind);
    console.log('consumers kind=%s count=%d', kind, Object.keys(newSet).length);
  }
}

function removeConsumer(localId, remoteId, kind) {
  const set = getConsumerSet(localId, kind);
  if (set) {
    delete set[remoteId];
    console.log('consumers kind=%s count=%d', kind, Object.keys(set).length);
  }
  else {
    console.log('NO set for kind=%s, localId=%s', kind, localId);
  }
}

function removeConsumerSetDeep(localId) {
  const set = getConsumerSet(localId, 'video');
  delete videoConsumers[localId];
  if (set) {
    for (const key in set) {
      const consumer = set[key];
      consumer.close();
      delete set[key];
    }

    console.log('removeConsumerSetDeep video consumers count=' + Object.keys(set).length);
  }

  const audioSet = getConsumerSet(localId, 'audio');
  delete audioConsumers[localId];
  if (audioSet) {
    for (const key in audioSet) {
      const consumer = audioSet[key];
      consumer.close();
      delete audioSet[key];
    }

    console.log('removeConsumerSetDeep audio consumers count=' + Object.keys(audioSet).length);
  }
}

function addConsumerSet(localId, set, kind) {
  if (kind === 'video') {
    videoConsumers[localId] = set;
  }
  else if (kind === 'audio') {
    audioConsumers[localId] = set;
  }
  else {
    console.warn('WARN: addConsumerSet() UNKNWON kind=%s', kind);
  }
}

async function createTransport() {
  const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  console.log('-- create transport id=' + transport.id);

  return {
    transport: transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    }
  };
}

async function createConsumer(transport, producer, rtpCapabilities) {
  let consumer = null;
  if (!router.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }

  //consumer = await producerTransport.consume({ // NG: try use same trasport as producer (for loopback)
  consumer = await transport.consume({ // OK
    producerId: producer.id,
    rtpCapabilities,
    paused: producer.kind === 'video',
  }).catch(err => {
    console.error('consume failed', err);
    return;
  });

  //if (consumer.type === 'simulcast') {
  //  await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  //}

  return {
    consumer: consumer,
    params: {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused
    }
  };
}

module.exports = {
    initListeners,
    startWorker 
}