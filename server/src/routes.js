const express = require('express')
const mediasoup = require('mediasoup')

const app = express()
  

app.get('/ping', (req, res) => {
    res.send('pong')
})

app.get('/test', async (req, res) => {
    const supportedRtpCapabilities = mediasoup.getSupportedRtpCapabilities()
 
    res.json(supportedRtpCapabilities)
})

module.exports = app