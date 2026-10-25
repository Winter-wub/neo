// Preloaded into the OLD Node backend (NODE_OPTIONS=--require) by the contract driver.
// The old backend hard-codes Apple STT at 127.0.0.1:8001, which is where the real Neo Console listens.
// Redirect that one port to the fake STT; with no fake STT port set, refuse instead of touching the real one.
const http = require('http')
const target = Number(process.env.CONTRACT_STT_PORT || 0)
const request = http.request
http.request = function (options, ...rest) {
  if (options && typeof options === 'object' && !(options instanceof URL) && Number(options.port) === 8001) {
    if (!target) throw new Error('contract: refusing to reach the real STT on :8001')
    options = { ...options, port: target }
  }
  return request.call(this, options, ...rest)
}
