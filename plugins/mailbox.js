var microtime = require('microtime');
var bitcore = require('bitcore');
var mdb = require('../lib/MessageDb').default();
var logger = require('../lib/logger').logger;
var preconditions = require('preconditions').singleton();
var foxtrot = require('foxtrot');
var Key = bitcore.Key;

var io;
module.exports.init = function(ext_io, config) {
  logger.info('Using mailbox plugin');
  preconditions.checkArgument(ext_io);
  io = ext_io;

  foxtrot.options = config.foxtrot;
  foxtrot.on('peerConnect', function(peer) {
    console.log('>>> connected to peer (' + peer.descriptorString() + ')');
  });
  foxtrot.on('peerDisconnect', function(peer) {
    console.log('>>> disconnected from peer (' + peer.descriptorString() + ')');
  });

  var identity = Key.generateSync();
  if (config.identity) {
    identity.private = new Buffer(config.identity, 'hex');
    identity.regenerateSync();
  }

  var server = foxtrot.createServer({
    key: identity,
    advertise: true
  });
  console.log('>>> foxtrot server listening on ' + identity.public.toString('hex'));

  server.on('connect', function(socket) {
    socket.nick = null;
    socket.clientNumber = chatClients.length;
    chatClients.push(socket);
    socket.on('data', function(data) {
      if (!socket.nick) {
        socket.nick = data.toString();;
        for (var i = 0; i < chatClients.length; i++) {
          var chatClient = chatClients[i];
          if ((chatClient !== socket) && (chatClient.nick == socket.nick)) {
            chatClients.splice(chatClient.clientNumber, 1);
            socket.end('>>> that nickname is already taken\n');
            return;
          }
        }
        var announcement = '>>> ' + socket.nick + ' has joined the conversation\n';
        sendToEveryone(announcement, socket);
      } else {
        sendToEveryone(socket.nick + '> ' + data, socket);
      }
    });
    socket.on('close', function() {
      chatClients.splice(socket.clientNumber, 1);
    });
  });


  io.sockets.on('connection', function(socket) {
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
