var microtime = require('microtime');
var bitcore = require('bitcore');
var mdb = require('../lib/MessageDb').default();
var logger = require('../lib/logger').logger;
var preconditions = require('preconditions').singleton();
var foxtrot = require('foxtrot');
var Key = bitcore.Key;
var ss = require('socket.io-stream');
var router = require('socket.io-events')();

var io;
module.exports.init = function(ext_io, config) {
  logger.info('Using mailbox plugin');
  preconditions.checkArgument(ext_io);
  io = ext_io;
  ss(io);

  var peers = {};
  var socket2foxtrot = {};

  foxtrot.options = config.foxtrot;
  foxtrot.on('peerConnect', function(peer) {
    console.log('>>> connected to peer (' + peer.descriptorString() + ')');
  });
  foxtrot.on('peerDisconnect', function(peer) {
    console.log('>>> disconnected from peer (' + peer.descriptorString() + ')');
  });

  var identity = Key.generateSync();
  if (config.identity && !process.env.RANDOM_ID) {
    identity.private = new Buffer(config.identity, 'hex');
    identity.regenerateSync();
  }

  var server = foxtrot.createServer({
    key: identity,
    advertise: true
  });
  console.log('>>> foxtrot server listening on ' + identity.public.toString('hex'));

  server.on('connect', function(socket) {
    // other insight server connecting to us via foxtrot
    console.log('other insight server connecting to us via foxtrot');
    socket.pipe(process.stdout);
    socket.on('data', function(data) {
      console.log('data on foxtrot');
    });
    socket.on('close', function() {
      console.log('close on foxtrot');
    });
  });


  router.on('*', function(sock, args, next) {
    console.log(sock.id+' on ' + args[0]);
    var id = sock.id;
    var fID = socket2foxtrot[id];
    var peer = peers[fID];
    if (fID && peer) {
      console.log('redirecting ' + args + ' to ' + peer);
      peer.write(JSON.stringify(args));
      sock.emit(args.shift(), args);
    }
    next();
  });
  io.use(router);

  io.use(function(socket, next) {
    var q = socket.request._query;
    if (q.foxtrot && identity.public.toString('hex') !== q.foxtrot && !peers[q.foxtrot]) {
      console.log('overriding emits and handlers for ' + socket.id + ' to proxy to ' + q.foxtrot);
      var client = foxtrot.connect({
        address: new Buffer(q.foxtrot, 'hex')
      }, function() { // on connected
        console.log('>>> connected to other insight server: ' + q.foxtrot);
      });
      client.on('error', function(err) {
        console.error(err);
        //foxtrot.stop();
      });
      peers[q.foxtrot] = client;
      socket2foxtrot[socket.id] = q.foxtrot;
    }
    next();
  });

  io.sockets.on('connection', function(socket) {
    socket.on('ping', function() {
      socket.emit('pong', Math.floor(Math.random() * 10 % 10));
    });
    // when it requests sync, send him all pending messages
    socket.on('sync', function(ts) {
      logger.verbose('Sync requested by ' + socket.id);
      logger.debug('    from timestamp ' + ts);

      // check that client is subscribed to his public key
      var rooms = socket.rooms;
      if (rooms.length !== 2) {
        socket.emit('insight-error', 'Must subscribe with public key before syncing');
        return;
      }

      // let client know of our foxtrot address
      socket.emit('foxtrot', identity.public.toString('hex'));

      var to = rooms[1];
      var upper_ts = Math.round(microtime.now());
      logger.debug('    to timestamp ' + upper_ts);
      mdb.getMessages(to, ts, upper_ts, function(err, messages) {
        if (err) {
          throw new Error('Couldn\'t get messages on sync request: ' + err);
        }
        logger.verbose('\tFound ' + messages.length + ' message' + (messages.length !== 1 ? 's' : ''));

        if (messages.length) {
          for (var i = 0; i < messages.length; i++) {
            broadcastMessage(messages[i], socket);
          }
        } else {
          socket.emit('no messages');
        }
      });
    });

    // when it receives a message, add it to db
    socket.on('message', function(m) {
      logger.debug('Message sent from ' + m.pubkey + ' to ' + m.to);
      mdb.addMessage(m, function(err) {
        if (err) {
          throw new Error('Couldn\'t add message to database: ' + err);
        }
      });
    });

  });

  mdb.on('message', broadcastMessage);

};

var broadcastMessage = module.exports.broadcastMessage = function(message, socket) {
  preconditions.checkState(io);
  var s = socket || io.sockets.in(message.to);
  logger.debug('sending message to ' + message.to);
  s.emit('message', message);
}
